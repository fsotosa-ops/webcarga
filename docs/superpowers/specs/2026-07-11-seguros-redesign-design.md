# Design: Rediseño del módulo Seguros — pólizas, cobranza y checklist de documentos
**Date:** 2026-07-11
**Status:** Approved

---

## Context

El módulo Seguros (`/dashboard/seguros`) hoy es una sola vista: tarjetas expandibles por empresa que muestran, al abrir, sus pólizas con un timeline horizontal de cuotas (marcar pagada) y un único archivo versionado por póliza (commit `9ed2c03`, sesión anterior).

El objetivo explícito del usuario es que la app reemplace por completo los Excel que hoy usa el equipo para gestionar seguros, pensando el módulo como **el sistema propio de una aseguradora**: gestión de documentos por póliza + monitoreo de pagos, con la doble exigencia de que sea "fullfuncional, intuitivo, baja carga cognitiva, world-class".

Un problema adicional motivó este rediseño: hoy cada póliza solo puede tener UN archivo genérico. En la práctica, distintos documentos de una póliza (póliza firmada, certificado de vigencia, endoso, comprobante de pago) tienen su propio ciclo de vida — y a futuro, distintos clientes GC (Walmart/Colun/Sodimac/Iansa) podrían exigir su propia documentación específica, igual que ya ocurre con `app.compliance_documents`/`client_document_requirements` en Empresas (auditoría de datos del 2026-07-10).

**Fuera de alcance de este spec** (confirmado con el usuario): el rediseño de Empresas queda para una sesión de brainstorm separada — este spec solo define Seguros, pero el componente de checklist de documentos se diseña como una pieza genérica reusable ahí después.

---

## Decisiones de arquitectura

| Decisión | Elección | Alternativa descartada |
|----------|----------|------------------------|
| Estructura de navegación | 2 tabs (Pólizas / Cobranza), cada uno con sus propios KPIs accionables | Una sola vista unificada mejorada; 3 vistas separando también un "vault" de documentos |
| Layout de Cobranza | Tabla densa con columnas alineadas en grid (no `<table>` apretada), agrupable por Semana/Mes/Trimestre/Empresa/Aseguradora/Cliente GC, "Vencidas" siempre fija arriba con subtotal propio | Tabla `<table>` cruda sin agrupamiento (se sintió "densa y desordenada" en el mockup); agrupado solo por urgencia sin control de agrupamiento |
| Checklist de documentos | Nodos circulares (mismo lenguaje visual que el timeline de cuotas ya existente) | Grid de tarjetas/tiles; tabla de requisitos; vault estilo Google Drive con thumbnails |
| Modelo de documentos por póliza | Catálogo data-driven (`insurance_doc_catalog` + `insurance_documents`, un archivo versionado por tipo de documento) | Mantener un solo archivo genérico por póliza (statu quo) |
| Alcance de esta sesión | Solo Seguros; Empresas se rediseña después reusando el componente de nodos | Rediseñar ambos módulos en la misma sesión |

---

## 1. Navegación: dos tabs

`/dashboard/seguros` gana un selector de tabs (mismo patrón visual que los tabs ya usados en Configuración):

- **Pólizas** (default) — registro de empresas → pólizas → checklist de documentos.
- **Cobranza** — libro de cuotas de todas las empresas.

Cada tab trae su propia franja de KPIs accionables (click = filtro), igual que ya funciona en Empresas/Diario. Cruces entre tabs: cada fila de Cobranza tiene un link a su póliza en Pólizas (scroll + expand automático, mismo patrón que hoy usa `?rut=` para llegar desde Empresas); cada póliza en Pólizas con cuotas pendientes muestra un link "Ver en Cobranza".

## 2. Tab Pólizas

KPIs accionables:
- **Vencen en 30 días** — pólizas cuyo `valid_to` cae dentro de 30 días (alerta de renovación).
- **Sin pólizas registradas** — empresas de Empresas sin ninguna fila en `insurance_policies`.
- **Documentos incompletos** — pólizas con al menos un `doc_code` del catálogo sin `status='ok'`.

Estructura (igual jerarquía que hoy, con el checklist nuevo):
```
Empresa (registro, expandible)
  └─ Póliza (aseguradora, número, vigencia, tipo)
       └─ Checklist de documentos (nodos circulares) — Póliza firmada · Certificado de vigencia · Endoso · Comprobante de pago
       └─ Timeline de cuotas (sin cambios respecto al diseño actual)
```

## 3. Tab Cobranza

Tabla con grid de columnas alineadas (no `<table>` HTML cruda): Vence | Empresa | Aseguradora | Póliza | Cuota | Monto UF | acción "Pagar" inline. Cada fila coloreada por estado (vencida=rojo, pendiente próxima=ámbar).

