{{ config(enabled=false) }}
-- RETIRADO (22/10): lo reemplazó analytics.driver_identity (una sola tabla de datos personales para Viajes y Flota
-- por día). Este archivo queda deshabilitado porque la sincronización con Mage no propaga borrados; la tabla se
-- borró a mano en la base. Se puede eliminar desde la interfaz de Mage.
SELECT 1
