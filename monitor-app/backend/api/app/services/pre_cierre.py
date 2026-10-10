"""HU-02 (Cierre del Día): pre-cierre — corrige lo que el sistema puede resolver
con confianza (Tipo A) y avisa lo que no (Tipo B).

Desde la spec 2026-10-10 son dos caminos:

- `aplicar_correcciones` (Tipo A) corre DENTRO de `cierre_lineas.recalcular_en`,
  con el período tomado y el origen de la escritura declarado, así que sus
  escrituras no vuelven a encolar el día. Lee las señales por conjuntos (un
  número fijo de consultas) y escribe en lote.
- `avisos_del_dia` (Tipo B y lo resuelto solo) es lectura pura: la usan el GET
  de daily-closures y la firma.

Las reglas no cambiaron con eso; viven en `clasificar`, que es pura. MISMATCH
sigue siendo la red para lo que el Tipo A decide NO tocar (señal ambigua, ver
`_single_value`): Tipo A resuelve lo claro, MISMATCH atrapa lo que queda.

Las correcciones Tipo A se auditan con `source='pre_cierre_auto'` y NUNCA fijan
`is_manual_override`: un falso positivo tiene que poder autocorregirse con una
señal nueva, no quedar fijado para siempre.

Hallazgo verificado contra producción (2026-08-02): `transporter_name_tms` es una
variante de "WEBCARGA" en ~3270 de ~3280 viajes — WebCarga opera la plataforma,
no es una empresa transportista, así que ese valor nunca dispara una
reasignación (`_looks_like_webcarga_itself`).
"""
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date as _date

from .audit import auditar_en_lote


def _normalize(value: str | None) -> str:
    if not value:
        return ""
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", value).strip().upper()


def _looks_like_webcarga_itself(tms_carrier_name: str) -> bool:
    return "WEBCARGA" in _normalize(tms_carrier_name)


def _single_value(values: list[str]) -> str | None:
    """Señal usable solo si TODOS los viajes de la ventana coinciden para esa
    patente/RUT — un solo viaje discrepante es ambiguo, no se auto-resuelve
    (queda para que MISMATCH lo atrape).

    Desde el fix multi-día la ventana ya no es "hoy": incluye los viajes
    abiertos de días anteriores. Medido sobre el 2026-08-14, eso SUMA 2
    patentes con señal usable (32 → 34) y no le quita la señal a ninguna,
    o sea el ensanche no vuelve más conservador al Tipo A."""
    distinct = {v for v in values if v}
    return next(iter(distinct)) if len(distinct) == 1 else None


FUENTE = "pre_cierre_auto"
ESCALACIONES = (
    "PATENTE_NO_REGISTRADA", "EMPRESA_NO_RECONOCIDA", "CONDUCTOR_NO_REGISTRADO",
    "EMPRESA_ONBOARDING", "SIN_TIPO_OPERACION", "CONDUCTOR_SIN_EMPRESA",
)


@dataclass(frozen=True)
class Patente:
    plate: str
    carrier_names: list[str]
    asset_id: str | None
    carrier_id: str | None
    carrier_name: str | None
    is_manual_override: bool


@dataclass(frozen=True)
class Conductor:
    rut: str
    es_canonico: bool
    names: list[str]
    driver_id: str | None
    full_name: str | None
    is_manual_override: bool


@dataclass(frozen=True)
class ParCliente:
    plate: str
    client_name: str


@dataclass(frozen=True)
class Senales:
    patentes: list[Patente]
    conductores: list[Conductor]
    pares_cliente: list[ParCliente]
    # clave = upper(trim(business_name)) → [(id, business_name)]
    empresas_por_clave: dict[str, list[tuple[str, str]]]
    # clave = upper(trim(name)) → (id, name); el primero, como el fetchrow de antes
    clientes_por_clave: dict[str, tuple[str, str]]
    vinculos_activos: set[tuple[str, str]]
    nombres_empresa: dict[str, str]


@dataclass(frozen=True)
class Reasignacion:
    plate: str
    asset_id: str
    old_carrier_id: str
    old_name: str
    new_carrier_id: str
    new_name: str


@dataclass(frozen=True)
class Renombre:
    rut: str
    driver_id: str
    old_name: str
    new_name: str


