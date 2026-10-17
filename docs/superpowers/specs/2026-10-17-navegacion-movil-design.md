# Navegación en el teléfono: barra por perfil, "Menú" y la marca real

**Fecha:** 2026-10-17 · **Rama:** `dev` (nada a `main`) · **Maqueta:**
`.superpowers/brainstorm/78194-1792268599/content/navegacion-movil.html`.

## Por qué

El usuario revisó la app en el teléfono (17/10): la barra de abajo "queda todo apretado" y la cabecera "no usa la
iconografía real del nombre WebCarga". En el código:

- **La barra de abajo** (`MOBILE_NAV_ITEMS` en `Sidebar.tsx`) aplana todas las entradas del menú: unas 15 (Monitor,
  Cierre del día, las cuatro del Directorio, las cuatro de Certificación, las de Seguros, Tarifario), en una fila que
  se desplaza de lado, con etiquetas en MAYÚSCULAS de 11 px. Es una segunda lista del menú, derivada a mano, y por eso
  creció sin límite.
- **La cabecera** (`Topbar.tsx`) es blanca, así que no puede usar el logo completo (cubo + nombre en cursiva), que
  existe solo en blanco para fondo oscuro: muestra el cubo y "WebCarga" escrito con la tipografía Mulish.

## Estándar de la industria

- **Material 3 (Navigation bar) y Apple HIG (Tab bar):** de 3 a 5 destinos, ícono **con** etiqueta corta en caja
  normal, sin desplazamiento lateral. Lo demás va en un último botón que abre el menú completo.
- **Solo íconos, no** (decisión del usuario, 17/10, tras la recomendación): Material solo permite quitar la etiqueta con
  3 destinos de íconos universales; la investigación de usabilidad (Nielsen Norman Group) muestra que el ícono solo
  baja comprensión y uso. Los módulos de WebCarga no tienen íconos universales.
- **Barra según el perfil** (Salesforce, SAP Fiori, Workday en móvil): la barra muestra los destinos del trabajo de la
  persona; el menú completo sigue a un toque.
- **Cabecera con la misma marca que el escritorio:** el logo oficial, sin reescribirlo.

## Objetivo

1. Una barra de abajo con **hasta 4 destinos según el perfil + "Menú"**, con ícono y etiqueta corta, que nunca se
   desplaza de lado.
2. **"Menú"** abre el menú completo como cajón, con **la misma definición** que la barra lateral del escritorio (grupos,
   entradas, permisos y contadores).
3. **Cabecera oscura con el logo oficial completo**, coherente con la barra de abajo, que ya es oscura.

**No es objetivo:** cambiar la barra lateral del escritorio, sus grupos o sus rutas; personalizar la barra a mano por
persona; una app nativa.

**Anti-objetivo:** que el teléfono y el escritorio tengan dos listas del menú que se separen con el tiempo (lo que
pasó con `MOBILE_NAV_ITEMS`); que un contador (Por asignar, cuotas) deje de verse por no estar en la barra.

## Diseño

### Una sola definición de la navegación

- `NAV_GROUPS`, `NAV_ITEMS` y `NAV_ORDEN` salen de `Sidebar.tsx` a `lib/navegacion/menu.ts`, con el filtro por
  permisos (`soloLoQuePuede`) y los contadores. La barra lateral del escritorio, el cajón "Menú" y la barra de abajo
  leen de ahí. Se retiran `MOBILE_NAV_ITEMS` y `REPEATED_LABELS`.
- Cada entrada gana un **`short`** opcional (la etiqueta de la barra de abajo, de hasta 12 caracteres) y un **`icon`**
  propio cuando el del grupo no la distingue. Ejemplos: "Cierre del día" → "Cierre"; "Por asignar" → "Por asignar";
  Empresas de Certificación → "Empresas" con el ícono de Certificación.

### La barra según el perfil

