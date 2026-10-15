# Entrega D: una forma de subir documentos y "Por asignar" como bandeja de excepciones

Maqueta: `docs/superpowers/mockups/2026-10-15-sin-clasificar-bandeja.html`. Antecedente: auditoría UX del 11/10
(`2026-10-11-sin-clasificar-ux-audit.md`, opción C). Mismo método que A, B y C: ejecución inline, un test por criterio de
aceptación, humo E2E, un despliegue y una revisión.

## Por qué (14-15/10)

Sin clasificar es hoy una tercera forma de subir, con su propio modelo (elegir empresa primero, clasificar de a uno en dos
pasos), al lado de Pendientes (por requisito, con revisión de lote) y de la ficha de empresa › Documentos (por fila). Casi
siempre está vacía (152 ítems en total, 0 pendientes; la última tanda fue la semana del 28/09), y su estado vacío es un
banco de trabajo con instrucciones. El estándar (Ramp/Expensify, Dext/Hubdoc, Vanta/Drata): **una forma de subir que usa
el contexto disponible, propuesta del sistema confirmada en lote, y una bandeja solo para lo que no se pudo asignar,
agrupada por qué falta.**

**Objetivo que se mantiene (HU-01):** recibir tandas mezcladas con nombres que no dicen nada y no certificar nada sin
confirmación de una persona.

## HU

- **D-1 Subir documentos, en cualquier contexto.** Como Certificación, subo una tanda desde Pendientes (tipo fijado), desde
  la ficha de una empresa (empresa fijada) o desde Por asignar (nada fijado), y en los tres veo la misma revisión: a quién
  va cada archivo, agrupado en Asignados / Por elegir / Sin asignar, y guardo los listos.
- **D-2 Lo que no se asignó no se pierde.** Al guardar, lo que quedó Sin asignar va solo a Por asignar con lo que ya se
  sabía (el tipo, la empresa, o ambos).
- **D-3 Por asignar es la bandeja.** Veo solo lo pendiente, agrupado por qué falta (Falta el titular / Falta el tipo / Sin
  pista); el detalle muestra el documento grande con la propuesta ya elegida, y lo resuelvo con Asignar ·
  Cambiar · Descartar; al resolver, pasa al siguiente. Vacía, dice "Todo asignado" y ofrece "Subir documentos".

## Criterios de aceptación

| # | Criterio | Nivel |
|---|---|---|
| D1 | `POST /compliance-records/pending/match` sin `requirement_id` propone tipo y titular por el nombre (el mismo matcher de la bandeja); con `carrier_id`, acota el universo a esa empresa; con `requirement_id`, se comporta como hoy | base real |
| D2 | La subida a la bandeja guarda el tipo y la empresa declarados, y el ítem cae en el grupo que corresponde | base real |
| D4 | La revisión de lote se abre sin contexto y con empresa fijada (misma prop, mismo componente) | vitest |
| D5 | Lo Sin asignar se guarda en la bandeja con su tipo/empresa al guardar | vitest |
| D6 | Por asignar agrupa por qué falta y, al asignar, pasa al siguiente | vitest |
| D7 | Por asignar vacío muestra "Todo asignado" y "Subir documentos", sin zona de arrastre ni selector de empresa | vitest |

## Contratos

- `POST /compliance-records/pending/match`: `requirement_id` pasa a opcional y se agrega `carrier_id` opcional. Sin
  requisito, cada archivo trae `requirement` propuesto además de candidatos de titular. Mismo tope de archivos.
- `POST /document-ingest/files` y `/{carrier_id}/files`: ya aceptan empresa y tipo declarado (Entrega A); se usan para lo
  Sin asignar.
- Menú y ruta: etiqueta **"Por asignar"** (sigue el vocabulario de la revisión); la ruta queda `/dashboard/compliance/inbox`.

## Tareas

1. Backend: match generalizado (D1) sobre el reconocedor único, y lo que ya se sabe del ítem en `GET /items` (D2).
2. Frontend: `BulkUploadReview` con prop de contexto (`requirement` | `carrier` | ninguno) y el botón "Subir documentos"
   (D4, D5); la ficha de empresa cambia "Llévalos a Sin clasificar" por "Subir documentos" con la empresa fijada.
3. Frontend: Por asignar como lista y detalle agrupado (D6), estado vacío (D7), overlay de arrastre sobre la página;
   retirar la zona de carga permanente, el selector de empresa y el flujo de dos pasos (`TriageWorkbench` en lo que
   quede sin uso). Descartados se mantiene.
4. Humo: subir sin contexto y guardar; resolver un ítem en Por asignar. Suite del backend contra la base real, despliegue,
   recorrido en dev.

## Cambios durante la ejecución (15/10)

- **Un solo reconocedor** (pedido del usuario: "¿eso no es un parche?"). Había dos para la misma pregunta:
  `match_owner` (Pendientes) y `match_document` (la bandeja), con escalas y reglas distintas. Generalizar
  `/pending/match` con un `if` era esconder dos sistemas. Ahora `match_document` es el único; el contexto lo ACOTA
  (`declared_requirement`, universo por empresa) y no cambia el algoritmo. Reglas comunes: empresa por nombre, 0,60
  sin tipo, un identificador gana a los nombres **de su familia**, deduplicar (entidad, tipo), choques P23
  (`resolve_collisions`). Se retiraron `match_owner`, `PendingOwner`, `OwnerCandidate`, `classify_owner_match` y el
  `_dedup_candidates` del router de la bandeja; el tipo declarado en la subida pasa como contexto, no se sobrescribe
  después. Servicio: `services/upload_match.py`.
- **Ronda de mutación acotada al reconocedor** (8 mutaciones, una por regla): 6 murieron, 2 sobrevivieron (0,60 sin
  tipo y deduplicar); se agregaron los dos tests y murieron las 8.
- **Sin asignar en lote por pares (D3) ni grupo "Duplicados":** la confirmación en lote ocurre en la revisión, ANTES de
  subir, y va directo al registro; a Por asignar llega solo lo no resuelto, que se resuelve de a uno. El duplicado
  exacto no entra (se informa al subir). Construirlos sería capacidad sin uso.
- **La revisión es la misma en los tres contextos** (`BulkUploadReview` + `useBulkUpload` con prop de contexto): la
  regla del tipo es de cada fila (sin contexto, cada archivo trae su tipo); el período es por tipo; lo no resuelto va a
  Por asignar al guardar, en lotes de 50 (límite del backend). En Por asignar y la ficha se abre en `PanelLateral`
  (variante `ancho="amplio"`); en Pendientes sigue en línea.
- **Por asignar** reutiliza el banco de trabajo (cola, vista previa, formulario, deshacer, descartar): sale la carga
  propia (zona de arrastre, selector de empresa, `useEmpresaDeTrabajo`, `TriageDropzone`, `PuenteALaBandeja`); la
  empresa de un archivo sin empresa se pregunta en su detalle; la propuesta llega ya elegida; Enter asigna.
- Ciclo latente corregido: `matcher_io` importaba una constante de un router (`FUNNEL_ACTIVE_STATUSES` pasa a
  `schemas/carrier.py`).

## Lo que no cambia

Confirmación humana (HU-01), descarte lógico con restauración, dedupe por hash, renovación que reemplaza solo si vence
después, permiso `documents.review` para ver la bandeja.

## Decisiones pendientes del usuario

1. **Nombre:** "Por asignar" (recomendado) o mantener "Sin clasificar".
2. **"Confirmar N" de lo seguro** (≥ 0,90): en la revisión ya existe como "Guardar los N listos". Se mantiene igual en el
   flujo sin contexto.
