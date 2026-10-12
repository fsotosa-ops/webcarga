# Auditoría de estados: empresa, flota y documentos (12/10, solo lectura)

Pedido del usuario durante el brainstorming de D1: "me mezclas el estado de la empresa con la documentación; audita en la
base y en el frontend; no quiero parches". Conteos con SELECT sobre la base real (12/10).

## Hallazgo principal

Configuración **no** define estados de documento. Configuración › Certificación edita las *reglas* que los producen:
- Condiciones de documentos: `compliance_requirements` (`requirement_level`, `exigible_on`, `expiration_policy`, `is_active`)
  y `public.compliance_requirement_rules` (`warning_days`, `grace_days`; 53 filas, 6 con `warning_days` propio, 0 con gracia).
- Alertas de vencimiento: `app.alert_thresholds` (`routers/config.py:225-263`). **Solo se lee `documento_por_vencer` (30 días)**
  (`vencimientos.py:50-53`); las filas por documento, todo `error_days` ("Crítico") y `compliance_min_pct` no los lee ninguna lógica.
  La pantalla promete una alerta roja que no existe (`umbrales-tabs.tsx:44,53-54`).

`app.status_taxonomies` no tiene dominio de documentos (CHECK: OPERATIONAL_STATE, DRIVER_REASON, EQUIPMENT_STATE,
FLEET_SERVICE_TYPE, WEBCARGA_OPERATION_TYPE, TRIP_UNASSIGNED_REASON, TRIP_VOID_REASON). Toda etiqueta y color de estado de
documento o de ciclo de vida está escrita a mano en el frontend.

## Inventario

### A. Ciclo de vida de la entidad (dato, lo decide una persona)
- `carriers.operational_status` (varchar, **sin CHECK**): ACTIVE 36, INACTIVE 9, LEGACY_INACTIVE 205, ONBOARDING 1.
  Etiquetas `OPERATIONAL_STATUS_LABELS` (`lib/types.ts:964-969`); colores aparte en `TransporterCard.tsx:10-15`.
- `drivers` / `assets.operational_status` (sin CHECK): ACTIVE 93/136, INACTIVE 8/3. `statusLabel()` (`types.ts:974-983`),
  `ChipDeBaja.tsx`. El TS admite LEGACY_INACTIVE para flota; Python y los datos no.
- Asignaciones `status` ACTIVE/INACTIVE (solo `vehicle_driver_assignments` con CHECK).

### B. Estado guardado del registro (`compliance_records.status`)
CHECK: MISSING, PENDING_REVIEW, APPROVED_MANUAL, APPROVED, REJECTED, EXPIRED, ARCHIVED. **En uso solo MISSING 5.318 y
APPROVED_MANUAL 386.** El vencimiento nunca se guarda: 116 APPROVED_MANUAL ya vencieron por fecha. Es el registro de lo que
pasó con el archivo, no su vigencia. Aun así `COMPLIANCE_STATUS_CONFIG` (`lib/compliance.ts:7-15`) lo muestra como estado
("Aprobado (manual)" sobre un documento vencido) y `DocumentChecklist.tsx:65-68` ofrece elegir valores que nunca se guardan.
Enums sin uso: `app.compliance_status`, `app.installment_status`, `app.upload_status`.

### C. Estado derivado del documento
- **Canónico:** `document_state_sql` (`vencimientos.py:374-393`): NOT_REQUIRED, UP_TO_DATE, OVERDUE, EXPIRING, MISSING.
  Hoy: CARRIER 3.130 MISSING / 137 UP_TO_DATE / 35 OVERDUE; DRIVER 1.065 / 120 / 26 OVERDUE / 1 EXPIRING; ASSET 1.122 / 23 / 44 OVERDUE.
  Lo usa Pendientes (`lib/pending.ts:31-56`).
- **Paralelos que lo reimplementan:** `urgencia` (ES, `compliance.py:603-608`); `nodeState` (`DocumentChecklist.tsx:70-79`);
  `mandatoryProblems` (`carriers/[id]/page.tsx:390-393`) y `TransporterAlertBanner.tsx:25-28`; `complianceAlertStatus`
  (`lib/compliance.ts:54-60`); `ComplianceBadge.tsx`; `entity_summary.py:24-37` (expired/expiring/missing/ok); semáforo del
  Diario (`trips.py:620-665` → `PendingDocsBadge.tsx`); `FiltroDeEstado.tsx:14-17`.

### D. Agregados por entidad o empresa
- `compliance_health` (`carriers.py:60-76`): PENDING si algún obligatorio está pendiente. **Las 251 empresas son PENDING**,
  el verde "Al día" no aparece nunca.
- Embudo `funnel_group` (`compliance.py:374-384`): mezcla ciclo de vida ("No activas") con documentos.
- `checklistCompletion` "docsOk/docsTotal" (`[id]/page.tsx:389`); `pending_count/satisfied_count/pending_mandatory` (`compliance.py:408-424`).

## Conflictos
1. Ciclo de vida dentro del embudo documental ("No activas", `compliance.py:375-377`).
2. Empresa: chip de ciclo de vida y chip documental lado a lado → 205 LEGACY dicen "Dada de baja" + rojo "N pendientes".
   Conductor/equipo: `ChipDeBaja` reemplaza al documental.
3. ONBOARDING en alcance en el embudo (`compliance.py:35`) y fuera en Pendientes (`vencimientos.py:424`).
4. "Al día" significa cuatro cosas (`compliance_health` OK, embudo `al_dia`, `nodeState` ok, seguro VALID).
5. "Pendiente" tiene cinco definiciones (backend incluye EXPIRING y respeta `exigible_on`; frontend incluye REJECTED, excluye
   EXPIRING e ignora `exigible_on`).
6. "Falta" tiene tres significados; 7. "Vencido" tres fuentes; 8. "Con vencimientos" del embudo ignora lo por vencer.
9. Un concepto, cinco vocabularios (`document_state`, `urgencia`, minúsculas de `entity_summary`, `AlertStatus`, `PendingFilter`).
10. El estado guardado se muestra como si fuera el vigente.
11. Configuración promete una alerta roja que nadie calcula.
12. Etiquetas de ciclo de vida centralizadas pero colores aparte; pestañas "Inactivas" pese a la decisión de "Dada de baja".
13. Deriva TS/DB y sin CHECK en `operational_status`.
14. Los colores configurables solo se usan en vocabularios que no son de documentos.
