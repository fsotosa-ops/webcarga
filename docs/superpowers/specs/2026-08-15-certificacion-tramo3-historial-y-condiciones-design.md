# Certificación · Tramo 3 — Condiciones configurables

**Fecha:** 2026-08-15 · **revisado el mismo día**, ver §1.1
**Estado:** aprobado en brainstorming, pendiente de plan de implementación
**Antecede:** `2026-08-15-certificacion-rediseno-design.md` (§7 y §8) y el plan del Tramo 1
**Alcance recortado dos veces respecto del spec original** — ver §7.

---

## 1. Qué resuelve

**La regla de a quién se le exige cada documento vive en código de base**, y WebCarga descubre esas
reglas **reclutando y certificando**, no antes. Cambiar una hoy exige un desarrollador y una
migración.

El daño está medido: **16 vehículos sin cámara de frío** (11 Furgón Seco + 5 Sider) cargan
"Mantención Cámara de Frío", un certificado que no pueden obtener nunca. Son 16 pendientes que
nadie puede cerrar, inflando el contador de sus empresas en la pantalla que el Tramo 2 acaba de
construir.

### 1.1 Corrección: el historial sale de este tramo

La primera versión de este spec incluía el historial de versiones y afirmaba que *"cargar el F30 de
agosto borra el de julio"*. **Eso es falso**, verificado en el código y en los datos:

- Al reemplazar, `upload_document_version` escribe una **ruta nueva con timestamp** y
  `log_document_replacement` registra la anterior en `audit_log`. **El blob viejo no se borra** —
  sólo se borra en el `DELETE` explícito de un archivo.
- `GET /{record_id}/files` ya devuelve el historial con las versiones previas.
- Y nunca se ejerció: hay **28 `document_upload` y 0 `document_replace`** en `audit_log`. Con 95
  documentos cargados sobre 4.990 registros, nadie renovó nada todavía.

Eliminar el índice incondicional sigue siendo deseable —convierte el historial de un *log* en
*filas consultables*, y `is_current` deja de ser una columna muerta que siempre vale `true`— pero
es una **mejora de modelo, no una capacidad nueva**, para un problema que todavía no le ocurrió a
nadie. Se difiere hasta que exista una renovación real.

Con eso, este tramo **no toca el índice único** y los tres triggers se reescriben por una sola
razón: sacarles la regla de negocio de adentro.

## 2. Evidencia medida

Contra `viclzoftiudkepqnhekv`, 2026-08-15:

| Dato | Valor | Implicancia |
|---|---|---|
| Requisitos `LEGAL_MANDATORY` | **33 de 37** | Aplican a todos: no necesitan condición |
| Requisitos `CONDITIONAL_OPTIONAL` | **4** | Todo el mecanismo configurable sirve a 4 filas |
| `MANTENCION_FRIO` sembrado hoy | 20 Furgón Congelado + **11 Furgón Seco + 5 Sider** + 1 sin subtipo | 16 vehículos cargan un certificado que no pueden obtener |
| `SEGURO_RC_EMPRESA` / `SEGURO_EETT` | **0 y 1** registros | La condición nunca se escribió, así que no se siembran |
| Funciones que siembran `compliance_records` | **5** | Sólo 3 llevan la regla adentro: `reconcile_new_asset`, `_carrier`, `_driver`. `reconcile_new_requirement` y `reconcile_carrier_shipper_link` usan `NOT EXISTS` y no la tienen |
| Subtipos de vehículo en el catálogo | **10**, de los cuales 4 con vehículos | La condición de frío se expresa sobre subtipos, no sobre `asset_type` |

## 3. Decisiones

| # | Decisión | Quién |
|---|---|---|
| D10 | **Una sola regla de siembra**: se saca `requirement_level` y los códigos escritos a mano de los tres triggers | Diseño |
| D11 | Las condiciones son **dato en el catálogo**, no código en el trigger | Usuario |
| D12 | Toda configuración va con **recalcular y vista previa**; sin eso la configuración miente | Diseño |
| D13 | El recalcular **nunca borra** un registro con archivo o con edición manual | Diseño |
| D14 | Las pilas, el matcher **y el historial de versiones** salen de este tramo — ver §1.1 y §7 | Usuario |
| D15 | La migración es **behavior-preserving**: no crea ni borra un solo `compliance_record` | Diseño |

