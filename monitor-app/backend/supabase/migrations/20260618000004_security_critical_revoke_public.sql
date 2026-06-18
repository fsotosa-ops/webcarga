-- ==============================================================================
-- MIGRACIÓN: FIX REVOKE PUBLIC EN FUNCIONES SECURITY DEFINER
-- El REVOKE FROM anon de la migración anterior era insuficiente:
-- GRANT TO PUBLIC incluye a anon, y la herencia de PUBLIC no se bloquea
-- revocando el role hijo. Hay que revocar PUBLIC directamente.
-- ==============================================================================

-- safe_update_transporter: revocar PUBLIC, re-grantar a authenticated
-- FastAPI llama esta función con tokens de usuario autenticado
REVOKE EXECUTE ON FUNCTION app.safe_update_transporter(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.safe_update_transporter(uuid, jsonb) TO authenticated;

-- handle_new_user: revocar PUBLIC (mantiene grants explícitos a authenticated y service_role)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- is_admin: revocar PUBLIC (mantiene grants explícitos a authenticated y service_role)
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
