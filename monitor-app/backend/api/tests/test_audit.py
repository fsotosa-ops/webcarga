import pytest
from unittest.mock import AsyncMock

from app.services.audit import log_change, record_manual_edit, OVERRIDABLE_TABLES


@pytest.mark.asyncio
async def test_log_change_inserts_into_public_audit_log():
    conn = AsyncMock()

    await log_change(
        conn, actor="u1", entity_type="CARRIER", entity_id="c1",
        action="update", field="business_name", old_value="A", new_value="B",
    )

    sql = conn.execute.call_args.args[0]
    assert "INSERT INTO public.audit_log" in sql
    assert conn.execute.call_args.args[1:] == ("u1", "CARRIER", "c1", "update", "business_name", '"A"', '"B"', "api")


@pytest.mark.asyncio
async def test_log_change_serializes_dict_values_as_jsonb():
    conn = AsyncMock()

    await log_change(
        conn, actor="u1", entity_type="CARRIER", entity_id="c1",
        action="update", old_value={"status": "MISSING"}, new_value={"status": "APPROVED_MANUAL"},
    )

    args = conn.execute.call_args.args
    assert args[6] == '{"status": "MISSING"}'
    assert args[7] == '{"status": "APPROVED_MANUAL"}'


@pytest.mark.asyncio
async def test_record_manual_edit_sets_override_columns_and_logs():
    conn = AsyncMock()

    await record_manual_edit(
        conn, table="carriers", where={"id": "c1"}, actor="u1",
        entity_type="CARRIER", entity_id="c1", action="update", field="business_name",
    )

    assert conn.execute.await_count == 2
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "UPDATE public.carriers" in update_sql
    assert "is_manual_override = true" in update_sql
    assert "WHERE id = $2" in update_sql
    assert conn.execute.call_args_list[0].args[1:] == ("u1", "c1")

    audit_sql = conn.execute.call_args_list[1].args[0]
    assert "INSERT INTO public.audit_log" in audit_sql


@pytest.mark.asyncio
async def test_record_manual_edit_supports_composite_key_tables():
    conn = AsyncMock()

    await record_manual_edit(
        conn, table="policy_coverages",
        where={"policy_id": "p1", "coverage_type_id": "ct1"},
        actor="u1", entity_type="CARRIER", entity_id="c1", action="update",
    )

    update_sql = conn.execute.call_args_list[0].args[0]
    assert "WHERE policy_id = $2 AND coverage_type_id = $3" in update_sql
    assert conn.execute.call_args_list[0].args[1:] == ("u1", "p1", "ct1")


@pytest.mark.asyncio
async def test_record_manual_edit_rejects_table_outside_whitelist():
    conn = AsyncMock()

    with pytest.raises(ValueError, match="no habilitada"):
        await record_manual_edit(
            conn, table="profiles", where={"id": "x"}, actor="u1",
            entity_type="CARRIER", entity_id="c1", action="update",
        )

    conn.execute.assert_not_called()


@pytest.mark.asyncio
async def test_record_manual_edit_rejects_empty_where():
    conn = AsyncMock()

    with pytest.raises(ValueError, match="where"):
        await record_manual_edit(
            conn, table="carriers", where={}, actor="u1",
            entity_type="CARRIER", entity_id="c1", action="update",
        )


def test_overridable_tables_matches_h1_migration():
    assert OVERRIDABLE_TABLES == {
        "carriers", "drivers", "assets", "contacts", "compliance_records",
        "driver_assignments", "asset_assignments", "carrier_shippers",
        "insurance_policies", "policy_coverages", "policy_assets",
        "insurance_installments",
    }
