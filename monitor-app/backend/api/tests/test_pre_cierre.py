"""Las reglas del pre-cierre, sin base de datos (spec 2026-10-10, §4).

`clasificar` es pura: recibe las señales leídas por conjuntos y decide qué
corregir y qué avisar. Las reglas son las mismas de antes del 10/10; cambió
cómo se leen y se escriben los datos, no qué se decide."""
from app.services.pre_cierre import (
    Conductor, ParCliente, Patente, Senales, clasificar,
)

C1, C2, A1, D1, S1 = "c1", "c2", "a1", "d1", "s1"


def senales(**kw) -> Senales:
    base = dict(patentes=[], conductores=[], pares_cliente=[], empresas_por_clave={},
                clientes_por_clave={}, vinculos_activos=set(), nombres_empresa={})
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
        "tms_carrier_name": "Trans Sur"}]
    assert c.reasignaciones == []


def test_patente_sin_empresa_es_aviso():
    c = clasificar(senales(patentes=[patente(carrier_id=None, carrier_name=None)]))
    assert c.escalations["PATENTE_NO_REGISTRADA"][0]["reason"] == "La patente existe pero no tiene empresa asignada"


def test_un_solo_candidato_reasigna_la_patente():
    c = clasificar(senales(patentes=[patente()], empresas_por_clave={"TRANS SUR": [(C2, "Trans Sur")]}))
    assert [(r.asset_id, r.old_carrier_id, r.new_carrier_id) for r in c.reasignaciones] == [(A1, C1, C2)]
    assert c.carrier_por_patente == {"ABCD12": C2}


def test_dos_candidatos_es_aviso_de_empresa_no_reconocida():
    c = clasificar(senales(patentes=[patente()],
                           empresas_por_clave={"TRANS SUR": [(C2, "Trans Sur"), ("c3", "Trans Sur")]}))
    assert c.reasignaciones == []
    assert c.escalations["EMPRESA_NO_RECONOCIDA"] == [{
        "tractor_plate": "ABCD12", "tms_carrier_name": "Trans Sur",
        "directory_carrier_name": "Trans Norte", "directory_carrier_id": C1}]


def test_override_manual_nunca_se_reasigna():
    c = clasificar(senales(patentes=[patente(is_manual_override=True)],
                           empresas_por_clave={"TRANS SUR": [(C2, "Trans Sur")]}))
    assert c.reasignaciones == [] and c.escalations["EMPRESA_NO_RECONOCIDA"] == []


def test_webcarga_como_empresa_del_tms_no_dispara_nada():
    c = clasificar(senales(patentes=[patente(carrier_names=["WEBCARGA SPA"])]))
    assert c.reasignaciones == [] and c.escalations["EMPRESA_NO_RECONOCIDA"] == []


def test_senal_ambigua_no_se_corrige():
    c = clasificar(senales(patentes=[patente(carrier_names=["Trans Sur", "Otra"])],
                           empresas_por_clave={"TRANS SUR": [(C2, "Trans Sur")]}))
    assert c.reasignaciones == []


def test_mismo_nombre_con_acentos_y_espacios_no_se_corrige():
    c = clasificar(senales(patentes=[patente(carrier_names=["Tráns   Norte"])]))
    assert c.reasignaciones == [] and c.escalations["EMPRESA_NO_RECONOCIDA"] == []


def test_rut_invalido_es_aviso_y_rut_sin_conductor_propone_el_nombre():
    c = clasificar(senales(conductores=[
        Conductor(rut="X", es_canonico=False, names=["Ana"], driver_id=None, full_name=None, is_manual_override=False),
        Conductor(rut="11111111-1", es_canonico=True, names=["Ana Paz"], driver_id=None, full_name=None, is_manual_override=False),
    ]))
    assert c.escalations["CONDUCTOR_NO_REGISTRADO"] == [
        {"driver_rut": "X", "reason": "El TMS informó un RUT que no es válido"},
        {"driver_rut": "11111111-1", "driver_name_tms": "Ana Paz"},
    ]


def test_nombre_distinto_para_el_mismo_rut_se_corrige():
    c = clasificar(senales(conductores=[Conductor(
        rut="11111111-1", es_canonico=True, names=[" Ana Paz "], driver_id=D1,
        full_name="Ana", is_manual_override=False)]))
    assert [(r.driver_id, r.old_name, r.new_name) for r in c.renombres] == [(D1, "Ana", "Ana Paz")]


def test_cliente_nuevo_de_una_patente_resuelta_se_vincula():
    c = clasificar(senales(patentes=[patente(carrier_names=["WEBCARGA"])],
                           pares_cliente=[ParCliente(plate="ABCD12", client_name="walmart")],
                           clientes_por_clave={"WALMART": (S1, "Walmart")},
                           nombres_empresa={C1: "Trans Norte"}))
    assert [(v.carrier_id, v.shipper_id) for v in c.vinculos] == [(C1, S1)]


def test_cliente_ya_vinculado_no_se_repite():
    c = clasificar(senales(patentes=[patente(carrier_names=["WEBCARGA"])],
                           pares_cliente=[ParCliente(plate="ABCD12", client_name="walmart")],
                           clientes_por_clave={"WALMART": (S1, "Walmart")}, vinculos_activos={(C1, S1)}))
    assert c.vinculos == []