@dataclass(frozen=True)
class Vinculo:
    carrier_id: str
    carrier_name: str | None
    shipper_id: str
    shipper_name: str


@dataclass
class Clasificacion:
    reasignaciones: list[Reasignacion] = field(default_factory=list)
    renombres: list[Renombre] = field(default_factory=list)
    vinculos: list[Vinculo] = field(default_factory=list)
    carrier_por_patente: dict[str, str] = field(default_factory=dict)
    escalations: dict[str, list[dict]] = field(default_factory=lambda: {k: [] for k in ESCALACIONES})


def clasificar(s: Senales) -> Clasificacion:
    """Las reglas de siempre (Tipo A corrige lo claro, Tipo B avisa), sin E/S."""
    c = Clasificacion()

    for p in s.patentes:
        tms_carrier_name = _single_value(p.carrier_names)
        if not p.asset_id:
            c.escalations["PATENTE_NO_REGISTRADA"].append({
                "tractor_plate": p.plate, "reason": "La patente no existe en public.assets",
                "tms_carrier_name": tms_carrier_name,
            })
            continue
        if not p.carrier_id:
            c.escalations["PATENTE_NO_REGISTRADA"].append({
                "tractor_plate": p.plate, "reason": "La patente existe pero no tiene empresa asignada",
                "tms_carrier_name": tms_carrier_name,
            })
            continue
        c.carrier_por_patente[p.plate] = p.carrier_id
        tms_name = tms_carrier_name
        if not tms_name or _looks_like_webcarga_itself(tms_name):
            continue
        if _normalize(tms_name) == _normalize(p.carrier_name):
            continue
        if p.is_manual_override:
            continue
        candidatos = s.empresas_por_clave.get(_normalize(tms_name), [])
        if len(candidatos) != 1:
            c.escalations["EMPRESA_NO_RECONOCIDA"].append({
                "tractor_plate": p.plate, "tms_carrier_name": tms_name,
                "directory_carrier_name": p.carrier_name, "directory_carrier_id": str(p.carrier_id),
            })
            continue
        nuevo_id, nuevo_nombre = candidatos[0]
        c.reasignaciones.append(Reasignacion(
            plate=p.plate, asset_id=p.asset_id, old_carrier_id=p.carrier_id, old_name=p.carrier_name,
            new_carrier_id=nuevo_id, new_name=nuevo_nombre,
        ))
        c.carrier_por_patente[p.plate] = nuevo_id

    for d in s.conductores:
        if not d.es_canonico:
            c.escalations["CONDUCTOR_NO_REGISTRADO"].append(
                {"driver_rut": d.rut, "reason": "El TMS informó un RUT que no es válido"})
            continue
        tms_name = _single_value(d.names)
        if not d.driver_id:
            c.escalations["CONDUCTOR_NO_REGISTRADO"].append({"driver_rut": d.rut, "driver_name_tms": tms_name})
            continue
        if not tms_name or d.is_manual_override:
            continue
        if _normalize(tms_name) == _normalize(d.full_name):
            continue
        c.renombres.append(Renombre(rut=d.rut, driver_id=d.driver_id, old_name=d.full_name,
                                    new_name=tms_name.strip()))

    vistos: set[tuple[str, str]] = set()
    for par in s.pares_cliente:
        carrier_id = c.carrier_por_patente.get(par.plate)
        if not carrier_id:
            continue
        cliente = s.clientes_por_clave.get(_normalize(par.client_name))
        if not cliente:
            continue
        shipper_id, shipper_name = cliente
        clave = (carrier_id, shipper_id)
        if clave in s.vinculos_activos or clave in vistos:
            continue
        vistos.add(clave)
        nombre = s.nombres_empresa.get(carrier_id)
        c.vinculos.append(Vinculo(carrier_id=carrier_id, carrier_name=nombre,
                                  shipper_id=shipper_id, shipper_name=shipper_name))
    return c


