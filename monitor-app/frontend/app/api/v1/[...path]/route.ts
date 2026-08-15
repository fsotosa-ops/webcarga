import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Margen antes del vencimiento en el que sí conviene ir a refrescar. */
const TOKEN_REFRESH_MARGIN_S = 120

/** Estados que la especificacion HTTP define sin cuerpo. */
const NULL_BODY_STATUS = new Set([204, 205, 304])

const BACKEND = (process.env.FASTAPI_URL ?? 'http://localhost:8001').trim()

async function getServerToken(): Promise<string> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  // getSession() lee la cookie sin salir a la red. getUser(), en cambio, va a
  // la API de Auth de Supabase EN CADA request — y una ficha dispara decenas
  // de llamadas en paralelo, así que alcanzaba el límite y devolvía 429
  // ("Many requests", visto en producción al abrir un conductor).
  //
  // Sólo se sale a la red cuando el token está por vencer, que es lo único
  // para lo que hacía falta: ahí getUser() dispara el refresco.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return ''

  const quedan = (session.expires_at ?? 0) - Math.floor(Date.now() / 1000)
  if (quedan > TOKEN_REFRESH_MARGIN_S) return session.access_token

  await supabase.auth.getUser()
  const { data: { session: renovada } } = await supabase.auth.getSession()
  return renovada?.access_token ?? session.access_token
}

async function proxy(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params
  const url = `${BACKEND}/api/v1/${path.join('/')}${req.nextUrl.search}`

  const token = await getServerToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const ct = req.headers.get('content-type')
  if (ct) headers['Content-Type'] = ct

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Reenvío binario: req.text() decodifica como UTF-8 y corrompe cuerpos
    // multipart (PDF/imágenes) — el backend respondía 400 al no poder parsearlos
    init.body = Buffer.from(await req.arrayBuffer())
  }

  try {
    const res = await fetch(url, init)

    // 204/205/304 no admiten cuerpo: construir una Response con body (aunque
    // sea '') lanza TypeError, caía en el catch de abajo y el navegador veía
    // un 502 aunque el backend hubiera respondido bien. Afectaba a TODO
    // DELETE de la app — visto en vivo al descartar en la bandeja.
    if (NULL_BODY_STATUS.has(res.status)) {
      return new NextResponse(null, { status: res.status })
    }

    const body = await res.text()
    return new NextResponse(body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Backend unreachable'
    return NextResponse.json({ detail: msg }, { status: 502 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, params)
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, params)
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, params)
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, params)
}
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, params)
}