**Agrupamiento** (control tipo chips arriba de la tabla): Semana | Mes | Trimestre | Empresa | Aseguradora | Cliente GC | Sin agrupar. Cada grupo muestra un header compacto (label + count + subtotal en UF) y es colapsable; grupos lejanos en el tiempo colapsan por defecto. **"Vencidas" es un grupo fijo que siempre aparece primero**, independiente del agrupamiento temporal elegido (agrupar por Empresa/Aseguradora/Cliente GC no separa vencidas en un grupo aparte — ahí el estado se lee en la fila).

Necesita una vista nueva `app.v_insurance_installments_flat` (join cuota→póliza→transportista, mismo patrón que las vistas de elegibilidad ya existentes) y un endpoint delgado sobre ella que devuelva cuotas en formato plano — no anidadas bajo póliza/empresa, para poder agrupar del lado del cliente sin N llamados por empresa. El volumen actual (284 cuotas) no justifica agregación server-side; el agrupamiento (por semana/mes/trimestre/empresa/aseguradora/cliente GC) se hace en memoria en el cliente.

## 4. Componente compartido: checklist de documentos (nodos circulares)

Mismo lenguaje visual que `TimelineNode` (el componente que ya renderiza las cuotas): círculo con ✓/○/⚠ + color por estado + label debajo. Se construye como un componente genérico parametrizado por una lista `{ doc_code, label, status, expiry_date, file }[]` — no conoce si viene de una póliza de seguro o de un documento de transportista/conductor/vehículo. Esto es intencional: es la pieza que se va a reusar en el rediseño de Empresas.

## 5. Modelo de datos nuevo

```sql
-- Catálogo data-driven — agregar un tipo de documento nuevo es un INSERT, no un deploy.
create table app.insurance_doc_catalog (
  doc_code    text primary key,
  label       text not null,
  has_expiry  boolean not null default false,
  sort_order  int not null default 0
);
-- seed inicial: poliza_firmada, certificado_vigencia, endoso, comprobante_pago

-- Un estado/archivo por (póliza, tipo de documento) — mismo patrón que app.compliance_documents.
create table app.insurance_documents (
  id               uuid primary key default gen_random_uuid(),
  policy_id        uuid not null references app.insurance_policies(id) on delete cascade,
  doc_code         text not null references app.insurance_doc_catalog(doc_code) on update cascade,
  status           app.compliance_status,   -- reusa el enum existente (ok/pendiente/actualizar/n_a/factible)
  expiry_date      date,
  file_url         text,
  storage_path     text,
  notes            text,
  source           text not null default 'manual',  -- estos documentos no vienen del pipeline centralizer
  manual_override  boolean not null default true,
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  unique (policy_id, doc_code)
);

-- app.stored_files gana un owner_type nuevo para versionar cada insurance_document por separado.
alter table app.stored_files drop constraint stored_files_owner_type_check;
alter table app.stored_files add constraint stored_files_owner_type_check
  check (owner_type in ('compliance_document', 'insurance_policy', 'insurance_document'));
```

`owner_type='insurance_policy'` (el archivo único actual) queda **obsoleto**. Migración: por cada `stored_files` existente con `owner_type='insurance_policy'`, crear la fila `insurance_documents` correspondiente con `doc_code='poliza_firmada'` (no hay forma de distinguir qué representaba ese archivo único, así que se asume el caso más común) y reapuntar `owner_id` a esa fila nueva — sin duplicar el archivo físico en Storage.

RLS: mismo patrón que el resto del módulo — `insurance_documents`/`insurance_doc_catalog` con SELECT abierto a `authenticated`, escritura restringida a `editor`/`admin`/`owner` (igual matriz que se aplicó a `compliance_documents` en la auditoría del 2026-07-10).

## 6. Manejo de errores

Mismos patrones ya establecidos en el módulo: optimistic locking en PATCH de cuotas (`expected_updated_at`, 409 si cambió), errores de upload visibles inline (no silenciosos), `manual_override` protege ediciones manuales de que el pipeline las pise (aunque `insurance_documents` no tiene fuente de pipeline hoy, se deja el campo por si en el futuro algún doc se automatiza).

## 7. Testing

- Backend: pytest para el nuevo router/endpoints de `insurance_documents` (CRUD + upload + versionado), igual patrón que `test_transporters_relational.py`.
- Frontend: vitest para el componente de checklist genérico (nodos) con distintos estados, y para el agrupamiento de Cobranza (casos: vencidas siempre primero, grupos vacíos ocultos, subtotales correctos).
- Verificación manual: smoke visual autenticado (pendiente en sesiones anteriores por falta de sesión de auth) — subir un documento nuevo, marcar cuota pagada desde Cobranza, cambiar agrupamiento y confirmar que vencidas siguen fijas arriba.

## Fuera de alcance de esta ronda

- Rediseño del módulo Empresas — sesión de brainstorm separada, reusa el componente de nodos de este spec.
- Notificaciones proactivas (cuotas por vencer) — la tabla `app.notifications` ya existe, el cron sigue sin implementarse.
- Mapeo real de qué documento exige cada cliente GC — sigue pendiente de negocio (Fabián), igual que en Empresas.