**El área principal** sale de los roles, con lo que ya existe en `lib/authz/roles.ts` (`AREAS`, `nivelEnArea`): el área
donde la persona tiene el nivel más alto (Supervisor sobre Operador); a igual nivel, el orden de `AREAS`
(Operaciones, Certificación, Seguros, Comercial). Sin ninguna área (Lectura, Administración, Soporte o Propietario
solos) el perfil es **General**.

**Los destinos de cada perfil** se declaran una vez, como dato (`MOBILE_DESTINATIONS` en `lib/navegacion/menu.ts`),
por `href` de entradas que ya existen en el menú:

| Perfil | Destinos (hasta 4) |
|---|---|
| Operaciones | Monitor · Cierre · Empresas (Directorio) · Conductores |
| Certificación | Por asignar · Pendientes · Empresas (Certificación) · Documentos exigidos |
| Seguros | Empresas (Seguros) · Pólizas · Cuotas |
| Comercial | Tarifario · Clientes |
| General | Monitor · Empresas (Directorio) · Certificación (Empresas) · Seguros |

*Llamada mía, a validar con quien usa cada área.* Un destino que la persona no puede ver (por permisos) se salta. El
último botón es siempre **"Menú"**.

- **La entrada activa:** si la pantalla actual no está en la barra, se marca "Menú" (la persona sabe que está "dentro
  del menú").
- **Contadores:** viajan con su entrada. En la barra, un número sobre el ícono; si la entrada no está en la barra, el
  número se suma en un punto sobre "Menú" y se ve completo dentro del cajón.

### El cajón "Menú"

- Se abre desde abajo a pantalla casi completa (`Dialog` del kit, fondo oscuro, Escape y gesto de cerrar), con los
  grupos y entradas de `lib/navegacion/menu.ts`, en el mismo orden y con los mismos contadores que la barra lateral.
- Abajo, la cuenta de la persona (nombre, rol) y sus acciones (Configuración si puede, salir), las mismas de
  `SidebarAccount`.
- Tocar una entrada navega y cierra el cajón.

### La cabecera

- Fondo oscuro (`bg-sidebar`, el mismo de la barra lateral y de la barra de abajo).
- A la izquierda, `LogoWebCarga forma="completo"` (el logo oficial blanco). A la derecha, el avatar de la persona, que
  abre su cuenta (lo mismo que en el cajón).
- Se retira el texto "WebCarga" escrito a mano.

### Medidas

- La barra mide lo que hoy (la altura que reserva `--mobile-nav-height`); cinco botones iguales de 20 % del ancho.
- Etiqueta en `text-etiqueta` (11 px), caja normal, una línea, sin cortarse a 360 px de ancho (el teléfono más angosto
  que se soporta).

## Criterios de aceptación (un test por criterio)

| # | Criterio | Nivel |
|---|---|---|
| N1 | La barra lateral, el cajón y la barra de abajo leen la misma definición; no existe otra lista del menú (guardia) | vitest |
| N2 | El área principal: Supervisor de Certificación + Operador de Operaciones → Certificación; solo Lectura → General | vitest |
| N3 | Cada perfil muestra sus destinos (máximo 4) + "Menú"; un destino sin permiso se salta | vitest |
| N4 | En una pantalla que no está en la barra, "Menú" queda marcado | vitest |
| N5 | Un contador de una entrada fuera de la barra se ve como punto en "Menú" y como número en el cajón | vitest |
| N6 | El cajón muestra los grupos y entradas de la barra lateral, con permisos; tocar una entrada navega y lo cierra | vitest |
| N7 | La cabecera usa el logo oficial completo y no escribe "WebCarga" a mano | vitest |
| N8 | A 360 y 390 px ninguna etiqueta se corta y la barra no se desplaza de lado | Playwright |

## Fuera de alcance

- Que cada persona elija sus destinos.
- Cambiar los grupos o rutas del menú del escritorio.
- Un logo en otro color (si WebCarga entrega una versión oscura, se cambia en `LogoWebCarga` y en ningún otro lado).
