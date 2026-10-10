# Cierre: motivos de anulación de catálogo, ajustes sin ruido y vuelta visible — diseño

Fecha: 2026-10-10 · Estado: diseño aprobado en conversación (10/10), spec en revisión · Rama: `dev`
Continúa a `2026-10-10-cierre-anulacion-y-firma-versionada-design.md` (desplegada en dev el 10/10).

## 1. Contexto

Al usar en dev la anulación y los ajustes posteriores, Operaciones encontró tres problemas:

1. **El motivo de anulación es texto libre.** Los 6 duplicados del 23/09 se anularon escribiendo "Duplicado"
   a mano. Con texto libre no se puede contar ni auditar ("Duplicado", "duplicado" y "repetido" serían tres
   motivos), y no lo controla el negocio.
2. **Los ajustes son un aviso fijo.** El Cierre del 23/09 muestra arriba un bloque permanente con 12 filas que no
   piden ninguna acción.
3. **Desde "Ver viaje" no se ve cómo volver.** El ✕ del detalle sí vuelve al Cierre (`?next=`), pero es un ícono
   gris sin texto en la barra oscura: no dice adónde lleva.

**Estándar que se sigue:**
- **Motivo de anulación:** ERP como SAP y Oracle usan un *reason code* de un catálogo configurable, más un
  comentario opcional que pasa a obligatorio con "Otro". Ese catálogo es distinto del de "motivo de no
  asignación": SAP también separa el motivo de rechazo de un pedido (un dato de negocio) del motivo de reversa de
  un documento mal emitido (una corrección).
- **Ajustes:** según Material, Carbon e Atlassian, un banner es para algo que pide acción o cambia cómo se lee la
  pantalla. En el cierre contable (SAP, NetSuite), los ajustes posteriores no son alertas: son parte del registro
  del período y se consultan en su lugar. Arriba solo va un indicador.
- **Vuelta:** según NN/g, un vínculo de vuelta debe decir adónde lleva ("← Volver al Cierre"), no ser solo un
  ícono.

## 2. Motivos de anulación de catálogo

### 2.1 Datos

- **Dominio nuevo `TRIP_VOID_REASON` en `app.status_taxonomies`.** Usa el mismo catálogo y la misma tabla que
  `TRIP_UNASSIGNED_REASON`, pero es un dominio aparte: no se mezcla con los motivos de no asignación. Se carga con
  estos valores:

  | code | label |
  |---|---|
  | `DUPLICADO` | Duplicado |
  | `CARGADO_POR_ERROR` | Cargado por error |
  | `DATOS_INCORRECTOS` | Datos incorrectos (se registró de nuevo) |
  | `OTRO` | Otro |

- **Columnas en `app.trips_manual` y `app.trips`:**
  - `void_reason` (texto) se reemplaza por `void_reason_id uuid` (el motivo del catálogo) y `void_note text`
    (comentario opcional).
  - El CHECK pasa a ser: `voided_at`, `voided_by` y `void_reason_id` van juntos; `void_note` es opcional.
- **Migración de datos:** los 6 anulados del 23/09 pasan a `void_reason_id = DUPLICADO`, con `void_note` NULL.
- **Expand/contract en una sola ventana de Mage:** se agregan las columnas nuevas, se cargan los datos, se
  actualiza el modelo dbt `trips` (rama manual con `m.void_reason_id` y `m.void_note`, rama TMS con NULLs, ambas en
  `merge_exclude_columns`) y se retira `void_reason`.
  - Todo va en la misma ventana entre corridas por la misma razón que antes: con `sync_all_columns`, una corrida
    con el modelo viejo borra las columnas nuevas.
  - `void_reason` se retira en la misma migración porque no la lee nada fuera de la API, que se despliega justo
    después.

### 2.2 Reglas

- `POST /trips/void` recibe `{trip_ids, reason_id, note?}`. La validación queda en `services/anular_viajes.py`:
  - `reason_id` es obligatorio, debe existir, estar activo y ser del dominio `TRIP_VOID_REASON`; si no, 422.
    Es la misma validación de dominio que hoy hace `bulk-close` con `TRIP_UNASSIGNED_REASON`.
  - Si el código es `OTRO`, `note` es obligatorio; si falta, 422.
  - Revertir limpia `void_reason_id` y `void_note`.
- La auditoría guarda `reason_id`, la etiqueta del motivo al momento de anular y la nota.
- La regla de quién puede anular no cambia: creador o `trips.void_any`, y `closures.sign` si el viaje toca un día
  firmado.

### 2.3 Lectura y pantallas

- El detalle (`GET /trips/{id}`) devuelve `void_reason_id`, `void_reason_label` y `void_note`. Los ajustes
  (`cierre.ajustes`) devuelven `void_reason_label` y `void_note` en vez de `void_reason`.
