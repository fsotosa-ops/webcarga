# Configuración por dominios — diseño

**Fecha**: 2026-08-16
**Estado**: aprobado en brainstorming, pendiente de plan de implementación
**Spec hermano**: el rediseño de la lista de condiciones de documentos va aparte
(spec 2, todavía sin escribir). Este documento define **el marco donde vive**, no su
interior.

---

## 1. El problema

`/dashboard/admin/configuracion` son hoy **siete pestañas planas**, más Usuarios en su
propia página. Funciona con siete elementos; deja de funcionar antes de los veinte, y la
pregunta *"¿dónde configuro X?"* se convierte en una búsqueda a ojo.

El disparador concreto fue la séptima pestaña, Condiciones de Documentos: **37 tarjetas,
167 casillas, 5.849 px de alto**. Pero el problema no es esa pantalla —eso es el spec 2—
sino que el módulo no tiene una estructura que aguante crecer.

Dirección del usuario, textual: *"el módulo de configuración tiene que ser ultra
funcional, world class, tipo SaaS e interactivo; tendría que ser las capas según los
componentes que son configurables en la app… no puede ser un módulo de configuración con
puros navtab"*. Y el argumento que decidió el eje: **la app está construida a nivel de
dominios**, así que la configuración debe espejar la estructura que el equipo ya tiene en
la cabeza.

## 2. La tensión que hubo que resolver

Hay **dos clases** de cosa configurable, y hoy están mezcladas:

- **Reglas de un dominio** — sólo le importan a un módulo (umbrales del Monitor,
  condiciones de documentos).
- **Vocabulario compartido** — lo consumen varios módulos.

Verificado contra el código, no supuesto:

| Vocabulario | Lo consume | ¿Compartido? |
|---|---|---|
| `FLEET_SERVICE_TYPE` (10) | condiciones de Certificación · ficha de empresa · cierres de equipo | **sí** |
| `WEBCARGA_OPERATION_TYPE` (2) | ficha de empresa · viajes · cierres de equipo | **sí** |
| `DRIVER_REASON` (16) | cierres diarios · viajes | no, Operaciones |
| `EQUIPMENT_STATE` (6) | pestaña de estados | no, Operaciones |
| `OPERATIONAL_STATE` (5) | viajes | no, Operaciones |

Sólo **2 de 5** son transversales, y los dos son vocabulario de vehículos. Eso permite
una salida sin sección genérica llamada "Vocabulario": **Flota es un dominio propio**, con
nombre de negocio, que contiene exactamente lo compartido.

## 3. Los dominios

| Dominio | Contiene |
|---|---|
| **Certificación** | Condiciones de documentos · Alertas de vencimiento |
| **Operaciones** | Estados del tablero (TMS) · Estados operacionales · Estados de equipo · Umbrales de alerta · Rangos de temperatura · Motivos de conductor |
| **Flota** | Subtipos de vehículo · Tipos de operación |
| **Personas y accesos** | Usuarios (hoy fuera de Configuración; se pliega adentro) |
| **Facturación** | reservado, sin contenido |

**Regla de ubicación**: un dominio no es una pestaña con otro nombre. Certificación es la
respuesta a *"qué le exigimos a quién, y con cuánta anticipación avisamos"*. Si un ajuste
no contesta una pregunta del dominio, está mal ubicado.

**Regla de edición**: lo compartido **se edita en un solo lugar** (Flota). Los dominios que
lo consumen lo muestran con un enlace, nunca con un segundo formulario. Dos formularios
sobre el mismo dato es exactamente el defecto que costó una revisión de rama completa en
el Tramo 3 (dos definiciones de "tipo de gestión", una que se mostraba y otra que se
aplicaba).

## 4. El registro de revisión

### Por qué existe

Hoy 35 de 37 requisitos no tienen condición. Eso significa "se le exige a todos" — pero
**no distingue** dos situaciones:

- *"Lo revisamos y efectivamente va para todos."*
- *"Nadie lo miró todavía."*

Las dos se ven igual: la columna vacía. Es la misma clase de defecto que apareció cinco
veces durante el Tramo 3 (un valor con dos significados), y tiene consecuencia medible:
**16 remolques tienen exigida Mantención de Cámara de Frío sin poder tenerla**, no porque
alguien decidiera mal, sino porque nadie decidió, y el sistema no tenía cómo mostrarlo.

Sin este registro, la portada sólo puede contar elementos — o sea, es un menú con números,
y la mitad de la razón para elegir esta estructura se pierde.

### Cómo funciona

**Una tabla, referida a *(dominio, elemento)***, con quién revisó y cuándo. Sin estados
intermedios, sin flujo de aprobación, sin caducidad.

- **Guardar cuenta como revisar.** Editar y guardar es tomar una decisión: queda revisado
  sin un segundo gesto.
- **"Confirmar" existe sólo para el caso invisible**: *"lo miré y está bien así"*. Es el que
  hoy no deja rastro.
