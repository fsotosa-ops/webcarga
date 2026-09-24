import { createBrowserClient } from '@supabase/ssr'

const BASE = ''

// Singleton: evita crear un cliente Supabase nuevo en cada request
let sb: ReturnType<typeof createBrowserClient> | null = null

function supabase() {
  sb ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  return sb
}

export async function getToken(): Promise<string> {
  const { data } = await supabase().auth.getSession()
  return data.session?.access_token ?? ''
}

/** Cuando el servidor no explica el error. Un 502/503/504 lo produce la
 *  infraestructura (el backend no respondió, o no a tiempo), no la operación:
 *  lo que la persona necesita saber es que NO se aplicó y que puede
 *  reintentar. Es lo que no supo quien intentó firmar el cierre del 22/09
 *  mientras la base estaba saturada. */
export function mensajeSinDetalle(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return 'El servidor no respondió a tiempo; la operación no se aplicó. Reintenta en unos minutos.'
  }
  return `Error ${status}`
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken()
  // Con FormData el browser setea el Content-Type (incluye el boundary del multipart)
  const isFormData = init?.body instanceof FormData
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail = (err as { detail?: unknown }).detail
    // detail puede ser string o un objeto estructurado (ej: errores por fila del bulk)
    const message =
      typeof detail === 'string' ? detail
      : detail && typeof detail === 'object' && 'message' in detail ? String((detail as { message: unknown }).message)
      : mensajeSinDetalle(res.status)
    const e = new ApiError(message, res.status, detail)
    throw e
  }

  // 204/205/304 no traen cuerpo: res.json() lanza SyntaxError y hace fallar
  // una operación que en realidad salió bien. Le pasaba a todo DELETE — al
  // descartar un documento, el backend lo descartaba y la interfaz mostraba
  // un error y no refrescaba.
  if (res.status === 204 || res.status === 205 || res.status === 304) {
    return undefined as T
  }

  return res.json() as Promise<T>
}

/** Variante de apiFetch para descargas binarias (zip, etc.) — mismo auth
 *  que apiFetch, pero devuelve el Blob crudo en vez de parsear JSON. HU-08
 *  (Fase 0, 2026-07-21): primer consumidor es el export de documentos de
 *  una empresa. */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const token = await getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail = (err as { detail?: unknown }).detail
    const message = typeof detail === 'string' ? detail : `Error ${res.status}`
    throw new ApiError(message, res.status, detail)
  }
  return res.blob()
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
