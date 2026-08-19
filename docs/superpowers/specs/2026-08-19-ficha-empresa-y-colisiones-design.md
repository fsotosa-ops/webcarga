# La ficha de empresa, los dos mundos, y las colisiones de carga masiva · Diseño

**Fecha:** 2026-08-19
**Estado:** propuesta
**Mockup acordado:** https://claude.ai/code/artifact/8e7bd1f6-b812-4e01-b1e5-2cdcf2bf319e

## Los dos problemas, y por qué van juntos

Son dos, y comparten causa: **el módulo enseña sólo la mitad de lo que sabe.**

1. **Certificación muestra lo que falta y esconde lo que hay.** Los **23 documentos cargados** de la
   única empresa que tiene documentación no aparecen por ningún lado del módulo. Para verlos hay que
   salir a la ficha legacy de Empresas — que es la fuga que dos rondas cerraron a propósito.
2. **Dos archivos pueden reclamar el mismo casillero y nada lo señala**, y el clasificador que se
   acaba de conectar lo hace más probable, no menos.

## Parte 1 · La ficha de empresa

### Lo que hoy no se puede hacer

Para analizar una empresa: entrar → embudo de 5 etapas plegables → encontrarla → clic → se abre un
cajón dentro de una fila → desplegar cada sujeto → y **sólo se ve lo que falta**. Son muchos clics y
nunca se llega a una página.

Y hay una asimetría que lo resume:

| | Certificación | Ficha legacy de Empresas |
|---|---|---|
| Perfil unificado (empresa + conductores + vehículos) | **sí**, un cajón | no: 6 pestañas |
| Ver los documentos cargados | **ninguno** | sí, con previsualización |

### El estándar del rubro, verificado

De los productos del sector: **Truckstop Carrier Hub** consolida autoridad, seguros, ratings,
certificados e identidad *"on one screen"*, con la consigna **"drill in when you need to. Move on
when you don't"**. **Highway** ofrece *"centralized visibility into driver and equipment compliance
information"*. **Ninguno separa "lo que falta" de "lo que hay" en pantallas distintas**, y ninguno
reparte el mismo objeto entre dos módulos.

### La decisión: master-detail, no un cajón

Una ruta real `/dashboard/compliance/[carrierId]`, a **un clic** desde la lista. La empresa, sus
conductores y sus vehículos en una sola vista, con el filtro **`Todo · Falta · Por vencer · Al día`**.

**"Lo que falta" deja de ser una pantalla y pasa a ser un filtro.** Es el mismo criterio que este
repo ya aplicó tres veces: `CarrierDrawer` recibe `subject?` en vez de tener un componente hermano,
y `useFilaAbierta`/`useGestoDeCarga` devuelven props sueltas porque sus consumidores tienen formas
incompatibles. **Una variante es un parámetro, no un hermano.**

### El cambio técnico que lo habilita

`_PENDING_ROWS_SQL` tiene el predicado **incrustado en el `WHERE` del CTE**
(`compliance.py:405`), así que hoy no existe forma de pedir *todos* los registros de la flota de una
empresa. Se generaliza con un parámetro de estado. **Verificado: tiene un solo consumidor**
(`list_pending_compliance_records`), así que el cambio no se ramifica.

`/pending` gana `estado: 'todos' | 'falta' | 'por_vencer' | 'al_dia'`, con `falta` como default para
que ningún llamador actual cambie de comportamiento.

### Los cuatro estados, que son obligatorios

- **Vacío** — es el caso de **32 de las 34 empresas activas**. Nunca una tabla vacía con
  encabezados: el vacío dice por dónde empezar.
- **A medias** — sin flota asignada sólo se exige lo de la empresa. **El total no se inventa**: dice
  13 y no 33, y explica por qué.
- **Sin permiso** — se ve todo, no se carga nada. Lo decide `useCanEdit()`, que desde la Ronda 131
  sale de `useRolMinimo`. "Ver" se queda: mirar no es editar.
- **Falló** — el error vive **en ese renglón**, con el archivo conservado. Un aviso arriba no diría
  de cuál de los 33 habla.

## Parte 2 · Los dos mundos en el sidebar

### Por qué dos entradas, y por qué eso no contradice el criterio del módulo

El código del sidebar dice: *"Certificación es UNA lista de empresas con dos maneras de mirarla, no
tres submódulos"*. Ese criterio defiende que **las cuatro agrupaciones** (Empresa/Conductor/
Vehículo/Requisito) no se partan — son cuatro vistas de la misma lista.

**La Bandeja no es eso.** Es otro objeto:

| | La Bandeja | Empresas |
|---|---|---|
| El objeto | archivos sin destino | requisitos sin documento |
| La pregunta | ¿de quién es esto? | ¿qué le falta a esta empresa? |
| Cómo llega | en lote, sin orden | una empresa a la vez |