- **Revisar no vence.** Poner caducidad convierte la portada en una lista de tareas que
  nadie pidió y enseña a ignorar la insignia.

**El estado se nombra, no se deduce.** Descartado explícitamente: inferir la revisión de
`audit_log`. Sería gratis —ya se registra quién cambió qué y cuándo— pero "hay una fila en
el log" significaría a la vez *"alguien lo cambió"* y *"alguien lo confirmó"*: otro valor
con dos significados.

### El límite de lo genérico

El mecanismo es común: la tabla, el contador, la insignia, el gesto de confirmar. Lo único
propio de cada dominio es **enumerar sus elementos**.

Eso es código por dominio y no se llega a cero. **La prueba de escalabilidad es otra**:
cuando llegue Facturación, ¿hay que tocar la portada, la tabla o la lógica de pendientes?
**No** — sólo declara cómo se enumeran sus elementos. Si alguna vez hace falta un `if` por
dominio en la portada, el diseño se rompió.

## 5. Las dos pantallas

### Portada

Una tarjeta por dominio, con qué contiene y **dónde está el trabajo pendiente**:

```
Certificación     37 documentos · 12 sin revisar
Operaciones       32 ajustes · al día
Flota             12 valores · 1 sin revisar
Personas          6 usuarios
Facturación       (más adelante)
```

- **"Sin revisar" es un filtro, no un adorno**: el número entra al dominio con el filtro
  puesto. Es el camino corto entre "algo falta" y "lo estoy resolviendo".
- **Cuando no hay pendientes se dice "al día", no "0"**. Un cero ahí sería otra vez un
  número con dos significados ("ninguno" contra "todavía no cargué"), el defecto que ya
  ocurrió en el embudo de Certificación (`85a72cc`).

### Interior de un dominio

Barra lateral con **los otros dominios**, para saltar sin volver a la portada: la portada
orienta, no es un peaje. Adentro, las secciones del dominio como pestañas —que ahí sí
corresponden, porque son pocas y del mismo tema— más el filtro "sin revisar".

### Buscador

Presente en **las dos** pantallas. Busca sobre el **contenido**, no sobre los títulos de
sección: escribir "frío" encuentra la condición de Certificación, el rango de temperatura
de Operaciones y el subtipo de vehículo. Es lo que hace que el módulo escale a 20 o 200
ajustes.

## 6. Migración

**No se pierde ni se reescribe nada.** Las siete pestañas actuales siguen funcionando
igual; cambian de dirección, no de contenido. Es mudanza, no reconstrucción.

| Hoy | Queda en |
|---|---|
| Estados TMS · Estados Operacionales · Estados de Equipo · Alertas del Monitor · Rangos de Temperatura | Operaciones |
| Alertas de Vencimiento · Condiciones de Documentos | Certificación |
| (nuevo, desde `status_taxonomies`) Subtipos de vehículo · Tipos de operación | Flota |
| `/dashboard/admin/usuarios` | Personas y accesos |

Las rutas viejas dejan de existir; el proyecto ya hizo un corte limpio equivalente en la
normalización de rutas de Operaciones (Ronda 55), sin redirecciones heredadas.

## 7. Orden de construcción

Tres entregables independientes; cada uno deja el módulo mejor que antes.

1. **El marco** — dominios, rutas, barra lateral, y las siete pestañas mudadas **sin tocar
   su interior**. Al terminar, el módulo ya está organizado por dominio.
2. **El registro de revisión** — tabla, gesto de confirmar, insignias y filtro.
3. **El buscador** — el único que se puede posponer sin bloquear nada.

## 8. El efecto del día uno

Al encender el punto 2, Certificación va a decir **"37 sin revisar"**, porque efectivamente
nadie revisó nada.

Puede leerse como un tablero en rojo. Es al revés: es **el inventario exacto de decisiones
de negocio que nadie tomó**, que hasta ahora vivía disperso en documentos y en la memoria
de quien se acordara. Las cuatro preguntas abiertas del Tramo 3 —qué subtipo es `KDKP93`,
a qué ramplas les corresponde cámara de frío, el alcance del anexo de Walmart, y si una
condición de gestión alcanza al catálogo histórico— son cuatro de esas 37.

## 9. Fuera de alcance

- **El interior de la lista de condiciones** — spec 2.
- **La excepción por caso** ("no le corresponde a este vehículo"). Diferida a propósito: el
  único caso real que existe (`KDKP93`) no es una regla equivocada sino **un dato que falta**,
  y un mecanismo de excepción sería el lugar donde los datos faltantes se esconden para
  siempre. Se retoma si aparece evidencia de un caso donde la regla sea correcta y aun así
  no corresponda.
- **Facturación** — sólo tiene el lugar reservado.
- **Permisos por dominio** — hoy toda la configuración exige rol admin y así se queda.
