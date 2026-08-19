if 'custom' not in globals():
    from mage_ai.data_preparation.decorators import custom
if 'test' not in globals():
    from mage_ai.data_preparation.decorators import test

@custom
def transform_custom(data, *args, **kwargs):
    import pandas as pd
    import numpy as np

    # ==========================================
    # 0. CONTROL DE FLUJO (BATCH VACÍO)
    # ==========================================
    if data is None or data.empty:
        print("No hay datos nuevos para procesar. Finalizando bloque.")
        return pd.DataFrame()

    # ==========================================
    # 1. METADATA GLOBAL
    # ==========================================
    pipeline_run = kwargs.get('pipeline_run')
    run_id = str(pipeline_run.id) if pipeline_run else 'manual'
    pipeline_name = kwargs.get('pipeline_uuid', 'unknown_pipeline')
    mage_run_id_final = f"{pipeline_name}_run_{run_id}"

    if '_file_name' in data.columns:
        data = data.drop(columns=['_file_name'])

    # ==========================================
    # 2. CONFIGURACIÓN DE LLAVE (SODIMAC)
    # ==========================================
    TRIP_KEY_COL = 'Nº ID'
    
    if TRIP_KEY_COL not in data.columns:
        raise ValueError(f"Error Crítico: La llave '{TRIP_KEY_COL}' no existe en el archivo procesado de Sodimac.")

    data[TRIP_KEY_COL] = data[TRIP_KEY_COL].replace('', np.nan)
    
    # Rellenamos hacia abajo (ffill) SIN mezclar archivos
    data[TRIP_KEY_COL] = data.groupby('_gcs_uri')[TRIP_KEY_COL].ffill().astype(str).str.replace(r'\.0$', '', regex=True)
    data = data.fillna("")

    # ==========================================
    # 3. CLASIFICACIÓN DE COLUMNAS (ESTÁTICA)
    # ==========================================
    #
    # ANTES ERA INFERIDA Y ESA ERA LA CAUSA RAÍZ DE TRES BUGS (issues #4, #5, #6).
    # La versión anterior contaba valores distintos por viaje y hacía `.max()`
    # SOBRE TODOS LOS VIAJES DEL ARCHIVO: un solo viaje atípico redefinía la
    # forma del payload de todos los demás.
    #
    # Lo que eso provocó, medido en producción el 2026-08-18: el viaje 842862
    # trajo dos ESTADO distintos en un mismo scrape (la misma fila releída
    # mientras el estado cambiaba), ESTADO pasó a ser columna de parada, y
    # **los 41 viajes de esa tanda salieron sin estado en `trip_metadata`**.
    # Aguas abajo `stg_sodimac_trips.raw_estado` queda nulo y `trip_status`
    # también — y `trip_status` NO está en `merge_exclude_columns` de app.trips,
    # así que un nulo pisa el valor bueno. Se auto-sana en la corrida siguiente,
    # por eso nunca se vio. Histórico: ESTADO quedó clasificado como columna de
    # parada en 115 versiones, pero realmente difiere en 3, sobre 2 viajes.
    #
    # LAS COLUMNAS DE SODIMAC SON FIJAS Y CONOCIDAS, así que no hay nada que
    # inferir. Medido sobre 123 instancias de viaje (3 archivos de producción),
    # las únicas que varían dentro de un mismo viaje son ORIGEN (12) y
    # DESTINO (3); las otras siete, cero.
    #
    # Eso coincide con el modelo estándar de la industria: un envío tiene una
    # secuencia de paradas y cada parada tiene un tipo (retiro/entrega). En
    # project44 el origen y el destino NO son campos escalares del envío — se
    # identifican dentro del array `shipmentStops` por su `stopType`
    # (ORIGIN/DESTINATION) y su `stopNumber`. Oracle OTM acepta órdenes con
    # más de un pickup y más de un delivery. Una solicitud de Sodimac con
    # "link 2 conexiónes" son dos tramos: multi-retiro o multi-entrega.
    COLS_DE_PARADA = ['ORIGEN', 'DESTINO']

    cols_to_classify = [c for c in data.columns if c not in [TRIP_KEY_COL, '_gcs_uri']]
    cols_parada = [c for c in cols_to_classify if c in COLS_DE_PARADA]
    cols_viaje  = [c for c in cols_to_classify if c not in COLS_DE_PARADA]

    faltantes = [c for c in COLS_DE_PARADA if c not in cols_to_classify]
    if faltantes:
        print(f"⚠️  Columnas de parada ausentes en el archivo: {faltantes}")

    print(f"Clasificación estática -> Cabecera: {cols_viaje} | Parada: {cols_parada}")

    # DIAGNÓSTICO, no corrección: si una columna de viaje varía dentro de un
    # mismo viaje, `viaje_info` (que toma .iloc[0]) elige una en silencio. Puede
    # ser una columna nueva que en realidad es del tramo, o el scrape leyendo la
    # misma fila en dos momentos. Se avisa en vez de reformatear el payload.
    if cols_viaje:
        varianza = data.groupby(['_gcs_uri', TRIP_KEY_COL])[cols_viaje].nunique().max()
        inestables = [c for c in cols_viaje if varianza[c] > 1]
        if inestables:
            print(
                f"⚠️  Columnas de VIAJE con más de un valor dentro de un mismo viaje: "
                f"{inestables}. Se toma el de la primera fila. Si alguna es de tramo, "
                f"hay que agregarla a COLS_DE_PARADA; si no, el scrape está releyendo "
                f"la misma fila en momentos distintos (ver issue #5)."
            )

    # ==========================================
    # 4. CONSTRUCCIÓN DEL PAYLOAD DINÁMICO
    # ==========================================
    payloads = []
    
    for (gcs_uri, trip_id), df_group in data.groupby(['_gcs_uri', TRIP_KEY_COL]):
        
        # Extracción dinámica de metadatos por fila
        clean_path = str(gcs_uri).replace("gs://", "")
        parts = clean_path.split('/')
        tms_name = parts[2].lower() if len(parts) >= 6 else 'unknown'
        product = parts[3].lower() if len(parts) >= 6 else 'unknown'
        cliente = parts[4].lower() if len(parts) >= 6 else 'unknown'

        viaje_info = df_group[cols_viaje].iloc[0].to_dict()
        
        if len(cols_parada) > 0:
            # drop_duplicates: dos tramos idénticos en ORIGEN y DESTINO no se
            # distinguen entre sí ni acá ni aguas abajo, así que colapsarlos no
            # pierde información — y evita las paradas inventadas que producía
            # la duplicación del scraper (issue #5), que ya se arregló en
            # extraction_service pero sigue presente en los archivos viejos que
            # están en GCS. Defensa en profundidad: el pipeline no debería
            # depender de que el archivo venga limpio.
            paradas_info = df_group[cols_parada].drop_duplicates().to_dict(orient='records')
        else:
            paradas_info = [{}] 
        
        clean_payload = {
            "trip_id": trip_id,
            "trip_metadata": viaje_info,
            "stops": paradas_info
        }
        
        payloads.append({
            "tms_name": tms_name,
            "product": product,
            "source_client": cliente,
            "file_name": str(gcs_uri),
            "mage_run_id": mage_run_id_final,
            "payload": clean_payload
        })

    # ==========================================
    # 5. CONSTRUIR TABLA FINAL
    # ==========================================
    df_bronze = pd.DataFrame(payloads)

    print(f"Transformación Sodimac OK. -> Viajes procesados en este lote: {len(df_bronze)}")
    
    return df_bronze

@test
def test_output(output, *args) -> None:
    if output is not None and not output.empty:
        expected_cols = {'tms_name', 'product', 'source_client', 'file_name', 'mage_run_id', 'payload'}
        assert set(output.columns) == expected_cols, f"Incorrect columns. Expected {expected_cols}"