"""La planilla de certificación: una sola definición de sus columnas.

Registrar lo que ya se sabe de un documento **sin adjuntarlo**. Pablo, reunión
del 21/08: *"sería bueno poder subir de alguna forma las fechas nomás. La
información que yo tengo en un Excel. Sin el documento"*.

LOS DOS EJES, QUE NO SE COLAPSAN. Las plataformas de cumplimiento de
proveedores y de flota (ISNetworld, Avetta, Veriforce; Fleetio, Samsara) no
guardan UN estado por requisito sino dos independientes:

  · **evidencia** — ¿tenemos el papel? (Missing / Submitted / Verified)
  · **vigencia**  — ¿está al día?     (Expiration Date)

Por eso la planilla tiene UNA COLUMNA POR EJE, y no una sola que signifique dos
cosas según la fila. Medido en las 39 empresas activas, sobre 2.370 pendientes:
1.326 documentos llevan vencimiento y **1.044 no lo llevan pero son todos
LEGAL_MANDATORY**. Para esos 1.044 la única pregunta posible es la tenencia, y
sin esa columna la mitad del trabajo pendiente no tiene ninguna via de carga.

El reparto por nivel desmiente que esto sea cosa de empresas: de las 1.326 filas
con vencimiento, sólo 168 son de empresa — 767 son de vehículo y 391 de
conductor.

POR QUE LA LLAVE ES EL id_registro Y NO EL RUT. El identificador natural es
distinto en cada nivel: empresa y conductor por `tax_id`, pero el VEHICULO no
tiene RUT y va por patente. Un match por identificador necesitaría tres reglas y
fallaría en los dos bordes medidos: los 5 registros del único conductor sin
`tax_id` de los 87, y las 88 filas que no resuelven a ninguna empresa.

LOS NOMBRES SON LOS DEL RUBRO. `Record ID`, `Entity Type`, `Document Type`,
`Status`, `Expiration Date` son las columnas canónicas de una plantilla de carga
de ISNetworld o Avetta; acá van en español porque la convención del proyecto es
etiqueta en español y ruta en inglés. `documento_recibido` traduce *Submitted /
On file* — deliberadamente NO se llamó "en archivo", que en este sistema
chocaría con el estado `ARCHIVED`, que significa lo contrario.

Esta lista se escribe UNA vez y la consumen la planilla que baja y el parser que
sube. Escribirla dos veces es como este router llegó a tener una lista de
columnas escrita tres veces y un 500 con toda la suite en verde.
"""

COLUMNA_LLAVE = "id_registro"
COLUMNA_TENENCIA = "documento_recibido"
COLUMNA_VENCIMIENTO = "fecha_vencimiento"

COLUMNAS = [
    {"csv_key": COLUMNA_LLAVE,       "label": "Registro",           "editable": False, "ancho": 38},
    {"csv_key": "empresa",           "label": "Empresa",            "editable": False, "ancho": 34},
    {"csv_key": "entidad",           "label": "Entidad",            "editable": False, "ancho": 11},
    {"csv_key": "nombre",            "label": "Nombre",             "editable": False, "ancho": 26},
    {"csv_key": "identificador",     "label": "RUT o patente",      "editable": False, "ancho": 14},
    {"csv_key": "tipo_documento",    "label": "Tipo de documento",  "editable": False, "ancho": 30},
    {"csv_key": "estado_actual",     "label": "Estado actual",      "editable": False, "ancho": 15},
    {"csv_key": COLUMNA_TENENCIA,    "label": "Documento recibido", "editable": True,  "ancho": 20},
    {"csv_key": COLUMNA_VENCIMIENTO, "label": "Fecha de vencimiento", "editable": True, "ancho": 20},
]

COLUMNAS_EDITABLES = [c["csv_key"] for c in COLUMNAS if c["editable"]]

# Lo que se acepta en la columna de tenencia. Se compara en minúsculas y sin
# tildes: la planilla vuelve de Excel, de Google Sheets y de quien la escriba a
# mano, y rechazar un "SI" por la tilde sería culpar a la persona del teclado.
TENENCIA_SI = {"si", "sí", "s", "x", "yes", "true", "1", "recibido"}
TENENCIA_NO = {"no", "n", "false", "0", "falta", "no recibido"}

# `activas` es el default y es lo que pidió Pablo. `todas` suma las 207
# LEGACY_INACTIVE, las 2 INACTIVE y las 88 filas sin empresa — el histórico que
# dijo que NO quería cargar, disponible para quien lo pida a propósito.
ALCANCES = ("activas", "todas")