## 4. Una sola regla de siembra

**El problema no es que falte una condición: es que hoy hay dos reglas pegadas.**

```sql
-- reconcile_new_asset, hoy
WHERE req.target_entity = 'ASSET'
  AND (req.requirement_level = 'LEGAL_MANDATORY'
       OR (req.requirement_code IN ('MANTENCION_FRIO','RESOLUCION_SANITARIA')
           AND NEW.asset_type = 'RAMPLA'))
```

Dos cosas están mal ahí, y las dos son deuda, no características:

1. **`requirement_level` hace de interruptor de siembra a escondidas.** Es una etiqueta de
   *severidad* — se usa para mostrar "BÁSICA" o "ADICIONAL" en la lista de pendientes
   (`_certification_type`). Que además decida quién recibe qué documento es un segundo significado
   que nadie declaró.
2. **La regla de negocio está escrita como una lista de códigos** dentro de una función de base de
   datos, y mezcla el hecho físico (`asset_type`) con el comercial — justo lo que la migración
   `20260803050000` separó a propósito.

**La versión limpia es una sola regla, con una columna por significado:**

```sql
WHERE req.target_entity = 'ASSET'
  AND req.is_active
  AND (req.applies_to_fleet_service_type_ids IS NULL
       OR NEW.fleet_service_type_id = ANY(req.applies_to_fleet_service_type_ids))
```

Sin `requirement_level`, sin códigos escritos a mano, sin `asset_type`. La misma forma sirve para
los tres triggers, cambiando sólo la dimensión que cada uno mira.

**Las tres columnas nuevas en `compliance_requirements`:**

| Columna | Significado | Nulo significa |
|---|---|---|
| `is_active BOOLEAN NOT NULL DEFAULT true` | ¿Este requisito está vigente? | — (no admite nulo) |
| `applies_to_fleet_service_type_ids UUID[]` | A qué subtipos de vehículo | sin restricción por subtipo |
| `applies_to_management_types TEXT[]` | A qué tipos de gestión de empresa | sin restricción por gestión |

`is_active` dice explícitamente lo que hoy se dice de contrabando: los dos seguros de D8 **no están
vigentes**. Antes eso se lograba por omisión —eran `CONDITIONAL_OPTIONAL` y el trigger sólo miraba
`LEGAL_MANDATORY`—, que es exactamente la clase de comportamiento implícito que hace ilegible un
sistema.

### 4.1 La migración no cambia comportamiento

Es condición de aceptación: aplicar esta migración **no debe crear ni borrar un solo
`compliance_record`**. El cambio de conducta llega después, desde la pantalla, hecho por una
persona.

| Requisitos | `is_active` | Condiciones | Resultado |
|---|---|---|---|
| Los 33 `LEGAL_MANDATORY` | `true` | ambas nulas | Se siembran a todos — **igual que hoy** |
| `MANTENCION_FRIO`, `RESOLUCION_SANITARIA` | `true` | los **9 subtipos de remolque** | Se siembran a toda rampla — **igual que hoy** |
| `SEGURO_EETT`, `SEGURO_RC_EMPRESA` | `false` | — | No se siembran — **igual que hoy** |

**La única diferencia**, y va declarada: hoy la condición es `asset_type = 'RAMPLA'` y pasa a ser
"el subtipo está en la lista". El vehículo con `asset_type = 'RAMPLA'` y **subtipo nulo** (hay 1)
deja de recibir esos dos requisitos. Es lo correcto —un remolque sin clasificar no puede exigir
cámara de frío— pero es un cambio y se verifica explícitamente.

## 5. Por qué arreglos y no una tabla de reglas

Hay **4 requisitos condicionales y dos dimensiones**. Un motor genérico de condiciones —tabla de
reglas con atributo, operador y valores— sería especulativo: este proyecto ya rechazó una vez un
modelo relacional construido por anticipado, y las tres tablas puente que existen cargan nueve
columnas de ciclo de vida que nadie usó nunca.

La forma espeja la decisión **D9** de `management_types`, tomada en el Tramo 2: conjunto, por id,
sin tabla nueva. Si algún día aparece una tercera dimensión —"sólo para vehículos de más de N años",
"sólo para empresas de tal cliente"— migrar a tabla es una migración directa. Antes de eso, sería
construir maquinaria para un caso que nadie pidió.