Y el módulo **ya lo sabe a medias**: el comentario del botón actual dice *"La bandeja vive detrás de
su propio botón, con contador: **no es una agrupación más**"*. Está fuera del `role="group"`, con su
borde, su ícono y su contador. Lo que cambia es el **peso** — hoy es un botón chico al lado de
cuatro chips, y va a ser donde ocurra la mayor parte del trabajo.

La infraestructura existe: `NavGroup` se extrajo precisamente porque *"sumar un segundo grupo
obligaba a duplicar ~55 líneas — que fue exactamente la razón equivocada"* por la que la Bandeja
quedó donde no debía.

```
Certificación                                    (grupo expandible)
├─ Empresas          /dashboard/compliance       → lista + ficha
└─ Sin clasificar 12 /dashboard/compliance/inbox → la Bandeja, con su contador
```

**Los cuatro chips no se mueven**: siguen dentro de Empresas.

### El puente, en los dos sentidos

| Estás en | Necesitás | El puente |
|---|---|---|
| La ficha | cargarle veinte de una vez | "Llévalos a Sin clasificar", **con la empresa preseleccionada** |
| La Bandeja | ver cómo quedó | al confirmar, el aviso enlaza a su ficha |
| Cualquiera | saber si hay trabajo | el contador del sidebar |

**La preselección de empresa no es comodidad: es precisión.** El motor acota el universo a las
entidades de esa empresa —~2 conductores y ~3 vehículos contra 87 y 124—, y eso convierte un nombre
ambiguo en un match único. Hoy `documentIngestApi.upload(carrierId, files)` **ya rutea** a
`/{carrier_id}/files`, pero la Bandeja global se monta sin `carrierId` y la pantalla no ofrece
elegir empresa. La capacidad existe y no tiene puerta.

## Parte 3 · Las colisiones de carga masiva

### A · Dos archivos al mismo casillero

`classify-batch` ya se protege de un caso vecino, y su docstring cuenta el daño:

> *"Marcar 31 licencias y asignarlas al mismo conductor destruía 30"* — los N-1 quedaban invisibles
> **e irreversibles**, porque desde el segundo `_apply_stored_document` escribe
> `replaced_storage_path` y el deshacer los rechaza.

El guardia (`if len(set(body.item_ids)) > 1: raise 422`) cubre *un lote a un casillero en una sola
operación*. **Pero el clasificador propone el mismo `(entity_id, requirement_id)` a dos archivos
distintos**, y el operador los confirma de a uno — que es exactamente lo que el guardia permite.

Antes esto pasaba sólo si alguien se equivocaba. **Ahora el sistema lo invita**, porque los dos
llegan pre-etiquetados al mismo destino.

### B · `content_sha256` nunca se escribe

La columna existe y está en cero sobre las 65 filas. Ni los duplicados exactos se detectan.

### La forma, siguiendo el patrón que el módulo ya tiene

La consulta de la cola **ya deriva señales en una sola pasada**:
`jsonb_array_length(i.candidates) AS candidate_count`. Las dos nuevas van igual, con
`count(*) OVER (PARTITION BY …)`: una pasada, sin N+1, derivado y no almacenado — no puede quedar
rancio.

**La guarda de NULL es obligatoria**: sin ella, los ~60 items `UNMATCHED` con `entity_id` nulo caen
en la misma partición y la pantalla diría que **todos** reclaman el mismo casillero.

**Las dos señales se mantienen separadas aunque compartan forma**, porque piden acciones distintas:

| Señal | Qué significa | Qué hace el operador |
|---|---|---|
| mismo contenido | este archivo ya está en la cola | borra uno |
| mismo destino | dos archivos distintos reclaman el casillero | elige cuál |

**Se muestran, no se bloquean.** Es el criterio que el módulo ya declaró: *"nada se descarta
nunca"*. Un duplicado puede ser una recarga legítima, y dos archivos al mismo casillero pueden ser
la versión vieja y la nueva — quién gana lo decide una persona.

## Fuera de alcance, con el número al lado

| No está | Por qué |
|---|---|
| Historial de versiones por documento | Hay **1** registro histórico en todo el sistema |
| Línea de tiempo de auditoría | **119** filas de auditoría, todos los módulos |
| Seguros y Contactos en la ficha | Seguros tiene su propio modelo de datos sin resolver |
| El nombre canónico derivado | Trabajo aparte, ya diseñado en conversación |
| Extraer la fecha del PDF | Otro problema con su propio tamaño |

**El expediente rico se construye después de la carga documental.** Con 24 documentos sobre 5.121
requisitos, hoy se diseñaría adivinando; con los ~2.000 cargados, se va a saber.
