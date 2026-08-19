# Certificación · la carga documental — casuísticas de verificación

> Ronda 129. Es la lista contra la cual se prueba la Tarea 9 del plan
> `docs/superpowers/plans/2026-08-19-certificacion-carga-documental.md`.
> Cada fila dice **qué se hace**, **qué tiene que pasar** y **por qué existe** — casi todas nacen de
> un defecto real, no de imaginar qué podría fallar.

## Por qué esta lista y no otra

El módulo tiene **5.122 registros de cumplimiento y 24 con archivo (0,5 %)**. La causa medida no era
que faltara una pantalla: era que **cargar fallaba en silencio**. Dos superficies recibían archivos
y hacían cosas distintas, y la que clasificaba al requisito rechazaba con 422 los documentos cuya
fecha nunca se pedía. Las casuísticas cubren exactamente eso.

---

## A · La política de vencimiento decide qué se pregunta

Es el corazón del cambio. `expiration_policy` tiene tres estados y **cada uno se comporta distinto**.
Reparto real en producción: **REQUIRED 21 · NONE 16 · OPTIONAL 0** sobre 37 requisitos.
Por entidad: conductor **5 de 12** REQUIRED, vehículo **8 de 10**, empresa **6 de 13**.

| # | Se hace | Tiene que pasar | Por qué existe |
|---|---|---|---|
| A1 | Elegir archivo en un requisito **`NONE`** | Sube de una. No pregunta nada | Preguntar siempre sería fricción sobre 16 requisitos que no vencen |
| A2 | Elegir archivo en un requisito **`REQUIRED`** | Pide "Vence el". **No sube nada todavía** | El defecto original: subía primero y el 422 dejaba el archivo varado |
| A3 | En `REQUIRED`, tocar "Guarda" con la fecha vacía | No pasa nada. Sigue esperando | Un documento sin vencimiento no cubre un requisito que lo exige |
| A4 | En `REQUIRED`, poner la fecha y "Guarda" | Sube. El pendiente baja | El camino feliz que antes no existía |
| A5 | Requisito **`OPTIONAL`** | Ofrece la fecha **y deja guardar sin ella** | Hoy hay 0, pero Configuración puede crear uno en cualquier momento |
| A6 | Política **ausente** (ventana de despliegue) | Pregunta **sin exigir** | Frontend y API se despliegan por separado; la ausencia es "no sé", no "no vence" |

## B · Las superficies, que ahora comparten un solo gesto

| # | Dónde | Tiene que pasar | Por qué existe |
|---|---|---|---|
| B1 | Certificación → **Empresas** → abrir el cajón | Lista por sujeto, plegada. Sin zona de arrastre arriba | La bandeja de 1183×211 px competía con el renglón por el mismo archivo |
| B2 | Certificación → **Conductores** → abrir una persona | Cajón de esa persona, su lista **abierta** | Con un solo sujeto, plegarlo esconde lo único que el cajón muestra |
| B3 | Certificación → **Vehículos** → abrir un vehículo | Ídem | |
| B4 | **Ficha legacy** de conductor → pestaña documentos | El mismo comportamiento de A1-A6 | Era el segundo camino de carga: `uploadAndClassify`, sin pedir fecha |
| B5 | **Ficha legacy** de vehículo | Ídem | 8 de sus 10 requisitos exigen fecha: es donde más fallaba |
| B6 | El enlace "Llévalos a la Bandeja" | Va a `?vista=documentos`, **dentro** del módulo | La Bandeja es destino, no zona encima del casillero |

## C · El gesto

| # | Se hace | Tiene que pasar | Por qué existe |
|---|---|---|---|
| C1 | Clic en el renglón | Abre el selector de archivo | El blanco es el renglón entero, no un botón de 42×17 px |
| C2 | **Arrastrar y soltar** sobre el renglón | Igual que elegirlo | El usuario ya arrastraba; antes iba a la bandeja sin clasificar |
| C3 | Soltar sobre una fila **ya cubierta** (ficha) | **No la reemplaza** | Un arrastre accidental no puede pisar evidencia cargada |
| C4 | Reemplazar un documento existente | Sólo por su control explícito | |

