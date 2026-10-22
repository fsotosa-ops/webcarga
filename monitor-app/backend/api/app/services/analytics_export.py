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
from fastapi.concurrency import run_in_threadpool
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
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
    """Modo `write_only` (fix pass de la revisión, 22/10): escribe fila a fila sin guardar la hoja entera en
    memoria; con 50.000 × 40 celdas el modo normal se acercaba al límite de 512 MiB de la API."""
    libro = Workbook(write_only=True)
    hoja = libro.create_sheet("Analítica")
    hoja.append([header_line])
    encabezado = []
    for c in columns:
        celda = WriteOnlyCell(hoja, value=c.label)
        celda.font = Font(bold=True)
        encabezado.append(celda)
    hoja.append(encabezado)
    formatos = {c.id: ("dd/mm/yyyy" if c.type == "date" else "dd/mm/yyyy hh:mm")
                for c in columns if c.type in ("date", "datetime")}
    for fila in rows:
        salida_fila = []
        for c in columns:
            valor = _celda(fila[c.id], c.type)
            if c.id in formatos and valor is not None:
                celda = WriteOnlyCell(hoja, value=valor)
                celda.number_format = formatos[c.id]
                salida_fila.append(celda)
            else:
                salida_fila.append(valor)
        hoja.append(salida_fila)
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
    # Fuera del bucle de eventos: armar el archivo es CPU y bloqueaba todas las demás consultas de la instancia.
    contenido = await run_in_threadpool(workbook_bytes, _encabezado(req, cols, await loaded_at(conn)), elegidas, filas)
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
