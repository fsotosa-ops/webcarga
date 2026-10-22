"""La descarga Excel de Analítica (HU Analítica, criterios 12 y 13): baja lo que se ve (todas las filas filtradas
del período, las columnas visibles en su orden), con un renglón que dice período, filtros y hora de los datos.
Cada descarga queda en audit_log; una que no se arma (413) no se audita."""
from __future__ import annotations

import io
from collections.abc import Mapping, Sequence
from datetime import date, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from openpyxl import Workbook
from openpyxl.styles import Font

from .analytics_columns import AnalyticsColumn, columns_for
from .analytics_query import EXPORT_MAX_ROWS, AnalyticsRequest, _count, _visibles, build_select, loaded_at
from .audit import log_change

CHILE = ZoneInfo("America/Santiago")
DATE_LABELS = {"planning": "planificación", "delivered": "entrega", "signed": "firma del Cierre", "business": "día"}


def _celda(valor, tipo: str):
    if valor is None:
        return None
    if tipo == "datetime" and isinstance(valor, datetime):
        return valor.astimezone(CHILE).replace(tzinfo=None)
    if tipo == "list":
        return ", ".join(valor)
    if tipo == "bool":
        return "Sí" if valor else "No"
    return valor


def workbook_bytes(header_line: str, columns: Sequence[AnalyticsColumn], rows: Sequence[Mapping]) -> bytes:
    libro = Workbook()
    hoja = libro.active
    hoja.title = "Analítica"
    hoja.append([header_line])
    hoja.append([c.label for c in columns])
    for celda in hoja[2]:
        celda.font = Font(bold=True)
    for fila in rows:
        hoja.append([_celda(fila[c.id], c.type) for c in columns])
    for i, c in enumerate(columns, start=1):
        if c.type in ("date", "datetime"):
            formato = "dd/mm/yyyy" if c.type == "date" else "dd/mm/yyyy hh:mm"
            for (celda,) in hoja.iter_rows(min_row=3, min_col=i, max_col=i):
                celda.number_format = formato
    salida = io.BytesIO()
    libro.save(salida)
    return salida.getvalue()


def _encabezado(req: AnalyticsRequest, cols: Mapping[str, AnalyticsColumn], cargado: datetime | None) -> str:
    def f(d: date) -> str:
        return d.strftime("%d/%m/%Y")
    partes = [f"Período {f(req.date_from)} a {f(req.date_to)} por {DATE_LABELS[req.date_field]}"]
    partes += [f"{cols[k].label}: {', '.join(v)}" for k, v in req.filters.items()]
    if req.q:
        partes.append(f"Búsqueda: {req.q}")
    if cargado:
        partes.append(f"Datos al {cargado.astimezone(CHILE).strftime('%d/%m/%Y %H:%M')}")
    return " · ".join(partes)


async def export_workbook(conn, req: AnalyticsRequest, *, columns: Sequence[str], personal: bool, actor,
                          max_rows: int = EXPORT_MAX_ROWS) -> tuple[bytes, str, int]:
    """Arma el xlsx y registra la descarga. Devuelve (contenido, nombre del archivo, filas)."""
    cols = _visibles(req, personal)
    total = await _count(conn, req, cols)
    if total > max_rows:
        raise HTTPException(413, {"total": total})
    sql, params = build_select(req, personal=personal, columns=columns)
    filas = await conn.fetch(sql, *params)
    elegidas = [cols[c] for c in columns]
    contenido = workbook_bytes(_encabezado(req, cols, await loaded_at(conn)), elegidas, filas)
    await log_change(conn, actor=actor, entity_type="ANALYTICS_EXPORT", entity_id=uuid4(), action="export",
                     new_value={"dataset": req.dataset, "from": req.date_from.isoformat(),
                                "to": req.date_to.isoformat(), "date_field": req.date_field, "filters": req.filters,
                                "q": req.q, "columns": list(columns), "rows": len(filas),
                                "personal": any(c.personal for c in elegidas)})
    nombre = f"analitica_{req.dataset}_{req.date_from.isoformat()}_{req.date_to.isoformat()}.xlsx"
    return contenido, nombre, len(filas)


def personal_requested(dataset: str, columns: Sequence[str]) -> bool:
    personales = {c.id for c in columns_for(dataset, personal=True) if c.personal}
    return bool(personales & set(columns))