**La pantalla** vive en Administración: por requisito, marcar si está vigente y a qué subtipos y
gestiones aplica. Es una rebanada angosta de la HU-05, que se retiró del backlog — configura
*cuándo* aplica un requisito, no administra el catálogo ni permite crear requisitos nuevos.

### 5.1 Cuando el atributo llega después que la entidad

El trigger evalúa la condición **al insertar**, pero el atributo del que depende puede no existir
todavía. Los dos casos son reales y frecuentes:

- Un **vehículo** creado en la app sin clasificar: `fleet_service_type_id` queda nulo hasta que la
  ingesta de Mage lo complete. Hoy son 2 de 120.
- Una **empresa** creada sin declarar su gestión: `management_types` queda nulo hasta que registre
  su primer vehículo o alguien la declare. Es el caso por defecto — 246 de 248 empresas.

**Regla: si el atributo es nulo, la condición no se cumple y el requisito no se siembra.** No se
siembra "por las dudas": sembrar de más es exactamente el problema que este tramo viene a corregir,
y un pendiente que nadie puede cerrar es peor que uno que falta.

**La reconciliación de esos casos es el mismo recalcular de §6**, disparado por el cambio de
atributo en vez de por el cambio de regla. En la práctica significa que el recalcular no es una
acción de la pantalla de administración solamente: también hay que poder pedirlo **para una
empresa**, desde su ficha, cuando su flota o su gestión cambiaron.

Alternativa descartada: recalcular automáticamente en un trigger `AFTER UPDATE` sobre `assets` y
`carriers`. Sembraría y borraría registros sin que nadie lo vea, que es justo lo que D12 y D13
prohíben — y en un módulo cuyo trabajo es dejar evidencia, los cambios silenciosos son lo peor
posible.

## 6. El recalcular

Es la parte cara, y la que hace que la configuración sea verdad y no una promesa.

Cambiar una regla no basta con aplicarla a las entidades nuevas: hay que reconciliar lo ya sembrado.
Hoy, con la regla actual, **sobran 16 registros** de cámara de frío; si mañana una regla se amplía,
faltarán otros.

**Vista previa obligatoria.** Antes de aplicar, la pantalla dice exactamente qué va a pasar:

> Con esta regla: se crean **12** registros · se quitan **16** · **4 no se pueden quitar** porque
> tienen documento cargado.

**D13 — la regla de seguridad, no negociable.** El recalcular **nunca** borra un registro que:
- tiene archivo (`file_url IS NOT NULL`), o
- fue editado a mano (`is_manual_override = true`), o
- no está en `MISSING`.

Esos se listan aparte como *"ya no corresponden según la regla, pero tienen documento"* y se
resuelven de a uno. Borrar un documento cargado porque cambió una regla de catálogo sería destruir
trabajo real; el sistema prefiere quedarse con un pendiente de más antes que perder evidencia.

**El recalcular es explícito**, disparado por una persona desde la pantalla. No corre solo al
guardar la regla: guardar y aplicar son dos actos distintos.

## 7. Fuera de alcance

**El historial de versiones como filas.** Ver §1.1: la capacidad visible ya existe y el problema no
le ocurrió a nadie todavía —0 reemplazos en producción—. Entra cuando exista una renovación real,
y entonces es una migración chica: eliminar `compliance_records_entity_id_requirement_id_key` y
reapuntar el `ON CONFLICT` de los tres triggers a `idx_unique_current_compliance`, que ya existe
como parcial `WHERE is_current = true`. **Ese día hay que tocar los mismos tres triggers de este
tramo** — conviene recordarlo para no diseñarlos de una forma que lo dificulte.

**Las pilas agrupadas con desambiguación por sujeto.** Agrupan lo que el matcher resolvió, y hoy no
hay nada en la bandeja para agrupar: los documentos los sube el equipo de negocio y todavía no
entraron. El spec del rediseño ya anticipaba que este tramo "es lo que más se beneficia de haber
visto datos reales entrando".

**Conectar `document_matcher.py`.** Está escrito y no lo llama ningún router. Su señal más fuerte
—la ruta de la carpeta— llega con el proyecto de importación desde OneDrive, así que conectarlo
antes obliga a calibrarlo dos veces.