- **Configuración › Operaciones:** una sección nueva, "Motivos de anulación" (`void-reasons`), con
  `TaxonomyTab domain="TRIP_VOID_REASON"`, el mismo componente de "Motivos de no asignación". Se registra en
  `dominios.ts` y en `services/revisiones.py` (`_taxonomia`).
- **Al anular:**
  - En el detalle y en la barra de selección del Monitor se elige el motivo de una lista: los motivos activos del
    dominio, con `taxonomiesApi`, igual que los motivos de no asignación.
  - El comentario es opcional y pasa a obligatorio con "Otro". El botón de confirmar queda deshabilitado hasta que
    haya motivo, y comentario cuando corresponde.
  - `BarraDeSeleccion` cambia su prop `pideMotivo` (texto) por un campo de motivo de catálogo. La variante va como
    prop, no como un componente hermano.
  De paso se corrigen los detalles que encontró la revisión anterior: el botón deshabilitado se ve
  deshabilitado, y el motivo y el comentario se conservan si el backend rechaza (solo se limpian al tener éxito o
  al cancelar).
- El aviso "Anulado" y los ajustes muestran la etiqueta del motivo y, si hay, el comentario.

## 3. Ajustes posteriores: indicador arriba, detalle en "Viajes"

- **Arriba:** se retira el bloque fijo `AjustesPosterioresAlCierre`.
  - En un día firmado con ajustes, junto al estado "Cerrado" aparece un indicador compacto: "N ajustes posteriores
    al cierre".
  - El indicador es un botón que abre la pestaña "Viajes" (`?tab=viajes`) y lleva a la sección de ajustes.
  - Sin ajustes, no aparece.
- **Pestaña "Viajes":** en un día firmado, una sección "Después de la firma" muestra la misma lista de hoy (viaje,
  cliente, agregado o anulado, motivo, comentario y "Ver viaje").
  - Los ajustes son viajes, así que van donde ya se miran los viajes del día, sin pantalla nueva.
  - En un día abierto, la sección no existe.
- **Pestañas:** la pestaña "Viajes" muestra el número de ajustes en su etiqueta cuando el día está firmado y tiene
  ajustes, igual que se ve un conteo sin abrir la pestaña.
- **Sin banner ni flujo de "revisado"** (YAGNI). Si Operaciones quiere marcar cada ajuste como revisado, sería otra
  historia de usuario.

## 4. Vuelta visible desde el detalle del viaje

- `lib/navegacion/viaje.ts` agrega `etiquetaDeVuelta(next)`: "Volver al Cierre" si el destino es
  `/dashboard/operations/closures`, y "Volver al Monitor" en cualquier otro caso.
  - La regla vive en un solo lugar, igual que `volverDesdeElViaje`, que ya decide el destino seguro.
- El detalle muestra, a la izquierda de la barra superior, un vínculo de vuelta con texto (`← Volver al Cierre`),
  además del ✕, que se mantiene.
  - Lo usan la página del viaje y la pantalla de error "No se pudo cargar este viaje".
  - Vale para todas las pantallas que abren un viaje con `?next=`, no solo para los ajustes.

## 5. Pruebas

Las de backend son de integración con ROLLBACK contra la base real. Cada una debe fallar antes del cambio que
prueba, con la mutación verificada.

- **Backend:**
  - Anular sin `reason_id`, con uno de otro dominio o con uno inactivo responde 422.
  - Con `OTRO` sin nota responde 422; con `OTRO` y nota, anula.
  - El detalle y los ajustes devuelven la etiqueta y la nota.
  - Revertir limpia el motivo y la nota.
  - La migración deja los 6 del 23/09 con `DUPLICADO`.
  - La guarda dbt revisa que `void_reason_id` y `void_note` estén en `merge_exclude_columns` y en la rama manual,
    y que `void_reason` ya no esté.
- **Frontend (vitest):**
  - El selector de motivo del detalle y de la barra no confirma sin motivo, y con "Otro" no confirma sin
    comentario.
  - El indicador de ajustes aparece solo en un día firmado con ajustes y abre la pestaña "Viajes".
  - La sección "Después de la firma" muestra los ajustes, con el motivo.
  - `etiquetaDeVuelta` devuelve "Volver al Cierre" o "Volver al Monitor", y el detalle muestra el vínculo con ese
    texto.
- **En dev (Playwright):**
  - Anular desde la barra del Monitor eligiendo el motivo.
  - Volver desde "Ver viaje" con el vínculo.
  - Los 6 del 23/09 muestran "Duplicado" en el Cierre.

## 6. Fuera de alcance

- Los 9 detalles menores diferidos de la revisión anterior (AGENTLOG), salvo el de `BarraDeSeleccion`, que se
  absorbe aquí porque ese componente se reescribe.
- Flujo de "revisado" para los ajustes.
- El contract de `closure_periods` y de las tablas viejas, y el issue #13.