_SQL_PATENTES = """
WITH p AS (
    SELECT upper(trim(t.fleet->>'tractor_plate')) AS plate,
           array_agg(t.fleet->>'transporter_name_tms') AS carrier_names
    FROM app.trips t
    WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND t.fleet->>'tractor_plate' IS NOT NULL
    GROUP BY 1
)
SELECT p.plate, p.carrier_names, a.id::text AS asset_id,
       asg.carrier_id::text AS carrier_id, asg.business_name AS carrier_name,
       COALESCE(asg.is_manual_override, false) AS is_manual_override
FROM p
LEFT JOIN LATERAL (
    SELECT id FROM public.assets WHERE upper(trim(license_plate)) = p.plate LIMIT 1
) a ON true
LEFT JOIN LATERAL (
    SELECT aa.carrier_id, c.business_name, aa.is_manual_override
    FROM public.asset_assignments aa JOIN public.carriers c ON c.id = aa.carrier_id
    WHERE aa.asset_id = a.id AND aa.status = 'ACTIVE' LIMIT 1
) asg ON true
"""

# La llave del GROUP BY es el RUT canónico cuando existe, y el crudo cuando no
# (27/08): dos formatos del mismo RUT colapsan en un caso.
_SQL_CONDUCTORES = """
WITH r AS (
    SELECT COALESCE(public.canonical_rut(t.fleet->>'driver_rut_tms'),
                    upper(trim(t.fleet->>'driver_rut_tms'))) AS rut,
           bool_or(public.canonical_rut(t.fleet->>'driver_rut_tms') IS NOT NULL) AS es_canonico,
           array_agg(t.fleet->>'driver_name_tms') AS names
    FROM app.trips t
    WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND t.fleet->>'driver_rut_tms' IS NOT NULL
      AND trim(t.fleet->>'driver_rut_tms') != ''
    GROUP BY 1
)
SELECT r.rut, r.es_canonico, r.names, d.id::text AS driver_id, d.full_name,
       COALESCE(d.is_manual_override, false) AS is_manual_override
FROM r
LEFT JOIN LATERAL (
    SELECT id, full_name, is_manual_override FROM public.drivers WHERE tax_id = r.rut LIMIT 1
) d ON r.es_canonico
"""

_SQL_PARES_CLIENTE = """
SELECT DISTINCT upper(trim(t.fleet->>'tractor_plate')) AS plate, t.client_name
FROM app.trips t
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND t.fleet->>'tractor_plate' IS NOT NULL
  AND t.client_name IS NOT NULL
"""


async def leer_senales(conn, fecha: _date) -> Senales:
    """Todas las señales del día en un número fijo de consultas (antes, ~4 por fila)."""
    patentes = [Patente(**dict(r)) for r in await conn.fetch(_SQL_PATENTES, fecha)]
    conductores = [Conductor(**dict(r)) for r in await conn.fetch(_SQL_CONDUCTORES, fecha)]
    pares = [ParCliente(**dict(r)) for r in await conn.fetch(_SQL_PARES_CLIENTE, fecha)]

    claves_empresa = sorted({_normalize(n) for p in patentes if (n := _single_value(p.carrier_names))})
    empresas: dict[str, list[tuple[str, str]]] = {}
    for r in await conn.fetch(
        "SELECT id::text AS id, business_name, upper(trim(business_name)) AS clave "
        "FROM public.carriers WHERE upper(trim(business_name)) = ANY($1::text[]) ORDER BY id",
        claves_empresa,
    ):
        empresas.setdefault(r["clave"], []).append((r["id"], r["business_name"]))

    claves_cliente = sorted({_normalize(p.client_name) for p in pares})
    clientes: dict[str, tuple[str, str]] = {}
    for r in await conn.fetch(
        "SELECT id::text AS id, name, upper(trim(name)) AS clave "
        "FROM public.shippers WHERE upper(trim(name)) = ANY($1::text[]) ORDER BY id",
        claves_cliente,
    ):
        clientes.setdefault(r["clave"], (r["id"], r["name"]))

    ids_empresa = sorted({p.carrier_id for p in patentes if p.carrier_id}
                         | {i for lista in empresas.values() for i, _ in lista})
    vinculos = {(r["carrier_id"], r["shipper_id"]) for r in await conn.fetch(
        "SELECT carrier_id::text AS carrier_id, shipper_id::text AS shipper_id FROM public.carrier_shippers "
        "WHERE status = 'ACTIVE' AND carrier_id = ANY($1::uuid[])", ids_empresa)}
    nombres = {r["id"]: r["business_name"] for r in await conn.fetch(
        "SELECT id::text AS id, business_name FROM public.carriers WHERE id = ANY($1::uuid[])", ids_empresa)}

    return Senales(patentes=patentes, conductores=conductores, pares_cliente=pares,
                   empresas_por_clave=empresas, clientes_por_clave=clientes,
                   vinculos_activos=vinculos, nombres_empresa=nombres)


