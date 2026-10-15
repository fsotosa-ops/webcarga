# Seguros: Pólizas y Cuotas (modelo sin estados guardados + submódulos)

**Fecha:** 2026-10-15 · **Rama:** `dev` (nada a `main`) · **Maqueta:** `.superpowers/brainstorm/56411-1792100703/content/seguros.html`

## Por qué

La auditoría del 15/10 (código, migraciones, base real en solo lectura y dev) encontró que Seguros no tiene solo un
modal viejo. Su modelo guarda estados que deberían calcularse, y las dos versiones ya se contradicen:

| Hallazgo (base real, 15/10) | Cifra |
|---|---|
| `insurance_policies.status` dice ACTIVE y la póliza ya venció | 9 de 33 |
| La vigencia se calcula en una vista **materializada** que solo se refresca cuando alguien escribe | sin refresco programado |
| `payment_status` = OVERDUE guardado, más PENDING con fecha pasada (el mismo hecho con dos valores) | 87 + 63 |
| Cuotas PAID sin `paid_at` (el endpoint de pago no la registra) | 54 de 60 |
| `total_installments` copiado en cada cuota, distinto del conteo real | 155 de 294 |
| Cuotas que vencen fuera de la vigencia de su póliza | 44 |
| "Peor estado de la empresa": dos versiones en SQL (Seguros y Monitor) con resultados distintos | 2 |
| "Cuota vencida" recalculada en el navegador, con la fecha de hoy en UTC | 1 |
| Auditoría de la cuota: `entity_type = 'CARRIER'` con el id de la póliza | todas |
| Ver las pólizas de una empresa pide `directory.read`; ver una póliza, `insurance.read` | 2 puertas |
| Modal de 878 líneas y 15 estados, fuera del kit (mayúsculas, 9-10 px, fechas "22-05-25") | 1 |

Lo que está bien y se conserva: las tablas (póliza, cuotas, coberturas M:N, equipos cubiertos M:N contra
`public.assets`), el almacenamiento de archivos (el mismo bucket privado y las URLs firmadas de Certificación,
`utils/document_storage.py`) y los grants revocados en la base real. El documento "Póliza de Seguro Vigente" de
Certificación sigue separado, por decisión del usuario (11/10).

## Principio

Como en Directorio y Certificación: **la base guarda hechos; los estados se calculan al leer, con una sola regla.**
La pantalla solo pinta lo que manda la API, con el glosario de `lib/states.ts`.

## Modelo

### Hechos que se guardan

| Tabla | Cambia |
|---|---|
| `insurance_policies` | `status` se retira. Entra `cancelled_at timestamptz` + `cancelled_reason text` (el único estado que decide una persona). `expiration_alert_days` se retira (ver D1) |
| `insurance_installments` | `payment_status` y `total_installments` se retiran. Entran `paid boolean NOT NULL DEFAULT false`, `paid_on date` (nullable: "pagada, fecha no registrada") y `paid_by uuid`; `paid_at` se retira |
| `app.alert_thresholds` | Fila nueva `poliza_por_vencer` (`warning_days` = 30), el mismo mecanismo que `documento_por_vencer` |

`paid` y `paid_on` son dos columnas a propósito: un `null` no puede querer decir a la vez "impaga" y "pagada sin fecha"
(feedback "un null con dos significados").

### Estados que se calculan (una vista normal, no materializada)

`app.insurance_status` reemplaza a `app.carrier_insurance_status` (se borran la vista materializada, sus 4 triggers y
`public.refresh_insurance_view`):

- **Póliza** (`policy_state`): `CANCELLED` si `cancelled_at` · `EXPIRED` si `valid_to < hoy` · `EXPIRING` si
  `valid_to <= hoy + poliza_por_vencer` · `VALID` en otro caso · `NO_DATES` si falta `valid_to`.
- **Cuota** (`installment_state`): `PAID` si `paid` · `OVERDUE` si `due_date < hoy` · `PENDING`. Más
  `outside_validity` (`due_date` fuera de `valid_from..valid_to`) como señal aparte, no como estado.
- **Empresa** (`app.carrier_insurance_summary`, una sola vista): peor estado de sus pólizas no canceladas, cuotas
  impagas, próxima cuota y `insurance_alert` (D2). La usan la lista de Seguros, la pestaña Seguros de la ficha de
  empresa y el Monitor (`trips.py`), que deja su `LATERAL` propio.

"Hoy" es la fecha de Chile (`(now() AT TIME ZONE 'America/Santiago')::date`), una sola expresión.

### Migración de datos (no inventa nada)

1. `paid := (payment_status = 'PAID')`; `paid_on := paid_at::date` (las 54 sin fecha quedan `paid = true, paid_on = null`).
2. `status = 'CANCELLED'` → `cancelled_at = updated_at` (hoy: 0 filas).
3. Se borran `status`, `payment_status`, `total_installments`, `expiration_alert_days` (copia previa de las 4 columnas
   en `audit_log`, como la migración de umbrales del 15/10).
4. Las 44 cuotas fuera de vigencia **no se tocan**: quedan con la señal `outside_validity` para que alguien las revise.

Se ensaya en la copia local y con `ROLLBACK` en la base real; se aplica solo con autorización del usuario.

## API

- Todos los endpoints de Seguros piden `insurance.read` para leer y `policies.edit` / `policies.delete` para escribir
  (incluido `GET /carriers/{id}/policies`, que hoy pide `directory.read`).
- `GET /policies` (nuevo): la lista de Pólizas, con `group_by=policy|carrier`, filtros por estado (incluye
  `NO_POLICY` agrupando por empresa, `UNPAID` y `NO_FILE`) y `facets`. Reemplaza a `/carriers/insurance-overview`.
