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
