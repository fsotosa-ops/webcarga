# Frontend — reglas

`CLAUDE.md` de esta carpeta apunta acá.

## Idioma de la interfaz

**Español neutral, nunca voseo.** "Elige", "Revisa", "Cierra", "Comparte", "puedes" — nunca
"Elegí", "Revisá", "podés". El producto opera en Chile y el equipo no es rioplatense.

Lo verifica `lib/copy/espanol-neutral.test.ts`, que recorre el código fuente. Existe porque
llegaron ocho casos a producción sin que nada los detectara.

## Iconos y texto

- **Cero emojis.** Sólo `lucide-react`. Al tocar un componente con emojis viejos, se reemplazan.
- **Etiqueta en español, ruta en inglés**: `Certificación` → `/dashboard/compliance`.
- **Nombrar por el trabajo, no por el modelo de datos**: "¿A quién pertenece?", no "Sujeto".
- **Selección múltiple antes que acciones por fila** cuando el volumen es alto, con barra
  contextual al seleccionar.

## Datos que todavía no llegaron

**Una cifra derivada no se muestra hasta tener el dato.** Un `?? 0` en una cifra grande afirma algo
falso mientras la consulta está en vuelo — pasó en Certificación, que mostraba "0 documentos por
cubrir" y después saltaba a 2.360.

**Las acciones que escriben quedan deshabilitadas mientras carga la información de la que
dependen.** El botón "Confirmar cierre" firmaba el día con el área de datos vacía.

## Sistema visual

Ver `docs/superpowers/specs/2026-08-16-sistema-visual-design.md`. En resumen, y hasta que los
tokens existan: **no agregar tamaños de letra ni colores nuevos**. Hoy hay 8-9 tamaños y 13-21
colores de texto por pantalla, y 1.824 usos de color crudo de Tailwind contra 571 de tokens propios.

## Antes de dar algo por listo

```
npx vitest run
npx tsc --noEmit
npm run build
```

Y **mirar la pantalla**, en escritorio y en teléfono. Un test no ve un renglón que se parte mal,
una fila que mide el doble de lo que debería, ni un cero que miente.