## D · Qué pasa cuando sale bien y cuando sale mal

| # | Se hace | Tiene que pasar | Por qué existe |
|---|---|---|---|
| D1 | Subir con éxito | El pendiente baja **sin cambiar de pantalla** | Perder la cola de trabajo era el motivo de los 4 puntos de fuga |
| D2 | Subir con éxito | El conteo del cajón y el del embudo se mueven juntos | Invalidación por una sola función; ya divergieron una vez |
| D3 | Archivo > 7 MB (u otro rechazo) | El motivo aparece **en ESE renglón**, con el nombre del archivo y "Reintentar" | Un aviso global no dice de cuál de los 91 renglones habla |
| D4 | Después de cualquier subida | `document_ingest_items` de la última hora: **vacío** | El camino directo no pasa por la bandeja. Es la prueba de que no quedó nada varado |
| D5 | Consola del navegador | **Cero errores y cero warnings** | |

## E · Permisos

| # | Se hace | Tiene que pasar |
|---|---|---|
| E1 | Entrar como lector (sin permiso de edición) | No ve control de carga en ninguna de las superficies |
| E2 | Configuración → política | Sólo admin |

## F · La urgencia, que antes no se veía (Tarea 3)

| # | Se hace | Tiene que pasar | Dato real |
|---|---|---|---|
| F1 | Abrir el cajón de **Comercializadora De Los Rios Ltda** | Aparecen "Revisión Técnica" y "Gases Contaminantes", que **vencen el 2026-09-17** | Antes no figuraban en ninguna pantalla |
| F2 | Buscar la póliza que vence el **2026-08-22** | Aparece como pendiente | Vence en 3 días; era invisible |
| F3 | Mirar el embudo | **Ninguna empresa cambió de etapa** | Medido: sólo se mueven los "N de M" (22→20 y 3→2) |
| F4 | Un documento vencido | Se distingue del que sólo falta | |

## G · Navegación — que nada saque del módulo

| # | Se hace | Tiene que pasar |
|---|---|---|
| G1 | Abrir una fila | La URL gana `?abierta=<id>`; recargar la deja abierta |
| G2 | Clic en la columna Empresa | Navega **dentro** de Certificación |
| G3 | Crear una empresa | Aterriza en Certificación con su fila abierta, no en `/dashboard/carriers` |

## H · Configuración (Tarea 4)

| # | Se hace | Tiene que pasar | Por qué existe |
|---|---|---|---|
| H1 | Cambiar un requisito de `REQUIRED` a `OPTIONAL` y guardar | El renglón de ese requisito **deja de exigir** la fecha | Es el circuito completo: negocio decide sin desplegar |
| H2 | Abrir el panel sin tocar nada y guardar otra cosa | La política **no viaja** en el body | Mandarla siempre dejaría auditoría de una decisión que nadie tomó |
| H3 | Cambiar de requisito con el panel abierto | El selector muestra el del requisito nuevo | El bug de draft sin resincronizar ya apareció 3 veces en este frontend |

---

## Casos que NO cubre esta lista, y hay que decirlo

- **Cargar los ~2.000 documentos reales** es trabajo del equipo de WebCarga, no criterio de
  completitud de esta verificación.
- **El clasificador automático** (`document_matcher.py`) sigue sin conectarse: la columna
  "Sugerencia" está construida y vacía. Es el trabajo siguiente (P2).
- **Deshacer una subida**: decisión tomada de no ofrecerlo. `DELETE /file` borra el blob del
  storage, así que "deshacer" borraría evidencia.
- **La vista Requisitos** no tiene cajón: su superficie sería "a quiénes les falta este documento",
  que es una carga en lote distinta.

---

## Resultado del click-through en vivo — 2026-08-19, contra `webcarga-frontend-dev`

Hecho con Playwright sobre el ambiente desplegado, con datos reales.

