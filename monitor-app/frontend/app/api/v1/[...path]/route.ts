import { type NextRequest, NextResponse } from 'next/server'

const BACKEND = process.env.FASTAPI_URL ?? 'http://localhost:8001'

async function proxy(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params
  const url = `${BACKEND}/api/v1/${path.join('/')}${req.nextUrl.search}`

  const headers: Record<string, string> = {}
  const auth = req.headers.get('authorization')
  if (auth) headers['Authorization'] = auth
  const ct = req.headers.get('content-type')
  if (ct) headers['Content-Type'] = ct

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text()
  }

  try {
    const res = await fetch(url, init)
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
