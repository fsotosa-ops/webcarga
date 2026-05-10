# /deploy — Deploy frontend a Vercel

Automatiza el ciclo completo: verificar cambios → build local → push → deploy producción → verificar env vars → actualizar Supabase redirect URLs.

## Pasos

### 1. Verificar estado del repo
```bash
git status
git diff --stat HEAD
```
Si hay cambios sin commitear, preguntarle al usuario si quiere incluirlos antes del deploy.

### 2. Verificar env vars en Vercel
```bash
vercel env ls 2>&1
```
Confirmar que estén presentes:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (si no está, avisar que el panel admin no funcionará)

### 3. Build local de verificación
```bash
cd /Users/usuario/Desktop/projects/webcarga/monitor-app/frontend
npm run build 2>&1
```
Si falla, mostrar el error y detener. No deployar código roto.

### 4. Push a GitHub (si hay commits nuevos)
```bash
git push origin main 2>&1
```

### 5. Deploy a producción
```bash
cd /Users/usuario/Desktop/projects/webcarga/monitor-app/frontend
vercel --prod --yes 2>&1
```
Capturar la URL de producción del output (línea que empieza con `Aliased:` o `Production:`).

### 6. Verificar el deploy
Mostrar al usuario:
- URL de producción
- Link al dashboard de Vercel para ver logs: `vercel inspect <url> --logs`
- Recordatorio: si cambiaron las URLs, actualizar en Supabase Dashboard → Authentication → Redirect URLs

## Variables de entorno — cargar/actualizar
Si el usuario pide agregar o actualizar env vars:

```bash
# Para variable pública (todos los ambientes):
echo "VALOR" | vercel env add NOMBRE_VARIABLE production --force
echo "VALOR" | vercel env add NOMBRE_VARIABLE preview --force
echo "VALOR" | vercel env add NOMBRE_VARIABLE development --force

# Para variable privada (solo producción):
echo "VALOR" | vercel env add NOMBRE_VARIABLE production --force
```

## Config del proyecto
- **Proyecto Vercel:** `fsotosas-projects-7b3a7c7c/frontend`
- **Alias:** `https://frontend-two-alpha-39.vercel.app`
- **Root dir:** `monitor-app/frontend/`
- **Framework:** Next.js 16.2.6
- **Region:** Washington D.C. (iad1)
- **Supabase project:** `viclzoftiudkepqnhekv`

## Errores comunes

| Error | Causa | Fix |
|-------|-------|-----|
| `Supabase client: URL and API key required` | Env vars no cargadas en Vercel | Correr paso 2 y agregar las vars |
| `Exit code 1` en build | Error TypeScript o de compilación | Correr `npm run build` local primero |
| `No existing credentials` | Sesión Vercel expirada | `vercel login` |
| OAuth no redirige | URL de producción no está en Supabase redirect list | Agregar en Supabase → Auth → URL Configuration |