| # | Casuística | Resultado | Evidencia |
|---|---|---|---|
| **B1** | El cajón no monta zona de arrastre encima | ✅ | 12 renglones, ninguna zona de la Bandeja adentro |
| **B2** | Cajón del sujeto, lista abierta | ✅ | botón del sujeto `[disabled] [expanded]` |
| **B6** | Enlace a la Bandeja, dentro del módulo | ✅ | `/dashboard/compliance?vista=documentos` |
| **C1** | El renglón entero es el blanco | ✅ | "Arrastra aquí o elige un archivo" con cursor de puntero |
| **C2** | Soltar equivale a elegir | ✅ | drop sobre el renglón → pidió la fecha |
| **A2** | Con fecha obligatoria pide la fecha y **no sube** | ✅ | "prueba-certificacion.pdf · este documento no vale sin su vencimiento" |
| **A3** | Guardar sin fecha no hace nada | ✅ | clic en "Guardar" vacío → sigue pidiéndola |
| **A4** | Con la fecha puesta, sube | ✅ | `APPROVED_MANUAL`, `expiration_date = 2027-01-31` |
| **D1** | El pendiente baja sin cambiar de pantalla | ✅ | 12 → **11 documentos**, URL intacta, cajón abierto |
| **D2** | Los conteos se mueven juntos | ✅ | encabezado y "faltan N" bajaron a la vez |
| **D4** | Nada queda varado en la Bandeja | ✅ | `document_ingest_items` de la última hora: **0** |
| **D5** | Consola limpia | ✅ | 0 errores, 0 warnings |
| **G1** | La fila abierta viaja en la URL | ✅ | `?abierta=<uuid>` |
| **G2** | La tabla no enlaza fuera del módulo | ✅ | la columna Empresa es `button`, no `link` |
| **E1** | Un lector no ve el control de carga | ⏳ | requiere una sesión sin permiso de edición |
| **F1-F4** | Urgencia y embudo | ⏳ | verificado en SQL, no en pantalla |
| **H1-H3** | Configuración cierra el circuito | ⏳ | |

**Un dato que confirma que la pantalla no miente**: el renglón elegido decía "este documento no vale
sin su vencimiento", y en la base ese requisito es efectivamente `expiration_policy = REQUIRED`.

**El documento de prueba se retiró.** Se subió a un conductor con 0 documentos —verificado en la base
antes, `MISSING` y sin archivo, para no pisar nada— y se borró por el mismo endpoint que usa la
interfaz. El estado quedó exactamente como estaba.

### Un defecto que sólo apareció al limpiar

`DELETE /compliance-records/{id}/file` devolvía el registro a `MISSING` **pero dejaba
`expiration_date`** con la fecha del documento borrado. Un vencimiento sin documento que lo respalde.

No es cosmético: la `urgencia` de `/pending` se calcula con esa fecha, así que al acercarse, un
documento **que no existe** aparecería como `POR_VENCER` —"hay que renovarlo"— en vez de `FALTA`.

La otra ruta al mismo estado —`reassign` con `to_tray`— **sí la limpiaba**: eran dos caminos al
mismo lugar haciendo cosas distintas. Y por `PATCH` no se podía arreglar a mano, porque usa
`COALESCE` y ahí `null` significa "no lo mandaron".

Corregido, con un test que muere al revertirlo.

### La suite automatizada no pudo correr, y por qué

`scripts/certificacion-carga.spec.ts` falla en el login: `.env.local` trae los valores de ejemplo
(`demo@webcarga.com` / `changeme`) y el formulario responde "Credenciales incorrectas". El
click-through de arriba se hizo con una sesión ya abierta en el navegador.

El helper de login se corrigió para **decirlo** en vez de morir con un `waitForURL` de 20 s. Para
correrla:

```bash
DEMO_EMAIL=<usuario> DEMO_PASSWORD=<clave> \
PLAYWRIGHT_BASE_URL=https://webcarga-frontend-dev-zcdyyci7ta-uc.a.run.app \
npx playwright test scripts/certificacion-carga.spec.ts
```
