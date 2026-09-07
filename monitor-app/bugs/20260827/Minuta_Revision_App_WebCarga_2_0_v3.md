**MINUTA DE REVISIÓN**

WebCarga Monitor 2.0 — Módulo de Certificaciones y Cierre del Día

| Fecha de revisión | 25 de agosto de 2026 |
| :---- | :---- |
| **Revisado por** | Pablo Abumohor (CEO WebCarga SpA) |
| **Duración** | 2h 12m (sesión en solitario) |
| **Módulos revisados** | Monitor / Diario 2.0, Cierre del Día, Módulo de Certificaciones, Directorio de Empresas |
| **Destino** | Felipe Soto — Sumadots (corrección de bugs y ajustes) |
| **Próximo paso** | Reunión de revisión con Felipe para priorizar correcciones antes de UAT con operaciones |

**1\. Resumen ejecutivo**

Se realizó una revisión completa de la aplicación enfocada en dos flujos críticos: el módulo de certificaciones (directorio de empresas, conductores y documentos) y el flujo de cierre del día. La revisión incluyó un intento de cierre real del día 25 de agosto.

**Conclusión principal:**

La plataforma tiene muy buen avance y la base está sólida. Aún faltan algunos ajustes para poder hacer las pruebas formales con el equipo de operaciones. Se identificaron puntos concretos que, una vez resueltos, deberían permitir avanzar rápidamente hacia el UAT.

* **5 bugs críticos que bloquean el cierre del día o la carga de documentos.**

* **10 bugs de datos que generan reportes incorrectos o inconsistentes.**

* **8 bugs de UX o funcionalidades faltantes que generarán fricción en operaciones.**

* **7 conductores/empresas que requieren ser dados de baja o regularizados en el directorio.**

**2\. Puntos críticos a resolver — cierre del día y carga documental**

Los siguientes puntos deben estar resueltos antes de iniciar las pruebas formales con el equipo de operaciones.

| \# | Bug / Hallazgo | Módulo | Impacto |
| :---- | :---- | :---- | :---- |
| 1 | Botón 'Crear y asignar' conductor no funciona — ocurre en la pantalla principal del Diario (viajes en curso), donde los conductores sin registrar aparecen con color más tenue. Al ingresar RUT y apretar el botón no ocurre nada. Casos afectados: Carlos Pérez, Luis Recabaren. Algunos casos funcionan (ej. Armijo) pero otros no. Se probó con y sin puntos en el RUT. | Monitor — viajes en curso | **CRÍTICO — bloquea el cierre** |
| 2 | No se puede completar el cierre porque el sistema detecta '2 conductores sin resolver' y '3 viajes con flota fuera del directorio'. Como el bug anterior impide crear/asignar conductores, se forma un círculo bloqueante. | Cierre | **CRÍTICO — bloquea el cierre** |
| 3 | No se puede crear conductor ni equipo dentro de una empresa existente desde el módulo de certificaciones. No hay opción visible para agregar conductor, vehículo ni asignar tipo de operación (tractoreo / equipo completo). | Certificaciones | **CRÍTICO — bloquea carga de datos** |
| 4 | Documentos subidos a 'Sin Clasificar' solo permiten asignar empresa, no permiten llegar al nivel de conductor ni vehículo. Una licencia de conducir no puede vincularse al conductor específico ni una revisión técnica al tracto correspondiente. | Certificaciones | **CRÍTICO — bloquea flujo documental** |
| 5 | Patentes/conductores sin empresa no se pueden vincular a empresas existentes desde ninguna vista de la app. | Certificaciones / Monitor | **CRÍTICO — bloquea flujo documental** |

**3\. Inconsistencias de datos — ajustes para mayor precisión del reporte**

Los siguientes puntos afectan la integridad del reporte de cierre y las estadísticas de rotación. Algunos requieren acción técnica de Felipe y otros requieren actualización de datos maestros por parte de WebCarga.

