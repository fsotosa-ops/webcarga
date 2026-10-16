-- Dos conductores de la carga del 16/07 (cuando Mage todavía escribía el maestro)
-- quedaron con el marcador de nulo de COPY pegado al nombre: "…Alejandro\N".
-- Es el único caso en las columnas de texto de public y app (barrido 15/10).
-- El nombre anterior queda en audit_log. Re-ejecutable.

INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
SELECT NULL, 'DRIVER', d.id, 'update', 'full_name', to_jsonb(d.full_name),
       to_jsonb(rtrim(left(d.full_name, length(d.full_name) - 2))), 'migration'
FROM public.drivers d
WHERE d.full_name LIKE E'%\\\\N';

UPDATE public.drivers
   SET full_name = rtrim(left(full_name, length(full_name) - 2))
 WHERE full_name LIKE E'%\\\\N';