- `GET /installments` (nuevo): la cola de Cuotas, filtros `OVERDUE | DUE_30 | PAID | ALL`, con empresa y póliza.
- `POST /installments/pay` (nuevo, en lote): `{ ids, paid_on }`, guarda `paid_by`; reemplaza el PATCH de una cuota.
- `POST /policies/{id}/installments/generate` rechaza (422) cuotas fuera de la vigencia.
- `POST /policies/{id}/cancel` con motivo (reemplaza `status = CANCELLED`).
- Auditoría: `entity_type = 'INSURANCE_POLICY'` con el id de la póliza para la póliza y sus cuotas.
- Cada fila trae su estado calculado; ningún cliente lo recalcula.

## Pantallas

Seguros pasa a ser un **grupo con submódulos** en el menú, como Directorio y Certificación (un submódulo por objeto
de trabajo):

- **Seguros › Pólizas** (`/dashboard/insurance`): lista con el kit. Agrupar por Póliza o Empresa (`SegmentedControl`,
  como Pendientes); agrupando por empresa aparecen las que no tienen póliza (18 de 36 activas). Filtros por estado.
  Cada fila abre la ficha de la póliza; la empresa, su vista rápida.
- **Ficha de póliza** (`/dashboard/insurance/policies/[id]`): la forma de las fichas (`ProfileLayout`). Encabezado:
  aseguradora · N°, chips de estado, la empresa; "Registrar pago" y el ⋯ (cancelar, eliminar). Centro: Cuotas (tabla del
  kit con selección múltiple y "Marcar pagadas…") y Documentos (póliza y endoso, con las filas de documentos del kit).
  Costado: Detalles (aseguradora, N°, vigencia, empresa, portal, endoso; "Editar"), Coberturas y Equipos cubiertos.
- **Seguros › Cuotas** (`/dashboard/insurance/installments`): la cola de pagos, con selección múltiple y barra
  contextual. El contador del menú son las cuotas vencidas.
- **Ficha de empresa › Seguros**: la tabla de Pólizas filtrada por la empresa (la misma, no una segunda); la fila
  abre la ficha de póliza.
- Se borran `InsurancePolicyModal` (878 líneas) y `POLICY_HEALTH_CONFIG`; los estados entran a `lib/states.ts`.
- El catálogo de coberturas se queda donde está, sin pantalla nueva: dónde se edita lo decide el rediseño de
  Configuración (usuario, 15/10: Configuración "se está volviendo un Frankenstein"; es un proyecto aparte).

## Estados de cada pantalla

- **Cargando:** sin cifras ni chips hasta tener el dato (un "0" en vuelo miente).
- **Vacío:** "No hay pólizas registradas" / "No hay cuotas vencidas", sin tabla vacía.
- **Sin permiso:** sin `policies.edit` se ve todo y no se ven "Registrar pago", "Editar", "Subir" ni la selección.
- **Falló:** al pagar en lote, lo que falló se dice por cuota y lo pagado queda pagado.
- **Teléfono:** el panel lateral arriba, las tablas se desplazan dentro de su tarjeta.

## Decisiones (recomendación marcada; el usuario confirma al revisar esta spec)

- **D1, plazo de "Por vencer":** un solo dato en la base (`app.alert_thresholds`, fila `poliza_por_vencer`, 30 días),
  el mismo mecanismo que `documento_por_vencer`, **sin pantalla en Configuración** hasta que Configuración se rediseñe
  (usuario, 15/10). Las 33 pólizas tienen hoy 30 días y nadie lo cambió nunca, así que no se pierde nada.
- **D2, "2 o más cuotas impagas":** es una regla del negocio, no solo del Monitor: vive en la vista de la empresa
  (`insurance_alert`) y la muestran Seguros, la ficha de empresa y el Monitor. *Recomendado.*

## Criterios de aceptación (un test por criterio)

| # | Criterio | Nivel |
|---|---|---|
| S1 | Una póliza con `valid_to` ayer es `EXPIRED` sin que nadie escriba nada (no hay vista materializada) | base local + real |
| S2 | La cuota impaga con fecha pasada es `OVERDUE`; pagada es `PAID` aunque no tenga fecha | base local |
| S3 | Pagar en lote guarda `paid`, `paid_on` y `paid_by`, y deja una auditoría por cuota con el id de la póliza | pytest |
| S4 | Generar cuotas fuera de la vigencia responde 422 | pytest |
| S5 | La migración conserva las 60 pagadas (54 sin fecha) y no toca las 44 fuera de vigencia | base local + ROLLBACK real |
| S6 | El peor estado de la empresa es el mismo en `/policies?group_by=carrier`, la ficha de empresa y `/trips` | pytest |
| S7 | Ningún endpoint de Seguros responde con `directory.read` solo | pytest |
| S8 | El menú tiene Seguros › Pólizas y Seguros › Cuotas, con el contador de vencidas | vitest |
| S9 | La ficha de póliza dibuja Cuotas y Documentos al centro y Detalles, Coberturas y Equipos al costado | vitest |
| S10 | La pestaña Seguros de la empresa es la misma tabla de Pólizas filtrada | vitest |
| S11 | Ninguna pantalla recalcula un estado de Seguros (guarda contra `due_date <` y `toISOString` en el código) | vitest |
| S12 | Humo: Pólizas → ficha → marcar una cuota pagada en la copia local | Playwright |

## Fuera de alcance

- Avisos por correo de pólizas por vencer (el estado ya queda listo para un proceso diario).
- Unir el documento "Póliza de Seguro Vigente" de Certificación con la póliza de Seguros (decisión del 11/10).
- Montos en pesos o reajuste de la UF.
