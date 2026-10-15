# Entrega 2: Empresas y Por asignar con el kit

**Spec:** `docs/superpowers/specs/2026-10-15-fichas-directorio-y-navegacion-design.md` (sección "Entrega 2").
**Método (14/10):** ejecución inline, un test por criterio, humo E2E antes de desplegar, un despliegue.
**Alcance:** solo pantalla. No se toca el backend, así que no se corre la suite del backend.

## Global Constraints

- Español neutral, sin voseo. Cero emojis: solo `lucide-react`.
- Solo tokens del sistema visual. Los topes de `lib/ui/sistema.test.ts` y `lib/ui/escala.test.ts` bajan al número real
  en el mismo commit.
- Nombres nuevos de código en inglés.
- Las piezas son las del kit de la Entrega 1: `SegmentedControl`, `Table`/`TableHeader`, `CABECERA`, `ComplianceCounts`,
  `StatusChip`, `EntityCell`, `EncabezadoDePagina`. No se escribe una segunda versión de ninguna.

## HU

Como Certificación, quiero que Empresas y Por asignar se vean y se manejen igual que Pendientes y las fichas, para no
tener que leer cada pantalla con reglas distintas.

## Criterios de aceptación (un test por criterio)

| # | Criterio | Archivo del test |
|---|---|---|
| E2-1 | Empresas agrupa con `SegmentedControl` (Empresa · Requisito, con el elegido marcado) y cada fila cuenta con `ComplianceCounts` | `app/dashboard/compliance/page.test.tsx` |
| E2-3 | La lista de empresas tiene encabezados de columna: Empresa · Tipo · Viajes 30 días · Avance · Pendientes | `components/compliance/CertificationFunnel.test.tsx` |
| E2-4 | "Nueva empresa" es la acción principal: botón lleno, en el encabezado de la página | `app/dashboard/compliance/page.test.tsx` |
| E2-2 | Por asignar dibuja su tabla con la cabecera del kit: sin mayúsculas ni monoespaciado en el nombre de archivo | `components/compliance/TriageFileTable.test.tsx` |
| E2-5 | La sugerencia es una línea: el requisito, el titular como `EntityCell` (enlace a su vista rápida) y el % en gris | `components/compliance/TriageFileTable.test.tsx` |
| E2-6 | Los avisos ("3 archivos reclaman el mismo casillero") van con su ícono dentro de la celda del archivo, no en una franja aparte | `components/compliance/TriageFileTable.test.tsx` |
| E2-7 | El título de Por asignar no lleva el total (queda en el menú y en los grupos) | `components/compliance/TriageWorkbench.test.tsx` |

Los tests que ya existen y fijan la forma vieja (por ejemplo, el que busca la sugerencia como texto plano unido con
" · ") se ajustan en el mismo commit, diciendo por qué.

## Contratos

- **Agrupar por (Empresas):**
  - `SegmentedControl label="Agrupar por"` con `Empresa` y `Requisito`. Cambiar sigue escribiendo `?vista=` como hoy.
  - "Conductor" y "Vehículo" no son agrupaciones: abren el Directorio. Siguen como enlaces con `ArrowUpRight`, al lado
    del control y fuera de él, porque un enlace dentro de un control segmentado promete quedarse en la pantalla.
- **Encabezados del embudo:** `TableHeader` debajo del filtro de ciclo de vida, una sola vez. Cada columna con el
  mismo ancho que su celda en `FilaEmpresa`: Tipo y Viajes se ocultan en el teléfono, como sus celdas. Las filas
  plegables por balde se quedan.
- **Acción principal:** "Nueva empresa" pasa a `EncabezadoDePagina` (children), con el estilo del botón de Por
  asignar ("Subir documentos"): lleno, celeste, con ícono. "Actualizar por planilla" va al lado, como secundario. Los
  dos se ven con cualquier agrupación: actúan sobre empresas, no sobre la vista.
- **Tabla de Por asignar:** los `<th>` usan `CABECERA`. El nombre de archivo va en `text-dato` sin `font-mono`; la
  fecha también en `text-dato`.
- **Sugerencia:** `{requisito} · <EntityCell kind={tipo} id={suggested_entity_id} label={titular}/> <span gris>85%</span>`.
  Sin borde ni fondo. El tipo sale de `suggested_entity_type` (CARRIER → empresa, DRIVER → conductor, ASSET → equipo).
  Sin titular resuelto, el nombre es texto. "N posibles" pasa a `StatusChip tone="warning"`.
- **Avisos:** dentro de la celda del archivo, debajo del nombre, con `AlertTriangle` en `text-warning` y el texto en
  `text-informativo`. Se borra la fila `bg-espera/5`: el rojo de espera es solo para "hay archivos esperando".
- **Título de Por asignar:** pasa a `EncabezadoDePagina` ("Por asignar" y su bajada, con "Subir documentos" en
  children). Sin el total.

## Estados

- **Vacío:** sin cambios (Empresas: "Ninguna" por balde; Por asignar: "Todo asignado").
- **Cargando:** la cabecera de columnas no se dibuja hasta que hay filas, para no prometer una tabla vacía.
- **Sin permiso:** "Nueva empresa" y "Actualizar por planilla" se ven como hoy (la planilla ya respeta
  `directory.edit` adentro). Por asignar sin `documents.review` no ve "Subir documentos", como hoy.
- **Falló:** sin cambios.
- **Teléfono:** la cabecera de columnas se oculta (`TableHeader` ya lo hace) y la fila queda como hoy.

## Tareas

1. **Empresas** (`app/dashboard/compliance/page.tsx`, `components/compliance/CertificationFunnel.tsx`): E2-1, E2-3,
   E2-4. Test rojo → cambio → verde, criterio por criterio. Bajar los topes de los trinquetes.
2. **Por asignar** (`components/compliance/TriageFileTable.tsx`, `TriageWorkbench.tsx`): E2-2, E2-5, E2-6, E2-7.
   Igual.
3. **Verificación:**
   - `npx tsc --noEmit` y `npx vitest run components/compliance app/dashboard/compliance lib/ui`.
   - Humo E2E en la copia local (los 20 recorridos de hoy; Certificación y Por asignar ya están en la matriz por rol).
   - Capturas de Empresas y Por asignar, en escritorio y en teléfono, al lado de la ficha alineada.
4. **Commit y push a `dev`.** Esperar Deploy Frontend en verde y recorrer dev con sesión, solo lectura.
5. **AGENTLOG:** la Entrega 2 cierra la spec de fichas y navegación. Se archiva el checkpoint. Lo siguiente es la decisión
   del usuario sobre pasar todo a `main`.

## Review Focus

- Una empresa con `management_types` vacío y sin viajes: las columnas no se corren (las celdas vacías conservan su ancho).
- Una fila de Por asignar con sugerencia de titular sin `suggested_entity_id`: el nombre es texto, no un enlace roto.
- El clic en el titular de la sugerencia abre la vista rápida y no enfoca ni selecciona la fila.
- La navegación con flechas y espacio de la tabla sigue funcionando con un enlace adentro.
- Una fila con las tres señales a la vez: las tres líneas caben en la celda sin romper la tabla en el teléfono.