| \# | Bug / Hallazgo | Módulo | Impacto |
| :---- | :---- | :---- | :---- |
| 1 | Diferencia de conductores: el sistema muestra 39 conductores pero la operación real tiene 44\. Faltan 5 por identificar. | Monitor / Cierre | **ALTO — reporte incorrecto** |
| 2 | Diferencia de asignados: el Diario muestra 11 asignados vs. 22 que reportó el estatus del día de operaciones. El número no cuadra. | Monitor / Cierre | **ALTO — reporte incorrecto** |
| 3 | Viajes con 'adelanto de ruta' contaminan estadísticas: conductores que salieron a última hora del día 24 aparecen como asignados el 25, duplicando la apariencia de actividad. Ejemplo: Edgar Josué Arias — planificado el 24 a las 7 PM, marcado como hoy en el Diario. | Monitor | **ALTO — estadísticas de rotación erróneas** |
| 4 | Viaje de Colun (Hueraman) en estado 'en ruta' desde el 14 de agosto — el Diario no está reflejando el cambio de estado del TMS. Acción requerida: revisar directamente en WingSuite qué pasó con este viaje (si fue eliminado, cerrado o sigue activo), y entender por qué el sistema no está tomando esa actualización del TMS pasado cierto tiempo. | Monitor | **ALTO — a verificar en TMS** |
| 5 | Viajes abandonados por TMS con estados inconsistentes (en origen, en ruta, retornando) acumulados desde junio. Regla propuesta a implementar: (1) el sistema debe ir a buscar el nuevo estado en el TMS automáticamente; (2) si el TMS ya no muestra el viaje (fue eliminado), el sistema habilita al coordinador para cerrarlo con un motivo de la lista de cierres de viaje; (3) si el viaje sigue activo en el TMS pero lleva más de X días sin cambio de estado (ej. 20 días en ruta), el sistema debe alertar al área de finanzas para que levanten el caso con el mandante — puede ser un viaje ejecutado que no generó cambio de estado y por tanto no ha salido a pago. | Monitor | **ALTO — requiere regla automática \+ alerta a finanzas** |
| 6 | Empresa Transporte Juan Ramírez aparece como NO ACTIVA en el directorio aunque tiene un viaje activo en el Diario. Al reactivarla, el conductor asociado en el cierre no corresponde al que ejecutó el viaje. El conductor real (Gerson Ferrada) no tiene empresa asignada en el sistema. | Monitor / Cierre | **ALTO — ★ CASO CRÍTICO a revisar con Felipe** |
| 7 | Conductor Doris Mercedes aparece sin tracto reciente pero tiene viaje activo el 25\. El conductor está marcado 'sin registrar' aunque sí tiene viaje asignado. | Monitor | **MEDIO — dato inconsistente** |
| 8 | Francisco Muñoz Godoy aparece asignado a Transportes Charlotte pero pertenece a La Fortaleza. Error de empresa en el directorio. | Directorio | **MEDIO — error de datos maestros** |
| 9 | Viajes de Sodimac sin conductor ni empresa pero con patente asignada — el sistema los marca como asignados sin identificar quién los ejecutó. | Monitor | **ALTO — dato incompleto** |
| 10 | Fecha de planificación inconsistente en vista de lista vs. vista de detalle de un viaje — la pantalla de inicio muestra 16:33 y el detalle muestra 19:57 para el mismo evento. | Monitor | **MEDIO — confusión operativa** |

**★ CASO CRÍTICO — Empresa Juan Ramírez / Conductor Gerson Ferrada:**

* La empresa Transporte Juan Ramírez aparece como NO ACTIVA en el directorio pero tiene un viaje activo en el Diario.

* Al reactivarla, el conductor que aparece asociado en el cierre no corresponde al que ejecutó el viaje.

* El conductor real (Gerson Ferrada) no tiene empresa asignada en el sistema — aparece en el módulo de conductores sin empresa.

* El tracto sí está correctamente asignado a Transporte Juan Ramírez.

* Esto es un ejemplo del problema estructural: conductor sin empresa \= no aparece en el cierre, aunque haya ejecutado un viaje real.

**4\. Mejoras de UX y funcionalidades pendientes**

