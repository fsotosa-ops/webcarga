"""public.contacts — polimórfico (CARRIER/DRIVER/ASSET). El alta queda
anidada bajo el recurso padre (ver routers/carriers.py: POST
/carriers/{id}/contacts) porque siempre nace ligada a una entidad; edición y
borrado son flat por id acá, ya que un contacto existente no necesita el
contexto del padre para identificarse (H2.2)."""
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_editor
from ..db import get_pool
from ..schemas.contact import ContactPatchBody
from ..services.audit import log_change, record_manual_edit

router = APIRouter(prefix="/contacts", tags=["contacts"])

_PATCHABLE_FIELDS = ("contact_role", "first_name", "last_name", "job_title", "email", "phone", "is_primary", "is_active")


@router.patch("/{contact_id}")
async def patch_contact(
    contact_id: str, body: ContactPatchBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                f"SELECT entity_id, entity_type, {', '.join(_PATCHABLE_FIELDS)} "
                "FROM public.contacts WHERE id = $1",
                contact_id,
            )
            if not current:
                raise HTTPException(404, "Contacto no encontrado")

            touched = [f for f in _PATCHABLE_FIELDS if getattr(body, f) is not None]
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")

            await conn.execute(
                """
                UPDATE public.contacts SET
                    contact_role = COALESCE($2, contact_role),
                    first_name   = COALESCE($3, first_name),
                    last_name    = COALESCE($4, last_name),
                    job_title    = COALESCE($5, job_title),
                    email        = COALESCE($6, email),
                    phone        = COALESCE($7, phone),
                    is_primary   = COALESCE($8, is_primary),
                    is_active    = COALESCE($9, is_active),
                    updated_at   = NOW()
                WHERE id = $1
                """,
                contact_id, body.contact_role, body.first_name, body.last_name,
                body.job_title, body.email, body.phone, body.is_primary, body.is_active,
            )
            for field in touched:
                await record_manual_edit(
                    conn, table="contacts", where={"id": contact_id}, actor=user["sub"],
                    entity_type=current["entity_type"], entity_id=current["entity_id"],
                    action="update", field=field, old_value=current[field], new_value=getattr(body, field),
                )

    row = await pool.fetchrow(
        "SELECT id, contact_role, first_name, last_name, job_title, email, phone, is_primary, is_active "
        "FROM public.contacts WHERE id = $1",
        contact_id,
    )
    return dict(row)


@router.delete("/{contact_id}")
async def delete_contact(contact_id: str, pool=Depends(get_pool), user=Depends(require_editor)):
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                "SELECT entity_id, entity_type, contact_role FROM public.contacts WHERE id = $1",
                contact_id,
            )
            if not current:
                raise HTTPException(404, "Contacto no encontrado")
            await conn.execute("DELETE FROM public.contacts WHERE id = $1", contact_id)
            await log_change(
                conn, actor=user["sub"], entity_type=current["entity_type"], entity_id=current["entity_id"],
                action="delete", field="contact", old_value=current["contact_role"], source="api",
            )
    return {"ok": True}
