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
    #: SQL que devuelve UNA columna `id` de texto, un renglón por elemento.
    #: Es un literal escrito acá, nunca entrada del usuario: es lo que permite
    #: componerlo dentro de la consulta de conteo.
    sql: str
    #: El vocabulario de `app.status_taxonomies` que edita esta sección, si es
    #: una de ésas. Se declara porque `PATCH /config/taxonomies/{id}` no sabe
    #: en qué pantalla está parado quien edita: lo único que tiene es el
    #: `domain` de la fila.
    vocabulario: str | None = None


def _taxonomia(dominio: str, seccion: str, vocabulario: str) -> Revisable:
    return Revisable(
        dominio, seccion,
        "SELECT id::text AS id FROM app.status_taxonomies "
        f"WHERE domain = '{vocabulario}' AND active",
        vocabulario=vocabulario,
    )


REVISABLES: tuple[Revisable, ...] = (
    Revisable("certification", "conditions",
              "SELECT id::text AS id FROM public.compliance_requirements"),
    Revisable("certification", "expiry-alerts",
              "SELECT doc_type AS id FROM app.alert_thresholds"),

    Revisable("operations", "tms-statuses",
              "SELECT id FROM app.trip_statuses WHERE active"),
    _taxonomia("operations", "operational-statuses", "OPERATIONAL_STATE"),
    _taxonomia("operations", "equipment-statuses", "EQUIPMENT_STATE"),
    _taxonomia("operations", "driver-reasons", "DRIVER_REASON"),
    Revisable("operations", "temperature-ranges",
              "SELECT cargo_type AS id FROM app.temperature_ranges"),
    # Los umbrales del monitor son UN formulario, no una lista: su elemento es
    # el formulario entero. Revisarlo es decir "estos siete números están
    # bien", que es exactamente la decisión que hoy no deja rastro.
    Revisable("operations", "alert-thresholds", "SELECT 'reglas' AS id"),

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


def _union_de_elementos() -> str:
    """Todos los elementos revisables de la app, en una sola relación."""
    return "\nUNION ALL\n".join(
        f"SELECT '{r.dominio}' AS domain, '{r.seccion}' AS section, e.id::text AS id "
        f"FROM ({r.sql}) e"
        for r in REVISABLES
    )


SQL_PENDIENTES_POR_DOMINIO = f"""
WITH elementos AS (
{_union_de_elementos()}
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
