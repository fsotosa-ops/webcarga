# /check-env — Verificar variables de entorno (local + Vercel)

Compara el `.env.local` con lo que está configurado en Vercel, detecta faltantes y propone el fix.

## Pasos

### 1. Leer .env.local
```bash
cat /Users/usuario/Desktop/projects/webcarga/monitor-app/frontend/.env.local
```
Extraer todas las variables definidas (no comentadas).

### 2. Listar env vars en Vercel
```bash
cd /Users/usuario/Desktop/projects/webcarga/monitor-app/frontend
vercel env ls 2>&1
```

### 3. Comparar y reportar
Mostrar una tabla:

| Variable | Local | Vercel Prod | Vercel Preview | Estado |
|----------|-------|-------------|----------------|--------|
| NEXT_PUBLIC_SUPABASE_URL | ✓ | ✓ | ✓ | OK |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | ✓ | ✓ | ✓ | OK |
| SUPABASE_SERVICE_ROLE_KEY | ✗ | ✗ | — | ⚠️ falta |

### 4. Para cada variable faltante en Vercel
Preguntar al usuario si quiere agregarla, y si sí:
```bash
echo "VALOR" | vercel env add NOMBRE production --force
```

## Variables requeridas

| Variable | Ámbito | Descripción |
|----------|--------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Todos | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Todos | Anon key (público, RLS protege datos) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo prod | Para crear/eliminar usuarios en admin panel |

## Obtener el service_role key
Supabase Dashboard → Project Settings → API → **service_role** (secret)
