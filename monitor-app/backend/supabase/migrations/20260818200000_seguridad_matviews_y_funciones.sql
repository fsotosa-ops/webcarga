-- Cierra dos de los tres hallazgos de seguridad del ítem 20 (Ronda 95).
-- Aplicado en producción el 2026-08-18 y verificado con el linter de Supabase.
--
-- ── 1. Las 5 matviews expuestas ──────────────────────────────────────────
--
-- Tenían `SELECT` concedido a `authenticated`, o sea eran consultables con la
-- clave anon que viaja en el bundle del frontend, vía la API de datos.
--
-- Verificado antes de revocar:
--   · El frontend consulta UNA sola tabla con supabase-js: `profiles`
--     (grep sobre todos los `.from(...)` del árbol). Las menciones a estas
--     matviews en el frontend son comentarios, no consultas.
--   · El backend entra con asyncpg como dueño de la base, que no depende de
--     estos grants.
--
-- `app.carrier_compliance_status` no aparece acá porque nunca tuvo el grant —
-- por eso el linter listaba 5 y no 6.

REVOKE SELECT ON app.asset_compliance_status   FROM authenticated;
REVOKE SELECT ON app.carrier_asset_roster      FROM authenticated;
REVOKE SELECT ON app.carrier_driver_roster     FROM authenticated;
REVOKE SELECT ON app.carrier_insurance_status  FROM authenticated;
REVOKE SELECT ON app.driver_compliance_status  FROM authenticated;

-- ── 2. Las funciones SECURITY DEFINER ────────────────────────────────────
--
-- Las tres son distintas y NO se tratan igual. Evaluadas una por una:
--
-- `app.current_user_role()` — no la usa NINGUNA política de RLS ni ninguna
--   línea de código (verificado en backend y frontend). Está muerta: se cierra
--   del todo.
--
--   GOTCHA que costó una segunda migración: revocar a `anon`/`authenticated`
--   NO alcanza. Postgres crea toda función con EXECUTE concedido a PUBLIC, y
--   esos roles lo HEREDAN de ahí; el ACL lo delata con una entrada `=X/postgres`
--   (sin rol a la izquierda: eso ES PUBLIC). Hay que revocar a PUBLIC.
--
-- `public.handle_new_user()` — devuelve `trigger`. Un trigger no requiere que
--   el rol invocante tenga EXECUTE: Postgres lo verifica al CREAR el trigger,
--   no al dispararlo. Revocar no afecta el alta de usuarios.
--
-- `public.is_admin()` — **NO se le revoca a `authenticated`, y es deliberado.**
--   La usan TRES políticas de RLS vivas:
--     · public.profiles → admin_select_all
--     · public.profiles → admin_update_all
--     · public.admin_whitelist → admin_manage_whitelist
--   La expresión de una política se evalúa con los privilegios de quien
--   consulta, así que quitarle EXECUTE rompería el acceso a perfiles para todo
--   usuario autenticado. Y el riesgo que cubriría es nulo: la función sólo
--   informa si QUIEN LLAMA es admin — no expone datos de terceros.
--   Se le revoca a `anon`, que nunca tiene `auth.uid()` y siempre recibiría
--   `false`.
--
--   El linter va a seguir reportándola. Es un falso positivo conocido para
--   este caso: no cambiar sin resolver antes qué pasa con esas 3 políticas.

REVOKE EXECUTE ON FUNCTION app.current_user_role()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin()         FROM anon;
