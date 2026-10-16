"""Las reglas del pre-cierre, sin base de datos (spec 2026-10-10, §4).

`clasificar` es pura: recibe las señales leídas por conjuntos y decide qué
avisar. Desde D2 (14/10) solo avisa: no cambia la empresa del tracto ni agrega
clientes (P10, P11)."""
from app.services.pre_cierre import Conductor, Patente, Senales, clasificar

C1, A1, D1 = "c1", "a1", "d1"


def senales(**kw) -> Senales:
    base = dict(patentes=[], conductores=[])
    base.update(kw)
    return Senales(**base)


def patente(**kw) -> Patente:
    base = dict(plate="ABCD12", carrier_names=["Trans Sur"], asset_id=A1, carrier_id=C1,
                carrier_name="Trans Norte", is_manual_override=False)
    base.update(kw)
    return Patente(**base)


def test_patente_inexistente_es_aviso_con_la_empresa_del_tms():
    c = clasificar(senales(patentes=[patente(asset_id=None, carrier_id=None, carrier_name=None)]))
    assert c.escalations["PATENTE_NO_REGISTRADA"] == [{
        "tractor_plate": "ABCD12", "reason": "La patente no existe en public.assets",
        "tms_carrier_name": "Trans Sur", "scope": None}]


def test_patente_sin_empresa_es_aviso():
    c = clasificar(senales(patentes=[patente(carrier_id=None, carrier_name=None)]))
    assert c.escalations["PATENTE_NO_REGISTRADA"][0]["reason"] == "La patente existe pero no tiene empresa asignada"


def test_a6_la_empresa_del_tms_no_cambia_ni_avisa_nada():
    """P11 (14/10): la empresa que informa el TMS se ignora; manda el Directorio."""
    c = clasificar(senales(patentes=[patente(carrier_names=["Otra Empresa SpA"])]))
    assert not hasattr(c, "reasignaciones") and not hasattr(c, "vinculos")
    assert all(v == [] for v in c.escalations.values())


def test_rut_invalido_es_aviso_y_rut_sin_conductor_propone_el_nombre():
    c = clasificar(senales(conductores=[
        Conductor(rut="X", es_canonico=False, names=["Ana"], driver_id=None),
        Conductor(rut="11111111-1", es_canonico=True, names=["Ana Paz"], driver_id=None),
    ]))
    assert c.escalations["CONDUCTOR_NO_REGISTRADO"] == [
        {"driver_rut": "X", "reason": "El TMS informó un RUT que no es válido", "scope": None},
        {"driver_rut": "11111111-1", "driver_name_tms": "Ana Paz", "scope": None},
    ]


def test_un_nombre_distinto_en_el_tms_no_es_una_correccion():
    """P9 (12/10): el nombre lo gestiona el Directorio."""
    c = clasificar(senales(conductores=[Conductor(
        rut="11111111-1", es_canonico=True, names=[" Ana Paz "], driver_id=D1)]))
    assert not hasattr(c, "renombres")
    assert c.escalations["CONDUCTOR_NO_REGISTRADO"] == []
