"""El cliente del viaje, en un solo lugar (spec 2026-10-11).

El viaje guarda el ID de su cliente del directorio (app.trips.shipper_id,
calculado por dbt). Toda consulta cruza por ese ID con `join_cliente`, y lo que
se muestra sale de `nombre_del_cliente`. Antes, 22 lugares cruzaban comparando
el texto en minúsculas, y renombrar un cliente los dejaba sin cliente.

`client_name` (el texto del TMS o del alta) se conserva: es parte del ID del
viaje. Solo se muestra cuando el viaje no tiene cliente vinculado."""
from fastapi import HTTPException

JOIN_CLIENTE = "LEFT JOIN public.shippers sh ON sh.id = t.shipper_id"


def join_cliente(t: str = "t", sh: str = "sh") -> str:
    return f"LEFT JOIN public.shippers {sh} ON {sh}.id = {t}.shipper_id"


def nombre_del_cliente(t: str = "t", sh: str = "sh") -> str:
    """El nombre que se muestra: el del directorio. Un viaje sin cliente vinculado
    (un cliente nuevo del TMS) se ve con su texto y la marca, nunca desaparece."""
    return f"COALESCE({sh}.name, {t}.client_name || ' · sin vincular')"


async def resolver_cliente(conn, *, shipper_id: str | None, client_name: str | None) -> tuple[str, str]:
    """El cliente de un alta manual, contra el directorio: por ID (el formulario) o
    por nombre sin distinguir mayúsculas (la carga masiva CSV). Nada se guarda sin
    calzar con el directorio."""
    if shipper_id:
        fila = await conn.fetchrow(
            "SELECT id::text AS id, name FROM public.shippers WHERE id = $1::uuid AND status = 'ACTIVE'",
            shipper_id)
        if not fila:
            raise HTTPException(422, "El cliente elegido no está en el directorio")
        return fila["id"], fila["name"]
    nombre = (client_name or "").strip()
    if not nombre:
        raise HTTPException(422, "Elige el cliente del viaje")
    fila = await conn.fetchrow(
        "SELECT id::text AS id, name FROM public.shippers "
        "WHERE lower(btrim(name)) = lower(btrim($1)) AND status = 'ACTIVE'",
        nombre)
    if not fila:
        raise HTTPException(422, f"El cliente «{nombre}» no está en el directorio")
    return fila["id"], fila["name"]


async def texto_del_cliente_en_el_tms(conn, *, source_system: str, shipper_id: str) -> str | None:
    """Cómo escribe ese TMS al cliente del directorio, según la correspondencia.
    El id canónico de un viaje (md5(tms|cliente|nº), stg_*_trips) usa ese texto:
    un viaje manual que se va a reconciliar con el TMS tiene que calcularlo igual,
    aunque el cliente se haya renombrado en el directorio. None si ese TMS todavía
    no tiene a ese cliente; 422 si lo tiene con más de un nombre, porque no hay
    forma de saber cuál va a reportar."""
    textos = [r["source_client"] for r in await conn.fetch(
        "SELECT source_client FROM app.tms_client_shippers WHERE source_system = $1 AND shipper_id = $2::uuid",
        source_system, shipper_id)]
    if len(textos) > 1:
        raise HTTPException(
            422, f"Ese cliente tiene más de un nombre en {source_system} ({', '.join(textos)}); "
                 "regístralo sin TMS o deja uno solo en Configuración › Clientes del TMS")
    return textos[0] if textos else None