| \# | Bug / Hallazgo | Módulo | Impacto |
| :---- | :---- | :---- | :---- |
| 1 | Algoritmo de sugerencia de conductores demasiado permisivo — muestra candidatos que comparten solo un nombre de pila (Enrique, Armijo). Debería requerir al menos 3 de los 4 nombres para mostrar una coincidencia. | Monitor | **MEDIO — riesgo de asignación incorrecta** |
| 2 | Asignación de motivo de no asignación lenta en el cierre del día — al seleccionar el motivo de por qué un conductor no fue asignado, el sistema tarda un tiempo visible en procesar y actualizar el estado. Hace que el proceso de cierre sea tedioso cuando hay varios conductores a clasificar. | Cierre | **MEDIO — fricción operativa** |
| 3 | Estado 'adelanto de ruta' no existe en la lista de motivos del cierre — no hay forma de clasificar correctamente a conductores que ejecutaron su viaje al día siguiente de la asignación. | Cierre | **ALTO — estado faltante** |
| 4 | Estados faltantes en cierre de viajes NO asignados: 'sin equipo disponible', 'sin precio de transporte para esta ruta', 'mandante rechaza', 'vuelta de cajas', 'cancelado'. | Cierre | **ALTO — estados faltantes** |
| 5 | No hay opción de dar de baja a un conductor directamente desde el módulo de cierre. El coordinador no puede sacarlo del registro mientras está en medio del proceso de cierre. | Cierre | **MEDIO — fricción operativa** |
| 6 | Totales generales no aparecen en el reporte del cierre — faltan los sumatorios finales de asignados, no asignados y % de utilización. | Cierre / Reporte | **ALTO — reporte incompleto** |
| 7 | Vista de lista de empresas (activas/inactivas) desapareció de la interfaz aunque está desarrollada. La vista anterior era más ordenada para revisar el estado del directorio. | Certificaciones | **MEDIO — regresión UX** |
| 8 | Tipo de operación (tractoreo / equipo completo) no se puede asignar a una empresa desde la interfaz actual. | Certificaciones | **ALTO — dato maestro bloqueado** |

**5\. Lista de estados para el cierre del día**

Los siguientes estados deben estar disponibles en el sistema. Felipe los implementa en los desplegables correspondientes.

**5.1 Estados de conductores — cierre del día (tractoreo)**

Motivos disponibles cuando un conductor no fue asignado:

* Médico

* Vacaciones

* Trámite personal

* Mantención

* Se retira sin carga

* Conductor no disponible

* Panne

* No disponible

* Adelanto de ruta — conductor asignado el día anterior que ejecutó el viaje en la madrugada o mañana del día actual. Las estadísticas de rotación deben contar el viaje en la fecha de ejecución, no en la de asignación.

* Conductor backup

* Licencia vencida

* Descanso

* No se presentó

* Seguro vencido

* Documentación vencida

**5.2 Estados de cierre de viaje**

Motivos disponibles cuando un viaje no fue ejecutado o debe cerrarse manualmente:

* Sin equipo disponible

* Mandante elimina viaje

* Flete falso

* Flete falso por falta de cajas

* Cancelado por mandante

* Mandante rechaza equipo

**5.3 Regla para viajes con estado incongruente — alerta a finanzas**

Cuando un viaje lleva más de un número de días definido (ej. 15 días) sin cambio de estado en el TMS, el sistema debe generar una alerta automática al área de finanzas para que levanten el caso con el mandante. Este escenario puede indicar un viaje ejecutado que no generó cambio de estado en el TMS y que por tanto no ha salido a pago.

**6\. Conductores y empresas a regularizar en el directorio**

Estos casos fueron identificados durante la sesión. Deben resolverse antes de la primera prueba de cierre con operaciones.

| Conductor / Empresa | Acción requerida |
| :---- | :---- |
| **Worzak — José Patricio Padilla** | Ya no trabaja con WebCarga. Tiene tracto antiguo asociado. Dar de baja. |
| **Bastián Walter Campos** | Ya no disponible. Dar de baja. |
| **Alex Molina** | Dado de baja en el diario Excel, no está en el sistema nuevo. Regularizar. |
| **Luis Vasco (Charlotte)** | No se encuentra. Revisar estado. |
| **Rodrigo Antonio Catalán** | Sin conductor. Dar de baja o regularizar. |
| **Francisco Muñoz Godoy** | Mal asignado a Charlotte — pertenece a La Fortaleza. Corregir empresa. |
| **Crivas (empresa)** | Ya no trabaja con WebCarga. Dar de baja empresa y conductor. |

**7\. Próximos pasos**

**Antes de cualquier prueba con operaciones:**

* **Felipe corrige los 5 bugs críticos de la sección 2\.**

* **Felipe revisa el caso Juan Ramírez / Gerson Ferrada y propone solución para conductores sin empresa.**

* **Felipe agrega los estados faltantes del cierre (sección 5).**

* **Fabián actualiza el directorio dando de baja los conductores y empresas de la sección 6\.**

* Pablo y Felipe se reúnen para revisar los bugs de datos (sección 3\) y definir qué se corrige automáticamente vs. qué requiere acción del coordinador.

* Una vez corregidos los bugs críticos, Pablo ejecuta un segundo cierre de prueba para verificar.

* Solo después de un cierre limpio, se convoca a operaciones para la UAT.

Minuta preparada por Pablo Abumohor — 25 de agosto de 2026