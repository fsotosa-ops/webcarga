"""El registro de revisión de Configuración.

Separa "lo revisamos y va así" de "nadie lo miró todavía", que hasta ahora se
veían igual: la columna vacía. Ver 20260817000000_config_reviews.sql.

LO ÚNICO PROPIO DE CADA DOMINIO ES ENUMERAR SUS ELEMENTOS. Todo lo demás —el
conteo, la insignia, el gesto de confirmar, el filtro— es común. La prueba de
escalabilidad del diseño es ésta: cuando llegue Facturación, sólo se agrega una
fila a `REVISABLES`. Si alguna vez hace falta un `if` por dominio en la portada
o en los endpoints, el diseño se rompió.

Una sección que NO aparece acá simplemente no se revisa (Personas y accesos es
el caso: una cuenta de usuario no es una decisión de configuración que alguien
tenga que confirmar). Es opt-in a propósito.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class Revisable:
    """Una sección cuyos elementos se revisan de a uno."""

    dominio: str
    seccion: str
    #: SQL con CUATRO columnas y un renglón por elemento: `id` (texto, el que
    #: usa el registro de revisión), `label` (cómo se llama en pantalla),
    #: `buscable` (el texto contra el que se busca, que puede incluir el código
    #: además del nombre) y `abre` (lo que va en la URL para abrir ese elemento
    #: en su pantalla, que NO siempre es el id: Condiciones abre por código).
    #: Es un literal escrito acá, nunca entrada del usuario: es lo que permite
    #: componerlo dentro de la consulta de conteo y la de búsqueda.
    #:
    #: Una sola enumeración para las dos cosas, a propósito: dos listas de "qué
    #: elementos tiene esta sección" se separan, y la portada terminaría
    #: contando algo distinto de lo que el buscador encuentra.
    sql: str
    #: El vocabulario de `app.status_taxonomies` que edita esta sección, si es
    #: una de ésas. Se declara porque `PATCH /config/taxonomies/{id}` no sabe
    #: en qué pantalla está parado quien edita: lo único que tiene es el
    #: `domain` de la fila.
    vocabulario: str | None = None


def _taxonomia(dominio: str, seccion: str, vocabulario: str) -> Revisable:
    return Revisable(
        dominio, seccion,
        "SELECT id::text AS id, label, label AS buscable, id::text AS abre "
        f"FROM app.status_taxonomies WHERE domain = '{vocabulario}' AND active",
        vocabulario=vocabulario,
    )


REVISABLES: tuple[Revisable, ...] = (
    # El código es como se nombra un documento entre sistemas: buscar
    # "MANTENCION_FRIO" tiene que encontrarlo igual que buscar "cámara".
    Revisable("certification", "conditions",
              # `abre` es el CÓDIGO y no el id: la pantalla de Condiciones abre
              # su panel con `?doc=<código>`, porque el código es como se nombra
              # un documento entre sistemas y hace el enlace legible.
              "SELECT id::text AS id, name AS label, "
              "name || ' ' || requirement_code AS buscable, "
              "requirement_code AS abre "
              "FROM public.compliance_requirements"),
    Revisable("certification", "expiry-alerts",
              "SELECT doc_type AS id, label, label || ' ' || doc_type AS buscable, "
              "doc_type AS abre FROM app.alert_thresholds"),

    Revisable("operations", "tms-statuses",
              "SELECT id, label, label || ' ' || id AS buscable, id AS abre "
              "FROM app.trip_statuses WHERE active"),
    _taxonomia("operations", "operational-statuses", "OPERATIONAL_STATE"),
    _taxonomia("operations", "equipment-statuses", "EQUIPMENT_STATE"),
    _taxonomia("operations", "driver-reasons", "DRIVER_REASON"),
    _taxonomia("operations", "unassigned-reasons", "TRIP_UNASSIGNED_REASON"),
    Revisable("operations", "temperature-ranges",
              "SELECT cargo_type AS id, label, label || ' ' || cargo_type AS buscable, "
              "cargo_type AS abre FROM app.temperature_ranges"),
    # Los umbrales del monitor son UN formulario, no una lista: su elemento es
    # el formulario entero. Revisarlo es decir "estos siete números están
    # bien", que es exactamente la decisión que hoy no deja rastro.
    Revisable("operations", "alert-thresholds",
              "SELECT 'reglas' AS id, 'Umbrales de alerta' AS label, "
              "'Umbrales de alerta demora detencion sin reportar' AS buscable, "
              "'reglas' AS abre"),

    _taxonomia("fleet", "subtypes", "FLEET_SERVICE_TYPE"),
    _taxonomia("fleet", "operation-types", "WEBCARGA_OPERATION_TYPE"),
)

POR_SECCION = {(r.dominio, r.seccion): r for r in REVISABLES}

# Qué sección edita cada vocabulario de `app.status_taxonomies`. Hace falta
# porque `PATCH /config/taxonomies/{id}` no sabe en qué pantalla está parado
# quien edita: lo único que tiene es el `domain` de la fila.
#
# Sale del MISMO registro y no de una lista escrita al lado: un vocabulario
# que apareciera acá sin estar declarado arriba sería una sección revisable que
# la portada no cuenta — un contador que miente, que es justamente lo que este
# registro viene a arreglar.
SECCION_DE_TAXONOMIA = {
    r.vocabulario: (r.dominio, r.seccion) for r in REVISABLES if r.vocabulario
}


def exigir_seccion(dominio: str, seccion: str) -> Revisable:
    r = POR_SECCION.get((dominio, seccion))
    if r is None:
        conocidas = ", ".join(f"{x.dominio}/{x.seccion}" for x in REVISABLES)
        raise HTTPException(
            422, f"{dominio}/{seccion} no es una sección revisable. Las que sí: {conocidas}"
        )
    return r


def _union_de_elementos(columnas: str) -> str:
    """Todos los elementos configurables de la app, en una sola relación."""
    return "\nUNION ALL\n".join(
        f"SELECT '{r.dominio}' AS domain, '{r.seccion}' AS section, {columnas} "
        f"FROM ({r.sql}) e"
        for r in REVISABLES
    )


SQL_PENDIENTES_POR_DOMINIO = f"""
WITH elementos AS (
{_union_de_elementos("e.id::text AS id")}
)
SELECT e.domain,
       count(*)                                        AS total,
       count(*) FILTER (WHERE r.element_id IS NULL)    AS sin_revisar
  FROM elementos e
  LEFT JOIN app.config_reviews r
         ON r.domain = e.domain AND r.section = e.section AND r.element_id = e.id
 GROUP BY e.domain