**La importación desde OneDrive**, que se descubrió durante este brainstorming y merece spec propio.
Resumen de lo medido, para que no se pierda:

- La estructura por empresa **existe**: `{EMPRESA}/{EMPRESA|CONDUCTORES|VEHICULO}/{sujeto}/archivo`,
  repartida en **11 operaciones de cliente** con al menos 4 variantes de bucket y **profundidad
  variable** (algunas tienen un nivel de año, otras no).
- La **ruta lleva las cuatro coordenadas** que la app necesita — vale mucho más que el nombre.
- **No todas las empresas del Monitor tienen carpeta**, y la mayoría de las carpetas corresponden a
  empresas que la app no conoce. El alcance acordado es **sólo las del Monitor**.
- Escala real: WMT 19,3 GB · IANSA 4,7 GB · CCU 1,6 GB · Sodimac 1,2 GB. La Ronda 97 midió 2.094
  archivos planos: no estaba mal, miraba otro lugar de la misma biblioteca.
- `sharepoint_client.py` ya existe con credenciales de Graph, pero **no lo llama ningún router**.
  **Permisos verificados el 2026-08-15**: el app registration tiene `Sites.Read.All` +
  `Files.Read.All` y **listar carpetas funciona**. Cero trabajo de Azure pendiente.
- **Censo sobre 12 de las 39 empresas activas**: sólo **5 tienen carpeta propia** de verdad. Y el
  dato que más importa — de las 8 que un cruce por nombre daba por encontradas, **3 eran falsos
  positivos**: dos apuntaban a un *conductor* (`GARAVITO AGUILERA…` para "Transportes Aguilera") y
  una a una carpeta de *seguros*. El cruce automático por nombre no falla callado: **apunta con
  confianza a la carpeta equivocada.**
- La variación de nombres es el obstáculo real, no la ausencia: "Sociedad De Transportes Parras Spa"
  existe como `SOCIEDAD DE TRANSPORTES PARRA 'S SPA`, con espacio y apóstrofo.
- Consecuencia de diseño para ese proyecto: la reconciliación **tiene** que ser confirmada por una
  persona, y el selector debe mostrar **la ruta completa**, no sólo el nombre de la carpeta — es lo
  único que permite descartar de un vistazo que la coincidencia sea un conductor o una póliza.

**Las decisiones de negocio.** La regla concreta de H1 y D8 sigue siendo de negocio; este tramo
entrega el mecanismo para que la escriban sin desarrollo de por medio.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Reescribir los tres triggers rompe el alta | Es el modo de falla más grave: un trigger roto impide crear empresas, conductores y vehículos. Test que da de alta los tres **después** de la migración, y verificación de que siembran lo mismo que antes |
| El recalcular borra trabajo real | D13: nunca toca registros con archivo, con override o fuera de `MISSING`. Vista previa antes de aplicar |
| La configuración queda linda pero no se usa | La pantalla nace con el caso real cargado: la regla de cámara de frío que hoy afecta a 16 vehículos |
| Nadie dispara el recalcular y las reglas quedan desincronizadas de los datos | La lista de empresas con atributos cambiados desde su último recálculo es visible, no hay que acordarse. Ver §5.1 |
| Auditar las columnas nuevas rompe | Ya cubierto: `log_change` serializa con `default=str` desde la corrección de la revisión de rama. Los `UUID[]` pasan por ahí |

## 9. Verificación

1. **Contra la base real, no sólo mocks.** Correr el SQL nuevo con `PREPARE`/`EXECUTE` — parámetros
   reales, no literales sustituidos. Es el criterio que ya cazó dos bugs de Postgres en este módulo.
2. **El alta sigue funcionando tras reescribir los triggers**: crear empresa, conductor y vehículo,
   y confirmar que se siembran sus `compliance_records`. Es el modo de falla más grave del tramo.
3. **La migración no movió nada**: contar `compliance_records` por requisito antes y después de
   aplicarla. Deben ser idénticos salvo los 2 del vehículo sin subtipo, que se verifican aparte
   (§4.1).
4. **La vista previa dice la verdad**: comparar lo que anuncia contra lo que efectivamente cambia.
5. **Click-through en staging** con Playwright, mirando la pantalla y no sólo los tests. En este
   módulo, mirar encontró lo que 841 tests no podían.
