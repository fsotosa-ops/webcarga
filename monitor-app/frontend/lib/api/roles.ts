export type RoleInfo = {
  id:          string
  label:       string
  description: string
  level:       number
}

export async function fetchRoles(): Promise<RoleInfo[]> {
  const res = await fetch('/api/v1/roles', { next: { revalidate: 3600 } })
  if (!res.ok) throw new Error(`Error ${res.status} al cargar roles`)
  return res.json()
}

export async function fetchRolesServer(): Promise<RoleInfo[]> {
  const base = process.env.FASTAPI_URL ?? 'http://localhost:8001'
  const res = await fetch(`${base}/api/v1/roles`, { next: { revalidate: 3600 } })
  if (!res.ok) throw new Error(`Error ${res.status} al cargar roles`)
  return res.json()
}
