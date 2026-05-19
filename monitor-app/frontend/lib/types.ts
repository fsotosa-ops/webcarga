export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: string
          active: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role?: string
          active?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
          active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: Record<never, never>
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
  gold: {
    Tables: {
      diario_manual_fields: {
        Row: DiarioManualFields
        Insert: {
          id?: string
          fecha: string
          dni_driver: string
          tractor_plate?: string | null
          activo?: boolean
          trabajando?: boolean
          asignado?: boolean
          telefono?: string | null
          observaciones?: string | null
          comentarios?: string | null
          pendientes_am?: string | null
          asistencia_sabado_domingo?: boolean
          sosafe?: boolean
          vacaciones?: boolean
          disponible_domingo?: boolean
          turno_manana?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Omit<DiarioManualFields, 'id'>>
        Relationships: []
      }
    }
    Views: {
      v_diario_trips: {
        Row: DiarioTrip
        Relationships: []
      }
    }
    Functions: Record<never, never>
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}

// Gold schema types (manually defined — not in typegen output)
export type DiarioTrip = {
  status_id: string | null
  fecha: string | null
  client_name: string | null
  tms_name: string | null
  eett: string | null
  rut_eett: string | null
  conductor: string | null
  rut_conductor: string | null
  patente_tracto: string | null
  patente_rampla: string | null
  tipo_vehiculo: string | null
  cd_planta_origen: string | null
  status_raw: string | null
  normalized_status: string | null
  local_asignado: string | null
  cargo_type: string | null
  temperature: string | null
  planning_date: string | null
  arrival_date: string | null
  departure_date: string | null
  unload_start: string | null
  unload_end: string | null
  gps_arrival_date: string | null
  gps_departure_date: string | null
  s2s: string | null
  sap_number: string | null
}

export type DiarioManualFields = {
  id: string
  fecha: string
  dni_driver: string
  tractor_plate: string | null
  activo: boolean
  trabajando: boolean
  asignado: boolean
  telefono: string | null
  observaciones: string | null
  comentarios: string | null
  pendientes_am: string | null
  asistencia_sabado_domingo: boolean
  sosafe: boolean
  vacaciones: boolean
  disponible_domingo: boolean
  turno_manana: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type DiarioRow = DiarioTrip & {
  manual: DiarioManualFields | null
}

export type NormalizedStatus =
  | 'ASIGNADO'
  | 'ORIGEN'
  | 'RUTA'
  | 'EN LOCAL'
  | 'RETORNADO CD'
  | 'VIAJE EN PREDIO'
  | 'RETORNANDO'
  | 'DEVUELTO'
  | 'CANCELADO'
  | 'CERRADO INCOMPLETO'
  | 'CERRADO FINALIZADO'
  | 'CERRADO MANUAL'
  | 'CERRADO SIN GPS'
  | 'CERRADO POR OTRO VIAJE'

// Role hierarchy (ascending permissions)
export type UserRole = 'viewer' | 'writer' | 'editor' | 'admin' | 'owner'

export const ROLE_LABELS: Record<UserRole, string> = {
  viewer: 'Viewer',
  writer: 'Writer',
  editor: 'Editor',
  admin: 'Admin',
  owner: 'Owner',
}

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  viewer:  'Solo lectura — ve Diario, EETT y conductores',
  writer:  'Edita campos básicos del Diario (toggles, observaciones, teléfono)',
  editor:  'Edita todos los campos del Diario incluyendo los sensibles',
  admin:   'Editor + gestión de usuarios',
  owner:   'Acceso total — protegido, no puede ser degradado por admins',
}

// Returns true if role has at least the required permission level
export function hasRole(userRole: string | undefined, required: UserRole): boolean {
  const order: UserRole[] = ['viewer', 'writer', 'editor', 'admin', 'owner']
  const userIdx = order.indexOf((userRole ?? 'viewer') as UserRole)
  const reqIdx  = order.indexOf(required)
  return userIdx >= reqIdx
}

// ── Trips (app.trips via FastAPI) ──────────────────────────────────

export type TripStop = {
  stop_id:            string
  local:              string | null
  planning_date:      string | null
  arrival_date:       string | null
  departure_date:     string | null
  unload_start:       string | null
  unload_end:         string | null
  gps_arrival_date:   string | null
  gps_departure_date: string | null
  on_time_status:     'ON TIME' | 'OFF TIME' | null
  destination_city:   string | null
  destination_region: string | null
  s2s:                string | null
  temperature:        number | null
}

export type Trip = {
  id:                     string
  tms_name:               string
  client_name:            string | null
  planning_date:          string | null
  status_reported_at:     string | null
  current_status:         string | null
  tractor_plate:          string | null
  trailer_plate:          string | null
  driver_name:            string | null
  driver_rut:             string | null
  transporter:            string | null   // linked company (tp.business_name) only
  transporter_tms:        string | null   // TMS-reported name (fleet->>'transporter_name_tms')
  origin:                 string | null
  cargo_type:             string | null
  stops:                  TripStop[]
  activo:                 boolean
  trabajando:             boolean
  asignado:               boolean
  primera_vuelta:         boolean
  estado_manual:          string | null
  observaciones:          string | null
  comentarios:            string | null
  fleet_link_id:          string | null
  transporter_profile_id: string | null
  manually_edited_fields: string[]
  edited_at:              string | null
  updated_at:             string | null
}

// ── Compliance & Governance ─────────────────────────────────────────

export type ComplianceStatus = 'ok' | 'pendiente' | 'actualizar' | 'n_a'
export type AlertStatus = 'expired' | 'expiring_soon' | 'ok'

export type DriverGovernance = {
  id_expiry:          string | null
  license_expiry:     string | null
  anexo_3_walmart:    ComplianceStatus | null
  epp:                ComplianceStatus | null
  das_odi:            ComplianceStatus | null
  hoja_de_vida:       ComplianceStatus | null
  cert_antecedentes:  ComplianceStatus | null
  validado_walmart:   ComplianceStatus | null
  contrato_trabajo:   ComplianceStatus | null
  creacion_walmart:   ComplianceStatus | null
  avance_total:       number | null
}

export type VehicleGovernance = {
  year:                   number | null
  circ_permit_expiry:     string | null
  tech_inspection_expiry: string | null
  gas_emissions_expiry:   string | null
  soap_insurance_expiry:  string | null
  poliza_rc:              ComplianceStatus | null
  gps:                    ComplianceStatus | null
  seguro_carga:           ComplianceStatus | null
  mantencion_camara_frio: ComplianceStatus | null
  creacion_walmart:       ComplianceStatus | null
}

export type CompanyGovernance = {
  rol_sii:            ComplianceStatus | null
  copia_ci_rep_legal: ComplianceStatus | null
  anexo_2_walmart:    ComplianceStatus | null
  contrato_webcarga:  ComplianceStatus | null
  f30_multas:         ComplianceStatus | null
  f43:                ComplianceStatus | null
  politica_seguridad: ComplianceStatus | null
  cert_mutual:        ComplianceStatus | null
  riohs_timbrado:     ComplianceStatus | null
  creacion_walmart:   ComplianceStatus | null
  carpeta_tributaria: ComplianceStatus | null
  cuenta_empresa:     ComplianceStatus | null
  avance_8020:        number | null
  avance_total:       number | null
}

export type ComplianceAlertSummary = {
  driver_ruts:         Record<string, AlertStatus>
  plates:              Record<string, AlertStatus>
  total_expired:       number
  total_expiring_soon: number
}

// ── Transporter Profiles (app.transporter_profiles via FastAPI) ────

export type TransporterDriver = {
  id: string
  rut: string
  name: string
  governance: DriverGovernance | null
}

export type TransporterVehicle = {
  id: string
  type: string
  plate: string
  governance: VehicleGovernance | null
}

export type TransporterTrailer = {
  id: string
  plate: string
}

export type TransporterContactability = {
  emails: string[]
  phones: string[]
}

export type TransporterProfile = {
  id: string
  admin_id: string | null
  business_name: string | null
  rut: string | null
  account_stage: string | null
  contactability: TransporterContactability | null
  drivers: TransporterDriver[]
  vehicles: TransporterVehicle[]
  trailers: TransporterTrailer[]
  company_governance: CompanyGovernance | null
  manually_edited_fields: string[]
  edited_at: string | null
}

export type TransporterListItem = {
  id: string
  admin_id: string | null
  business_name: string | null
  rut: string | null
  account_stage: string | null
  driver_count: number
  vehicle_count: number
  trailer_count: number
  has_manual_edits: boolean
  has_active_alerts: boolean
}

export type TransporterListResponse = {
  data: TransporterListItem[]
  count: number
  page: number
  limit: number
}

// Can an admin manage (change role / deactivate) a target user?
export function canManage(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'owner') return true
  if (actorRole === 'admin') return targetRole !== 'owner' && targetRole !== 'admin'
  return false
}

export type Profile = Database['public']['Tables']['profiles']['Row'] & { active: boolean }