# El origen queda escrito en la auditoría: `source` ya distingue quién escribió
# (`pre_cierre_auto`, `cierre_viajes`), y una carga de miles de filas tiene que
# poder separarse de una edición a mano cuando alguien audite el módulo.
FUENTE_AUDITORIA = "planilla_certificacion"


def sql_filas_plantilla(pendiente: str) -> str:
    """Las filas de la planilla. `pendiente` es el predicado compartido
    (`pendiente_predicate` de routers/compliance.py) — se recibe en vez de
    escribirse acá para que la planilla y la cola de trabajo no puedan
    divergir: si mañana "pendiente" cambia, cambian las dos juntas.

    $1 = alcance ('activas' | 'todas').

    Las dos columnas editables vienen PRE-LLENADAS con lo que ya hay, así la
    persona ve el estado en vez de escribir a ciegas encima, y al volver, una
    fila cuyo valor no cambió no se cuenta como cambio.

    `fecha_vencimiento` sale vacía en los documentos que no vencen, y el parser
    rechaza que se les escriba una. No se los deja fuera de la planilla: son
    1.044 filas, TODAS obligatorias, y su pregunta —la tenencia— es la otra
    columna.
    """
    return f"""
WITH pendientes AS (
    SELECT cr.id, cr.entity_type, cr.entity_id, cr.status, cr.expiration_date,
           cr.file_url IS NOT NULL AS tiene_archivo,
           req.name AS tipo_documento, req.has_expiration
    FROM public.compliance_records cr
    JOIN public.compliance_requirements req ON req.id = cr.requirement_id
    WHERE cr.is_current = true
      AND req.is_active = true
      AND {pendiente}
),
resueltas AS (
    SELECT p.*,
        CASE p.entity_type
            WHEN 'CARRIER' THEN p.entity_id
            WHEN 'DRIVER'  THEN da.carrier_id
            WHEN 'ASSET'   THEN aa.carrier_id
        END AS carrier_id,
        CASE p.entity_type
            WHEN 'CARRIER' THEN 'Empresa'
            WHEN 'DRIVER'  THEN 'Conductor'
            ELSE 'Vehículo'
        END AS entidad,
        CASE p.entity_type
            WHEN 'DRIVER' THEN d.full_name
            WHEN 'ASSET'  THEN a.license_plate
        END AS nombre_alt,
        -- El vehículo no tiene RUT: su identificador ES la patente.
        CASE p.entity_type
            WHEN 'DRIVER' THEN d.tax_id
            WHEN 'ASSET'  THEN a.license_plate
        END AS ident_alt
    FROM pendientes p
    LEFT JOIN public.driver_assignments da
        ON p.entity_type = 'DRIVER' AND da.driver_id = p.entity_id AND da.status = 'ACTIVE'
    LEFT JOIN public.asset_assignments aa
        ON p.entity_type = 'ASSET' AND aa.asset_id = p.entity_id AND aa.status = 'ACTIVE'
    LEFT JOIN public.drivers d ON p.entity_type = 'DRIVER' AND d.id = p.entity_id
    LEFT JOIN public.assets  a ON p.entity_type = 'ASSET'  AND a.id = p.entity_id
)
SELECT r.id::text                                   AS {COLUMNA_LLAVE},
       COALESCE(c.business_name, '')                AS empresa,
       r.entidad,
       -- Vacío a propósito en las filas de empresa: la columna `empresa` ya lo
       -- dice, y repetirlo gasta un tercio de la planilla en eco.
       COALESCE(r.nombre_alt, '')                   AS nombre,
       COALESCE(r.ident_alt, c.tax_id, '')          AS identificador,
       r.tipo_documento,
       -- "Falta" significaba dos cosas. Acá se separan igual que en pantalla.
       CASE
           WHEN r.status = 'MISSING' AND r.expiration_date IS NOT NULL AND NOT r.tiene_archivo
                THEN 'Falta el archivo'
           WHEN r.status = 'MISSING'  THEN 'Falta'
           WHEN r.status = 'EXPIRED'  THEN 'Vencido'
           WHEN r.status = 'REJECTED' THEN 'Rechazado'
           WHEN r.expiration_date IS NOT NULL AND r.expiration_date < CURRENT_DATE THEN 'Vencido'
           ELSE 'Recibido'
       END                                          AS estado_actual,
       -- Sólo se pre-llena lo que esta columna PUEDE expresar. `EXPIRED`,
       -- `REJECTED`, `PENDING_REVIEW` y `ARCHIVED` no son ni "sí" ni "no": si
       -- se los mapeara a uno de los dos, bajar la planilla y volver a subirla
       -- SIN TOCARLA los convertiría en silencio —un rechazado pasaría a
       -- faltante, un vencido a recibido—. En blanco significa "no se toca",
       -- que es la verdad. Hoy son 0 filas; se escribe así para que sigan
       -- siendo 0 problemas cuando aparezca la primera.
       CASE r.status
           WHEN 'MISSING'         THEN 'No'
           WHEN 'APPROVED'        THEN 'Sí'
           WHEN 'APPROVED_MANUAL' THEN 'Sí'
           ELSE ''
       END                                          AS {COLUMNA_TENENCIA},
       -- Los que no vencen van en blanco: no hay fecha que declarar, y el
       -- parser rechaza que se les escriba una.
       CASE WHEN r.has_expiration
            THEN COALESCE(to_char(r.expiration_date, 'DD-MM-YYYY'), '')
            ELSE '' END                             AS {COLUMNA_VENCIMIENTO},
       -- No es una columna de la planilla: el escritor sólo emite las claves de
       -- COLUMNAS. Viaja para que el resumen pueda decir cuántas filas son de
       -- cada eje sin volver a consultar la base.
       r.has_expiration                             AS lleva_vencimiento
FROM resueltas r
LEFT JOIN public.carriers c ON c.id = r.carrier_id
-- 'activas' descarta por construcción las filas sin empresa (c es NULL), que
-- son 88: 48 vehículos y 40 conductores sin asignación activa. Son trabajo real
-- pero no son de nadie todavía, y meterlos en la planilla de las 39 empresas
-- activas es ruido. Salen con alcance='todas'.
WHERE ($1::text = 'todas' OR c.operational_status = 'ACTIVE')
-- Bloques contiguos: quien llena una empresa trabaja seguido y no salta por el
-- archivo. El orden de `entidad` es el del negocio, no el alfabético.
ORDER BY c.business_name NULLS LAST,
         CASE r.entidad WHEN 'Empresa' THEN 0 WHEN 'Conductor' THEN 1 ELSE 2 END,
         COALESCE(r.nombre_alt, ''),
         r.tipo_documento
"""


