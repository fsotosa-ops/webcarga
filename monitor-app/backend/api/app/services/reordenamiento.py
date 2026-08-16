"""Mover un elemento una posición dentro de una lista que un humano ordena.

Antes esto se hacía desde el navegador con DOS PATCH seguidos: el primero
escribía el `sort_order` del vecino sobre el elemento, el segundo el del
elemento sobre el vecino. Si el segundo no llegaba —red caída, 500, la pestaña
cerrada en el medio— los dos quedaban con el mismo número, y ese empate no se
podía deshacer desde la pantalla: la lista mostraba dos filas intercambiables
en un orden que dependía de cómo las devolviera Postgres esa vez.

Acá el movimiento es UNA transacción: o se mueven los dos o no se mueve
ninguno. Y como el alcance entero se renumera `1..n` sobre el orden canónico,
después del primer movimiento el empate deja de ser representable — no se
arregla el empate, se elimina la forma de crearlo.

El `sort_order` salió a propósito de los dos PATCH (`TripStatusPatch`,
`StatusTaxonomyPatch`): mientras un cliente pueda escribir un número
arbitrario, el empate vuelve a ser alcanzable por otro camino.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel

ARRIBA = "up"
ABAJO = "down"
DIRECCIONES = (ARRIBA, ABAJO)


class MovimientoBody(BaseModel):
    """Una posición arriba o una abajo. No un número: el destino lo decide la
    lista, no el cliente. Vive acá y no en un router porque las dos pantallas
    que reordenan mandan exactamente esto."""

    direction: Literal[ARRIBA, ABAJO]


@dataclass(frozen=True)
class ListaOrdenada:
    """Una tabla cuyo orden de presentación se edita a mano.

    Los campos son literales escritos acá, nunca entrada del usuario: es lo
    que permite interpolarlos en el SQL sin abrir una inyección."""

    #: Tabla calificada por esquema.
    tabla: str
    #: El ORDER BY que define quién está al lado de quién. Tiene que ser TOTAL:
    #: si dos filas empatan en todo lo que nombra, "subir" no tiene un destino
    #: único y el resultado depende del plan de Postgres.
    orden: str
    #: Cómo se compara el id contra el parámetro. La taxonomía lo tiene `uuid`
    #: y el id llega como texto desde la ruta.
    id_sql: str = "$1"
    #: Columna que acota el alcance: los vecinos de un estado operacional son
    #: los de su mismo dominio, no los de los otros cinco vocabularios.
    #: None = la tabla entera es un solo alcance.
    ambito: str | None = None
    #: Lo que hay que tocar además del `sort_order` al escribir.
    ademas: str = ""


ESTADOS_DEL_TABLERO = ListaOrdenada(
    tabla="app.trip_statuses",
    # El id es el nombre del estado en el TMS: único y estable, sirve de
    # desempate para que el orden sea total.
    orden="sort_order, id",
)

TAXONOMIAS = ListaOrdenada(
    tabla="app.status_taxonomies",
    # Mismo orden que usa GET /config/taxonomies. Si divergieran, la lista que
    # se ve y la lista contra la que se mueve serían dos.
    orden="sort_order, created_at, id",
    id_sql="$1::uuid",
    ambito="domain",
    ademas=", updated_at = NOW()",
)


async def mover_una_posicion(conn, lista: ListaOrdenada, ident: str, direccion: str) -> None:
    """Intercambia el elemento con su vecino, dentro de la transacción de `conn`.

    `conn` tiene que venir ya adentro de una transacción: esta función no la
    abre ni la confirma, justamente para que el llamador no pueda dejar el
    intercambio a medias."""
    if direccion not in DIRECCIONES:
        raise HTTPException(422, f"direction debe ser uno de {DIRECCIONES}")

    columnas = "sort_order" + (f", {lista.ambito}" if lista.ambito else "")
    fila = await conn.fetchrow(
        f"SELECT {columnas} FROM {lista.tabla} WHERE id = {lista.id_sql}", ident
    )
    if fila is None:
        raise HTTPException(404, "No encontrado")

    # El alcance completo, bloqueado EN EL ORDEN CANÓNICO. Bloquear todo el
    # alcance —y no sólo las dos filas que se van a tocar— es lo que hace que
    # dos movimientos simultáneos no se traben entre sí: todos toman los
    # candados en la misma secuencia.
    if lista.ambito:
        filas = await conn.fetch(
            f"SELECT id::text AS id, sort_order FROM {lista.tabla} "
            f"WHERE active = true AND {lista.ambito} = $1 "
            f"ORDER BY {lista.orden} FOR UPDATE",
            fila[lista.ambito],
        )
    else:
        filas = await conn.fetch(
            f"SELECT id::text AS id, sort_order FROM {lista.tabla} "
            f"WHERE active = true ORDER BY {lista.orden} FOR UPDATE"
        )

    posiciones = [r["id"] for r in filas]
    if ident not in posiciones:
        # Existe pero no está activo: no tiene lugar en la lista que se ve.
        raise HTTPException(409, "El elemento no está activo: no ocupa un lugar en la lista")

    i = posiciones.index(ident)
    j = i - 1 if direccion == ARRIBA else i + 1
    if not 0 <= j < len(posiciones):
        raise HTTPException(409, "Ya está en el extremo de la lista")

    posiciones[i], posiciones[j] = posiciones[j], posiciones[i]

    # Se renumera 1..n, pero SÓLO se escriben las filas cuyo número cambia: con
    # el orden ya contiguo son exactamente dos, y `updated_at` no miente sobre
    # las otras veintitrés.
    actual = {r["id"]: r["sort_order"] for r in filas}
    for numero, quien in enumerate(posiciones, start=1):
        if actual[quien] != numero:
            await conn.execute(
                f"UPDATE {lista.tabla} SET sort_order = $2{lista.ademas} "
                f"WHERE id = {lista.id_sql}",
                quien,
                numero,
            )