async def aplicar_correcciones(conn, fecha: _date) -> None:
    """Tipo A, en lote. La llama `cierre_lineas.recalcular_en` dentro de su
    transacción, con el período tomado y el origen declarado: estas escrituras
    no vuelven a encolar el día."""
    c = clasificar(await leer_senales(conn, fecha))

    if c.reasignaciones:
        activos = [r.asset_id for r in c.reasignaciones]
        await conn.execute(
            """
            UPDATE public.asset_assignments aa SET status = 'INACTIVE'
            FROM unnest($1::uuid[], $2::uuid[]) AS x(asset_id, carrier_id)
            WHERE aa.asset_id = x.asset_id AND aa.carrier_id = x.carrier_id
              AND aa.status = 'ACTIVE' AND NOT aa.is_manual_override
            """,
            activos, [r.old_carrier_id for r in c.reasignaciones],
        )
        await conn.execute(
            """
            INSERT INTO public.asset_assignments (asset_id, carrier_id, status)
            SELECT x.asset_id, x.carrier_id, 'ACTIVE' FROM unnest($1::uuid[], $2::uuid[]) AS x(asset_id, carrier_id)
            ON CONFLICT (asset_id, carrier_id) DO UPDATE SET status = 'ACTIVE'
            WHERE NOT asset_assignments.is_manual_override
            """,
            activos, [r.new_carrier_id for r in c.reasignaciones],
        )
        await auditar_en_lote(conn, entity_type="ASSET", action="pre_cierre_reasignar_empresa",
                              field="carrier_id", source=FUENTE,
                              filas=[(r.asset_id, r.old_name, r.new_name) for r in c.reasignaciones])

    if c.renombres:
        await conn.execute(
            "UPDATE public.drivers d SET full_name = x.nombre "
            "FROM unnest($1::uuid[], $2::text[]) AS x(id, nombre) WHERE d.id = x.id",
            [r.driver_id for r in c.renombres], [r.new_name for r in c.renombres],
        )
        await auditar_en_lote(conn, entity_type="DRIVER", action="pre_cierre_actualizar_nombre",
                              field="full_name", source=FUENTE,
                              filas=[(r.driver_id, r.old_name, r.new_name) for r in c.renombres])

    if c.vinculos:
        await conn.execute(
            """
            INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status)
            SELECT x.carrier_id, x.shipper_id, 'ACTIVE' FROM unnest($1::uuid[], $2::uuid[]) AS x(carrier_id, shipper_id)
            ON CONFLICT (carrier_id, shipper_id) DO UPDATE SET status = 'ACTIVE'
            WHERE NOT carrier_shippers.is_manual_override
            """,
            [v.carrier_id for v in c.vinculos], [v.shipper_id for v in c.vinculos],
        )
        await auditar_en_lote(conn, entity_type="CARRIER", action="pre_cierre_agregar_cliente",
                              field="carrier_shippers", source=FUENTE,
                              filas=[(v.carrier_id, None, v.shipper_name) for v in c.vinculos])


_SQL_ONBOARDING = """
SELECT DISTINCT c.id::text AS carrier_id, c.business_name AS carrier_name
FROM app.trips t
JOIN public.assets a ON upper(trim(a.license_plate)) = upper(trim(t.fleet->>'tractor_plate'))
JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
JOIN public.carriers c ON c.id = aa.carrier_id
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND c.operational_status != 'ACTIVE'
"""

# Trae la PATENTE: la acción es abrir ese tracto y clasificarlo.
_SQL_SIN_TIPO = """
SELECT DISTINCT c.id::text AS carrier_id, c.business_name AS carrier_name, a.license_plate AS tractor_plate
FROM app.trips t
JOIN public.assets a ON upper(trim(a.license_plate)) = upper(trim(t.fleet->>'tractor_plate'))
JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1)) AND a.webcarga_operation_type_id IS NULL
"""