# LA ESCRITURA ES UNA SOLA SENTENCIA, Y NO ES UNA OPTIMIZACIÓN.
#
# `trg_refresh_view_on_compliance` ejecuta REFRESH MATERIALIZED VIEW
# CONCURRENTLY POR STATEMENT sobre public.compliance_records. Fila por fila,
# 2.370 filas son 2.370 refrescos de vista materializada. Y el camino de a una
# cuesta el doble: `record_manual_edit()` hace un SEGUNDO UPDATE sobre la misma
# tabla para marcar is_manual_override, así que dispara el trigger otra vez.
#
# Por eso acá el marcado de override viaja DENTRO del mismo UPDATE, y la
# auditoría se inserta aparte — audit_log no tiene ese trigger.
#
# `status` y `expiration_date` se escriben con COALESCE sobre el valor nuevo:
# una fila que sólo declara tenencia no toca la fecha, y una que sólo declara
# fecha no toca el estado. Son dos ejes y se mueven por separado.
SQL_APLICAR = """
UPDATE public.compliance_records cr
SET status             = COALESCE(v.estado, cr.status),
    expiration_date    = COALESCE(v.vence, cr.expiration_date),
    is_manual_override = true,
    overridden_by      = $4::uuid,
    overridden_at      = now(),
    updated_at         = now()
FROM unnest($1::uuid[], $2::text[], $3::date[]) AS v(id, estado, vence)
WHERE cr.id = v.id AND cr.is_current = true
RETURNING cr.id::text AS id_registro
"""

# Un renglón de auditoría por campo cambiado, también en una sola sentencia.
# `to_jsonb(text)` produce exactamente lo mismo que el json.dumps() de
# log_change() para un escalar, así que estas filas son indistinguibles de las
# que escribe una edición de a una — se leen con la misma consulta.
SQL_AUDITAR = """
INSERT INTO public.audit_log
    (actor, entity_type, entity_id, action, field, old_value, new_value, source)
SELECT $1::uuid, v.entity_type, v.entity_id::uuid, 'update', v.campo,
       to_jsonb(v.antes), to_jsonb(v.despues), $7::text
FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
     AS v(entity_type, entity_id, campo, antes, despues)
"""