"""


async def registrar_revision(conn, dominio: str, seccion: str, element_id: str, usuario_id: str) -> None:
    """Deja constancia de que alguien decidió sobre este elemento.

    GUARDAR CUENTA COMO REVISAR: editar y guardar ES tomar una decisión, así
    que no hace falta un segundo gesto. "Confirmar" existe sólo para el caso
    que hoy no deja rastro — mirarlo y dejarlo como está.

    Se pisa la revisión anterior: lo que interesa es la última decisión, no el
    historial (para eso está `audit_log`)."""
    if (dominio, seccion) not in POR_SECCION:
        return
    await conn.execute(
        """
        INSERT INTO app.config_reviews (domain, section, element_id, reviewed_by, reviewed_at)
        VALUES ($1, $2, $3, $4::uuid, now())
        ON CONFLICT (domain, section, element_id) DO UPDATE
           SET reviewed_by = EXCLUDED.reviewed_by,
               reviewed_at = EXCLUDED.reviewed_at
        """,
        dominio, seccion, str(element_id), usuario_id,
    )


# El buscador sale de la MISMA enumeración: escribir "frío" tiene que encontrar
# la condición de Certificación, el rango de temperatura de Operaciones y el
# subtipo de vehículo, y eso sólo funciona si "qué elementos hay" está definido
# una sola vez.
#
# `unaccent` NO está instalado en esta base (verificado), así que el acento se
# resuelve del lado de la comparación: se normalizan las cinco vocales en los
# dos lados. Buscar "frio" encuentra "Frío" y al revés — que es lo que hace
# alguien apurado escribiendo sin tildes.
_SIN_ACENTO = "translate({texto}, 'áéíóúÁÉÍÓÚüÜ', 'aeiouAEIOUuU')"

SQL_BUSQUEDA = f"""
WITH elementos AS (
{_union_de_elementos("e.id::text AS id, e.label, e.buscable, e.abre::text AS abre")}
)
SELECT domain, section, id, label, abre
  FROM elementos
 WHERE lower({_SIN_ACENTO.format(texto='buscable')})
       LIKE '%' || lower({_SIN_ACENTO.format(texto='$1::text')}) || '%'
 ORDER BY label
 LIMIT 40
"""
