# UAT Monitor Webcarga

Mon, 06 Jul 26 · fabian.mendez@webcarga.com

### Estado del Monitor y Ajustes Recientes

- Etiquetas de batch agregadas para clasificar viajes según reglas de la torre de control:
  - Atrasado de llegada
  - Detenido en local (más de 2 horas)
  - Sin reportes en las últimas horas
  - Conductor disponible tras cierre de viaje
- Filtros limpiados para mejor legibilidad; grupos de filtros configurables con nombre personalizado
- Vista de destinos mejorada: muestra todos los puntos pero resalta el destino actual o más reciente
- Bitácora de observaciones: permite registrar llamadas, mensajes WhatsApp, incidentes y adjuntar archivos (foto, PDF)
- Errores activos detectados:
  - Viaje nulo sin asignatura aparece en el listado (no debería mostrarse)
  - Tabla de cruce de fechas rota, no procesa información correctamente
  - Error 400 al adjuntar archivos: sin permisos de acceso a la base de datos

### Viajes Manuales e IDs Internos

- Formulario de viaje manual requiere: fecha, cliente, origen, tipo de carga, estado inicial, y si tiene TMS integrada
- Clientes a mapear como desplegable: Walmart, Sodimac, Colún, Yanza, y una opción genérica “Otro cliente” para viajes spot
- Lógica de IDs definida:
  - Con TMS integrada: usar el ID del viaje del sistema externo
  - Sin TMS: generar un ID interno de Webcarga automáticamente (no visible en el front para operaciones)
  - El ID interno queda por detrás para uso de facturación y trazabilidad contable
- Campos adicionales a agregar: número de factura u orden de compra, para hacer el nexo en el proceso contable
- Módulo de finanzas pensado como vista separada: solo viajes finalizados, filtrados por cliente

### Conductores Disponibles y Cierre de Viajes

- Vista de conductores disponibles: muestra todos los conductores activos sin viaje asignado o en ruta
- Caso Walmart: conductores se anotan de madrugada, la asignación puede llegar al mediodía; el sistema mostrará “no asignado” hasta que la TMS de Walmart suba el viaje (demora de ~30 segundos)
- Viajes cerrados (completo, incompleto, finalizado) quedan disponibles para reasignación de conductor
- Archivo de empresas activas: se deja en carpeta, Fabian prepara el prompt y lo pasa a Pablo para ejecutarlo

### Próximos Pasos

- **Ajustar formulario de viaje manual** (Felipe)
  - Hacer campos de cliente y origen desplegables, agregar campo de ID editable y revisar la base de datos que se cae y no actualiza fechas.
- **Preparar y enviar prompt del archivo de empresas a Pablo** (Fabian)
  - Para que Pablo lo ejecute hoy en la tarde y se pueda revisar qué datos tira.
- **Revisar minuta de Pablo y validar puntos pendientes de la aplicación** (Fabian)
  - Alinearse con Pablo antes de la revisión conjunta de mañana.

---

Chat with meeting transcript: https://notes.granola.ai/t/900b1789-b1e0-438d-bd4a-4df82bbdec0a-00demib2