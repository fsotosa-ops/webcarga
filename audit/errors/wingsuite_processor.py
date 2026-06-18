from mage_ai.settings.repo import get_repo_path
from mage_ai.io.config import ConfigFileLoader
from mage_ai.io.google_cloud_storage import GoogleCloudStorage
from mage_ai.io.postgres import Postgres
from os import path
import pandas as pd
import io

if 'data_loader' not in globals():
    from mage_ai.data_preparation.decorators import data_loader
if 'test' not in globals():
    from mage_ai.data_preparation.decorators import test

def extract_timestamp(filename):
    """Extrae el timestamp final del nombre del archivo (ej: ..._1777129232.csv)"""
    try:
        ts_str = filename.split('_')[-1].split('.')[0]
        return int(ts_str)
    except Exception:
        return 0

@data_loader
def load_from_google_cloud_storage(*args, **kwargs):
    config_path = path.join(get_repo_path(), 'io_config.yaml')
    config_profile = 'default'
    
    # ---------------------------------------------------------
    # 1. OBTENER LA MARCA DE AGUA (WATERMARK) DESDE SUPABASE
    # ---------------------------------------------------------
    # ¡Importante! Aquí filtramos específicamente por 'wingsuite'
    query = """
        SELECT file_name 
        FROM bronze.raw_tms_trips 
        WHERE tms_name = 'wingsuite' 
        ORDER BY ingestion_timestamp DESC 
        LIMIT 1
    """
    
    with Postgres.with_config(ConfigFileLoader(config_path, config_profile)) as loader:
        df_last_file = loader.load(query)
    
    last_timestamp = 0
    if not df_last_file.empty and df_last_file['file_name'].iloc[0]:
        last_file_name = df_last_file['file_name'].iloc[0]
        last_timestamp = extract_timestamp(last_file_name)
        print(f"Último archivo en BD: {last_file_name} (Timestamp: {last_timestamp})")
    else:
        print("No se encontraron registros previos. Procesando todo (Full Backfill).")

    # ---------------------------------------------------------
    # 2. LISTAR ARCHIVOS EN GCS Y FILTRAR
    # ---------------------------------------------------------
    bucket_name = 'sandbox-webcarga' 
    prefix = 'tms/wingsuite/trips/' # Ajustamos el prefijo a la ruta de Wingsuite
    
    gcs_client = GoogleCloudStorage.with_config(ConfigFileLoader(config_path, config_profile)).client
    bucket = gcs_client.bucket(bucket_name)
    
    blobs = bucket.list_blobs(prefix=prefix)
    
    archivos_a_procesar = []
    for blob in blobs:
        # Solo buscamos CSVs
        if not blob.name.lower().endswith('.csv'):
            continue
            
        file_ts = extract_timestamp(blob.name)
        if file_ts > last_timestamp:
            archivos_a_procesar.append(blob)
            
    print(f"Se encontraron {len(archivos_a_procesar)} archivos nuevos para procesar.")
    
    if not archivos_a_procesar:
        return pd.DataFrame() 
        
    # ---------------------------------------------------------
    # 3. DESCARGAR Y CONCATENAR TODOS LOS ARCHIVOS
    # ---------------------------------------------------------
    lista_dfs = []
    
    for blob in archivos_a_procesar:
        gcs_uri = f"gs://{bucket_name}/{blob.name}"
        print(f"Procesando: {gcs_uri}")
        
        file_bytes = blob.download_as_bytes()
        
        # --- LECTURA DEL CSV ---
        try:
            try:
                df = pd.read_csv(io.BytesIO(file_bytes), sep=';', dtype=str)
            except UnicodeDecodeError:
                print(f"Encoding UTF-8 falló para {blob.name}, intentando latin1...")
                df = pd.read_csv(io.BytesIO(file_bytes), sep=';', encoding='latin1', dtype=str)
        except pd.errors.EmptyDataError:
            print(f"Archivo vacío (sin datos), saltando: {blob.name}")
            continue
        
        # Limpieza de cabeceras
        df.columns = df.columns.astype(str).str.strip()

        # Inyectamos Metadata a CADA fila para que el Transformer sepa de dónde viene
        df['_gcs_uri'] = gcs_uri
        
        lista_dfs.append(df)

    # Unimos todo
    df_final = pd.concat(lista_dfs, ignore_index=True)
    df_final = df_final.fillna("")
    
    return df_final

@test
def test_output(output, *args) -> None:
    assert output is not None, 'El output es nulo'