# PROPONE, no escribe (minuta 25/08): solo con el padrón en silencio y una sola
# empresa en todos sus viajes. El vínculo lo escribe una persona desde el panel.
_SQL_SIN_EMPRESA = """
SELECT vfr.resolved_driver_id::text AS driver_id, d.full_name AS driver_name,
       min(vfr.resolved_carrier_id::text) AS carrier_id, min(c.business_name) AS carrier_name,
       count(*) AS viajes
FROM app.trips t
JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
JOIN public.drivers d ON d.id = vfr.resolved_driver_id AND d.operational_status = 'ACTIVE'
JOIN public.carriers c ON c.id = vfr.resolved_carrier_id AND c.operational_status = 'ACTIVE'
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
  AND NOT EXISTS (SELECT 1 FROM public.driver_assignments da
                  WHERE da.driver_id = vfr.resolved_driver_id AND da.status = 'ACTIVE')
GROUP BY vfr.resolved_driver_id, d.full_name
HAVING count(DISTINCT vfr.resolved_carrier_id) = 1
"""

# Lo que el sistema corrigió solo, desde el día D (mismo patrón que
# cierre_viajes.SQL_CON_MOTIVO): se lee de la bitácora, no se guarda aparte.
_SQL_RESUELTAS = """
SELECT a.action, a.old_value, a.new_value, ast.license_plate, d.tax_id, c.business_name
FROM public.audit_log a
LEFT JOIN public.assets ast ON a.entity_type = 'ASSET' AND ast.id = a.entity_id
LEFT JOIN public.drivers d ON a.entity_type = 'DRIVER' AND d.id = a.entity_id
LEFT JOIN public.carriers c ON a.entity_type = 'CARRIER' AND c.id = a.entity_id
WHERE a.source = 'pre_cierre_auto'
  AND (a.occurred_at AT TIME ZONE 'America/Santiago')::date >= $1
ORDER BY a.occurred_at
"""


def _resuelta(r) -> dict:
    viejo = json.loads(r["old_value"]) if r["old_value"] else None
    nuevo = json.loads(r["new_value"]) if r["new_value"] else None
    if r["action"] == "pre_cierre_reasignar_empresa":
        return {"type": "PATENTE_EMPRESA", "tractor_plate": r["license_plate"],
                "old_carrier_name": viejo, "new_carrier_name": nuevo,
                "message": (f"Se actualizó la empresa asociada a la patente {r['license_plate']} de "
                            f"'{viejo}' a '{nuevo}'. Revisar que los documentos asociados (permiso de "
                            "circulación, contrato de conductor) estén vigentes para la nueva empresa.")}
    if r["action"] == "pre_cierre_actualizar_nombre":
        return {"type": "CONDUCTOR_DATOS", "driver_rut": r["tax_id"], "old_value": viejo, "new_value": nuevo,
                "message": f"Se actualizó el nombre del conductor {r['tax_id']} de '{viejo}' a '{nuevo}'."}
    return {"type": "CLIENTE_EMPRESA", "carrier_name": r["business_name"], "client_name": nuevo,
            "message": f"Se agregó '{nuevo}' a la lista de clientes de '{r['business_name']}'."}


async def avisos_del_dia(conn, fecha: _date) -> dict:
    """Tipo B y lo resuelto solo, en lectura pura: no escribe nada."""
    c = clasificar(await leer_senales(conn, fecha))
    escalations = c.escalations
    escalations["EMPRESA_ONBOARDING"] = [dict(r) for r in await conn.fetch(_SQL_ONBOARDING, fecha)]
    escalations["SIN_TIPO_OPERACION"] = [dict(r) for r in await conn.fetch(_SQL_SIN_TIPO, fecha)]
    escalations["CONDUCTOR_SIN_EMPRESA"] = [dict(r) for r in await conn.fetch(_SQL_SIN_EMPRESA, fecha)]
    auto_resolved = [_resuelta(r) for r in await conn.fetch(_SQL_RESUELTAS, fecha)]
    return {"auto_resolved": auto_resolved, "escalations": escalations}
