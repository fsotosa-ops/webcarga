# Certificación · Tramo 3 — Historial de versiones y condiciones configurables

**Fecha:** 2026-08-15
**Estado:** aprobado en brainstorming, pendiente de plan de implementación
**Antecede:** `2026-08-15-certificacion-rediseno-design.md` (§7 y §8) y el plan del Tramo 1
**Alcance recortado respecto del spec original** — ver §7.

---

## 1. Qué resuelve

Dos problemas que hoy no tienen solución en el producto y que comparten la misma pieza de
infraestructura: los tres triggers `reconcile_new_*`.

**Cargar un documento borra el anterior.** No hay historial. Si en agosto llega el F30 nuevo, el de
julio desaparece y no se puede demostrar qué estaba vigente el mes pasado. Para un módulo cuyo
trabajo es *certificar*, no poder mostrar el estado histórico es una carencia de fondo.

**La regla de a quién se le exige cada documento vive en código de base.** El trigger
`reconcile_new_asset` tiene escrito literalmente `requirement_code IN ('MANTENCION_FRIO',
'RESOLUCION_SANITARIA') AND NEW.asset_type = 'RAMPLA'`. Cambiarla exige un desarrollador y una
migración — y WebCarga descubre esas reglas **reclutando y certificando**, no antes.

Los dos van en el mismo tramo porque tocan los mismos tres triggers, y hacerlo por separado
significa intervenir dos veces la parte del esquema donde un error rompe el alta de empresas,
conductores y vehículos.

## 2. Evidencia medida

Contra `viclzoftiudkepqnhekv`, 2026-08-15:

| Dato | Valor | Implicancia |
|---|---|---|
| `idx_unique_current_compliance` | **Ya existe**, parcial `WHERE is_current = true` | La infraestructura del historial está puesta; falta usarla |
| `compliance_records_entity_id_requirement_id_key` | Único **sin condición** sobre `(entity_id, requirement_id)` | Es lo que impide físicamente el historial |
| Filas con `is_current = false` | **0** | No hay datos que migrar |
| Triggers con `ON CONFLICT (entity_id, requirement_id)` | **3**: `reconcile_new_asset`, `_carrier`, `_driver` | Dependen del índice a eliminar. `reconcile_new_requirement` no |
| Requisitos `LEGAL_MANDATORY` | **33 de 37** | Aplican a todos: no necesitan condición |
| Requisitos `CONDITIONAL_OPTIONAL` | **4** | Todo el mecanismo configurable sirve a 4 filas |
| `MANTENCION_FRIO` sembrado hoy | 20 Furgón Congelado + **11 Furgón Seco + 5 Sider** + 1 sin subtipo | 16 vehículos cargan un certificado que no pueden obtener |
| `SEGURO_RC_EMPRESA` / `SEGURO_EETT` | **0 y 1** registros | La condición nunca se escribió, así que no se siembran |

## 3. Decisiones

| # | Decisión | Quién |
|---|---|---|
| D10 | El historial se habilita eliminando el índice incondicional, **no** agregando tablas | Diseño |
| D11 | Las condiciones son **dato en el catálogo**, no código en el trigger | Usuario |
| D12 | Toda configuración va con **recalcular y vista previa**; sin eso la configuración miente | Diseño |
| D13 | El recalcular **nunca borra** un registro con archivo o con edición manual | Diseño |
| D14 | Las pilas y el matcher salen de este tramo — ver §7 | Usuario |

## 4. Historial de versiones

**El cambio de esquema es una eliminación, no una creación.** `is_current` ya existe con default
`true`, y el índice parcial que lo acompaña ya está creado. Lo único que sobra es el índice
incondicional.

```sql
DROP INDEX public.compliance_records_entity_id_requirement_id_key;
```

**Los tres triggers se reescriben en la MISMA migración.** Su `ON CONFLICT (entity_id,
requirement_id)` necesita exactamente ese índice para inferir el destino; sin él, Postgres falla con
*"no unique or exclusion constraint matching the ON CONFLICT specification"* y se rompe el alta de
cualquier empresa, conductor o vehículo. Pasan a inferir el índice parcial:

```sql
ON CONFLICT (entity_id, requirement_id) WHERE is_current = true DO NOTHING
```

**La renovación.** Al aplicar un documento sobre un requisito que ya tiene uno vigente, el registro
anterior pasa a `is_current = false` y el nuevo entra como vigente. El anterior queda consultable:
ya existen `get_document_history` y `log_document_replacement` en `utils/document_storage.py`, y el
tipo `DocumentVersion` en el frontend.

**Frente y reverso de un mismo documento** entran como dos versiones del mismo requisito. Es
semánticamente imperfecto —no son versiones, son dos caras— pero no se pierde nada y es reversible.
Decisión heredada del spec del rediseño; si al usarlo molesta, se revisa entonces.

## 5. Condiciones configurables

**Dónde vive la regla.** Dos columnas en `public.compliance_requirements`, ambas nullable —
*nulo significa "aplica a todos"*, que es el caso de los 33 obligatorios:

- `applies_to_fleet_service_type_ids UUID[]` — a qué subtipos de vehículo
- `applies_to_management_types TEXT[]` — a qué tipos de gestión de empresa

**Por qué columnas de arreglo y no una tabla de reglas.** Hay 4 requisitos condicionales y dos
dimensiones. Un motor genérico de condiciones sería especulativo, y este proyecto ya rechazó una vez
un modelo relacional construido por anticipado. La forma espeja la decisión D9 de `management_types`
—conjunto, por id, sin tabla nueva— y migra a tabla el día que aparezca una tercera dimensión.

**Los triggers leen la columna** en vez de tener la regla escrita:

```sql
WHERE req.target_entity = 'ASSET'
  AND (req.requirement_level = 'LEGAL_MANDATORY'
       OR req.applies_to_fleet_service_type_ids IS NULL
       OR NEW.fleet_service_type_id = ANY(req.applies_to_fleet_service_type_ids))
```

**Qué desaparece:** el literal `NEW.asset_type = 'RAMPLA'`. Y con él, la confusión que arrastraba —
la migración `20260803050000` separó a propósito el hecho físico (tracto/rampla) del comercial, y el
trigger los volvía a mezclar.

**La pantalla** vive en Administración: por requisito, marcar a qué subtipos y a qué gestiones
aplica. Es una rebanada angosta de la HU-05, que se retiró del backlog: configura *cuándo* aplica un
requisito, no administra el catálogo.

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
| Eliminar el índice rompe los tres triggers | Se reescriben en la **misma** migración. Test que da de alta empresa, conductor y vehículo después del cambio |
| El recalcular borra trabajo real | D13: nunca toca registros con archivo, con override o fuera de `MISSING`. Vista previa antes de aplicar |
| La configuración queda linda pero no se usa | La pantalla nace con el caso real cargado: la regla de cámara de frío que hoy afecta a 16 vehículos |
| Nadie dispara el recalcular y las reglas quedan desincronizadas de los datos | La lista de empresas con atributos cambiados desde su último recálculo es visible, no hay que acordarse. Ver §5.1 |
| Auditar las columnas nuevas rompe | Ya cubierto: `log_change` serializa con `default=str` desde la corrección de la revisión de rama. Los `UUID[]` pasan por ahí |

## 9. Verificación

1. **Contra la base real, no sólo mocks.** Correr el SQL nuevo con `PREPARE`/`EXECUTE` — parámetros
   reales, no literales sustituidos. Es el criterio que ya cazó dos bugs de Postgres en este módulo.
2. **El alta sigue funcionando tras el DROP**: crear empresa, conductor y vehículo, y confirmar que
   se siembran sus `compliance_records`. Es el modo de falla más grave del tramo.
3. **La renovación conserva el anterior**: aplicar dos documentos al mismo requisito y verificar que
   quedan dos filas, una con `is_current = true` y otra en `false`.
4. **La vista previa dice la verdad**: comparar lo que anuncia contra lo que efectivamente cambia.
5. **Click-through en staging** con Playwright, mirando la pantalla y no sólo los tests. En este
   módulo, mirar encontró lo que 841 tests no podían.
