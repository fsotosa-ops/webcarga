"""Identidad de RUT y patente: una sola forma, igual en Python y en la base.

La definición son las funciones de Postgres public.canonical_rut y
public.canonical_plate (migración 20260817120000_identidad_canonica.sql). Este
módulo las espeja para el motor de match, que es puro y no toca la base. La
paridad caso por caso la prueba test_identity_integration.py: si alguien
cambia una de las dos mitades, ese test se pone rojo.

  RUT      NNNNNNNN-D  cuerpo de 7 u 8 dígitos (8 o 9 caracteres con DV), DV por
                       módulo 11; uno inválido es None, nunca se le inventa el DV.
  Patente  AAAA99      exactamente 6 alfanuméricos; fuera guiones, espacios y adornos.

Los buscadores comparan en SQL con rut_matches_sql/plate_matches_sql: la
igualdad canónica y, para buscar con un pedazo, la clave del texto (C-R12).
carriers.tax_id NO es canónico por construcción (no tiene CHECK): por eso
siempre se compara con canonical_rut(columna). Normalizar lo guardado es D3."""
from __future__ import annotations

import re

_NOT_RUT_CHAR = re.compile(r"[^0-9kK]")
_NOT_PLATE_CHAR = re.compile(r"[^A-Za-z0-9]")
_ASCII_DIGITS = re.compile(r"[0-9]+")
_PLATE = re.compile(r"[A-Z0-9]{6}")

RUT_SEARCH_MIN = 4
PLATE_SEARCH_MIN = 2


def rut_check_digit(body: str) -> str:
    """Dígito verificador chileno (módulo 11) del cuerpo, sin puntos ni guion."""
    total, multiplier = 0, 2
    for digit in reversed(body):
        total += int(digit) * multiplier
        multiplier = 2 if multiplier == 7 else multiplier + 1
    remainder = 11 - (total % 11)
    return "0" if remainder == 11 else "K" if remainder == 10 else str(remainder)


def canonical_rut(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = _NOT_RUT_CHAR.sub("", value).upper()
    if not 8 <= len(stripped) <= 9:
        return None
    body, dv = stripped[:-1], stripped[-1]
    if not _ASCII_DIGITS.fullmatch(body):   # la K solo puede ser DV
        return None
    if rut_check_digit(body) != dv:
        return None
    return f"{body}-{dv}"


def canonical_plate(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = _NOT_PLATE_CHAR.sub("", value).upper()
    return stripped if _PLATE.fullmatch(stripped) else None


def plate_in_tokens(plate: str | None, tokens: list[str]) -> bool:
    """La patente aparece como tokens CONTIGUOS completos: 'BBCL-23', 'BBCL 23'
    y 'bbcl23' son BBCL23. Unir solo tokens enteros evita encontrarla dentro
    de una secuencia más larga ('XBBCL234')."""
    canon = canonical_plate(plate)
    if canon is None:
        return False
    for i in range(len(tokens)):
        joined = ""
        for token in tokens[i:]:
            joined += token.upper()
            if len(joined) >= len(canon):
                break
        if joined == canon:
            return True
    return False


def _rut_key_sql(expr: str) -> str:
    return f"upper(regexp_replace({expr}, '[^0-9kK]', '', 'g'))"


def _plate_key_sql(expr: str) -> str:
    return f"upper(regexp_replace({expr}, '[^A-Za-z0-9]', '', 'g'))"


def rut_matches_sql(column: str, param: str) -> str:
    """El RUT de `column` calza con el texto buscado `param` (placeholder $n):
    igual en forma canónica, o contiene la clave buscada (búsqueda con un
    pedazo). La clave solo aplica si el texto no trae letras distintas de K y
    tiene al menos RUT_SEARCH_MIN caracteres: 'Transportes 2000' no busca RUT."""
    p = f"{param}::text"
    key = _rut_key_sql(p)
    return (f"(public.canonical_rut({column}) = public.canonical_rut({p}) "
            f"OR ({p} !~ '[A-JL-Za-jl-z]' AND length({key}) >= {RUT_SEARCH_MIN} "
            f"AND {_rut_key_sql(column)} LIKE '%' || {key} || '%'))")


def plate_matches_sql(column: str, param: str) -> str:
    """La patente de `column` calza con el texto buscado: igual en forma
    canónica, o contiene la clave alfanumérica (mínimo PLATE_SEARCH_MIN)."""
    p = f"{param}::text"
    key = _plate_key_sql(p)
    return (f"(public.canonical_plate({column}) = public.canonical_plate({p}) "
            f"OR (length({key}) >= {PLATE_SEARCH_MIN} AND {_plate_key_sql(column)} LIKE '%' || {key} || '%'))")
