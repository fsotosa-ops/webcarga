// Este test verifica la lógica de decisión del rate limiter sin llamar a Redis real.
// Usa un mock de Ratelimit para aislar el comportamiento del middleware.
import { NextRequest } from "next/server"

// Mock de @upstash/ratelimit: simula éxito en el primer intento y falla en el segundo
const mockLimit = jest.fn()
jest.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = jest.fn().mockReturnValue("limiter")
    constructor() {}
    limit = mockLimit
  },
}))
jest.mock("@upstash/redis", () => ({
  Redis: { fromEnv: jest.fn().mockReturnValue({}) },
}))

// Importar proxy DESPUÉS de los mocks
const { proxy } = require("../proxy")

function makeRequest(pathname: string, ip = "1.2.3.4") {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: { "x-forwarded-for": ip },
  })
}

describe("rate limiting in proxy middleware", () => {
  beforeEach(() => jest.clearAllMocks())

  it("pasa rutas estáticas sin verificar rate limit", async () => {
    const req = makeRequest("/_next/static/chunk.js")
    await proxy(req)
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it("devuelve 429 cuando rate limit excedido en /dashboard", async () => {
    mockLimit.mockResolvedValue({ success: false, limit: 20, remaining: 0 })
    const req = makeRequest("/dashboard/diario")
    const res = await proxy(req)
    expect(res?.status).toBe(429)
    expect(res?.headers.get("Retry-After")).toBe("10")
  })

  it("pasa cuando rate limit no excedido en /api/", async () => {
    mockLimit.mockResolvedValue({ success: true, limit: 20, remaining: 19 })
    const req = makeRequest("/api/v1/health")
    const res = await proxy(req)
    expect(res?.status).not.toBe(429)
  })
})
