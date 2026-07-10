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

// Returns true if role has at least the required permission level
export function hasRole(userRole: string | undefined, required: UserRole): boolean {
  const order: UserRole[] = ['viewer', 'writer', 'editor', 'admin', 'owner']
  const userIdx = order.indexOf((userRole ?? 'viewer') as UserRole)
  const reqIdx  = order.indexOf(required)
  return userIdx >= reqIdx
}

// ── Trips metadata (from GET /api/v1/trips/meta) ───────────────────

export type StatusMeta = {
  id:         string
  label:      string
  bg_color:   string
  text_color: string
  group:      string
}

export type TmsSourceMeta = {
  id:         string
  label:      string
  bg_color:   string
  text_color: string
}

export type OperationalStateMeta = {
  id:         string
  label:      string
  bg_color:   string
  text_color: string
  /** Grupo del tablero (misma taxonomía que StatusMeta.group) */
  group?:     string
}

export type AlertThresholdMeta = {
  doc_type:     string
  label:        string
  warning_days: number
  error_days:   number
}

export type CSVColumnDef = {
  field:    string
  csv_key:  string
  label:    string
  required: boolean
  type:     'date' | 'text' | 'status' | 'tms_source' | 'stops'
  example:  string
}

export type TemperatureRangeMeta = {
  cargo_type: string
  label:      string
  min_c:      number
  max_c:      number
}

/** Conductor que terminó todos sus viajes del día — reasignable */
export type AvailableDriver = {
  driver_name:    string
  driver_rut:     string | null
  driver_phone:   string | null
  tractor_plate:  string | null
  transporter:    string | null
  trips_total:    number
  last_report_at: string | null
}

export type MonitorAlertRules = {
  stale_report_hours:     number
  dwell_hours:            number
  late_arrival_grace_min: number
  unassigned_enabled:     boolean
}

export type TripsMeta = {
  statuses:            StatusMeta[]
  tms_sources:         TmsSourceMeta[]
  operational_states:  OperationalStateMeta[]
  alert_thresholds:    AlertThresholdMeta[]
  csv_columns:         CSVColumnDef[]
  temperature_ranges:  TemperatureRangeMeta[]
  monitor_alert_rules?: MonitorAlertRules | null
}

// Entrada inmutable de la bitácora de un viaje (app.trip_notes)
// 'sistema' lo genera solo la API (auditoría de acciones); el resto los crea el operador
export type TripNoteType = 'observacion' | 'llamada' | 'whatsapp' | 'incidente' | 'sistema'

export type TripNoteAttachment = {
  id:         string
  file_name:  string
  mime_type:  string
  size_bytes: number
  /** Signed URL (1h) — null si la firma falló */
  url:        string | null
}

export type TripNote = {
  id:          string
  trip_id:     string
  author_id:   string
  author_name: string | null
  body:        string
  note_type:   TripNoteType
  pinned:      boolean
  created_at:  string
  attachments: TripNoteAttachment[]
}

export type TripStopCreatePayload = {
  local:               string
  planning_date?:      string | null
  /** Dropdown región/ciudad de Chile — van a las claves destination_* del jsonb stops */
  destination_region?: string | null
  destination_city?:   string | null
}

export type TripCreatePayload = {
  planning_date:          string
  /** Sistema de ORIGEN del viaje (TMS mapeado, texto libre o null) — el canal
   *  de ingreso es siempre 'manual' (lo fuerza el backend) */
  origin_tms?:            string | null
  source_system_trip_id?: string | null
  client_name?:           string | null
  origin?:                string | null
  origin_region?:         string | null
  origin_city?:           string | null
  cargo_type?:            string | null
  current_status?:        string | null
  stops?:                 TripStopCreatePayload[]
  tractor_plate?:         string | null
  trailer_plate?:         string | null
  driver_name?:           string | null
  driver_rut?:            string | null
  driver_phone?:          string | null
  transporter_name?:      string | null
  transporter_profile_id?:string | null
}

// ── Trips (app.trips via FastAPI) ──────────────────────────────────

export type TripStop = {
  stop_id:             string
  local:               string | null
  planning_date:       string | null
  arrival_date:        string | null
  departure_date:      string | null
  departure_date_prog: string | null  // salida planificada — hoy solo la puebla Wingsuite (pendiente de un cambio en Mage), null para el resto
  unload_start:        string | null
  unload_end:          string | null
  gps_arrival_date:    string | null
  gps_departure_date:  string | null
  on_time_status:      'ON TIME' | 'OFF TIME' | null
  destination_city:    string | null
  destination_region:  string | null
  s2s:                 string | null
  temperature:         number | null
  milestone_status:    string | null  // per-stop, distinct from Trip.milestone_status (trip-level)
}

export type Trip = {
  id:                     string
  source_system:          string
  /** Solo viajes manuales: TMS de origen declarado al registrarlo (null si no aplica) */
  origin_tms?:            string | null
  client_name:            string | null
  planning_date:          string | null
  status_reported_at:     string | null
  current_status:         string | null
  tractor_plate:          string | null
  trailer_plate:          string | null
  driver_name:            string | null
  driver_rut:             string | null
  driver_phone:           string | null
  transporter:            string | null   // linked company (tp.business_name) only
  transporter_tms:        string | null   // TMS-reported name (fleet->>'transporter_name_tms')
  origin:                 string | null
  /** Ubicación complementaria asignada desde el Monitor (dropdown Chile) —
   *  el pipeline nunca la escribe */
  origin_region?:         string | null
  origin_city?:           string | null
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
  edited_by:              string | null  // nombre/email ya resueltos por el backend, nunca un uuid
  updated_at:             string | null
  created_at:             string | null
  source_system_trip_id:  string | null
  milestone_status:       string | null  // trip-level, distinct from TripStop.milestone_status
  pipeline_updated_at:    string | null
}

// ── Compliance & Governance ─────────────────────────────────────────

export type ComplianceStatus = 'ok' | 'pendiente' | 'actualizar' | 'n_a' | 'factible'
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
  padron:                 ComplianceStatus | null
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

// ── Empresas EETT — modelo relacional (plan-modulo-empresas-seguros.md §4) ──

/** Motivo por el que una empresa/conductor/vehículo no está habilitado —
 *  ver app.v_transporter_eligibility (plan §1.7). Valores conocidos:
 *  'docs_below_threshold' | 'insurance_overdue' | 'inactive' (string abierto
 *  por si el backend agrega motivos nuevos sin requerir deploy de frontend). */
export type BlockingReason = string

export type TransporterContact = {
  role:  'rep_legal' | 'operacional' | 'finanzas' | 'documentos'
  name:  string | null
  phone: string | null
  email: string | null
}

/** Documento dentro de TransporterProfile.documents (GET /transporters/{id}) */
export type TransporterDocument = {
  doc_code:        string
  label:           string
  status:          ComplianceStatus | null
  expiry_date:     string | null
  file_url:        string | null
  storage_path:    string | null
  manual_override: boolean
  updated_at:      string | null
}

/** Resultado de PATCH/POST sobre un documento — shape distinto (incluye id/entity_*) */
export type TransporterDocumentPatchResult = {
  id:              string
  entity_type:     string
  entity_id:       string
  doc_code:        string
  status:          ComplianceStatus | null
  expiry_date:     string | null
  file_url:        string | null
  storage_path:    string | null
  notes:           string | null
  manual_override: boolean
  updated_at:      string | null
}

export type TransporterEligibility = {
  eligible:         boolean
  compliance_pct:   number | null
  insurance_ok:     boolean
  blocking_reasons: BlockingReason[]
}

export type StoredFile = {
  id:            string
  storage_path:  string
  file_name:     string
  mime_type:     string | null
  size_bytes:    number | null
  version:       number
  uploaded_by:   string | null
  uploaded_at:   string
  /** Solo presente en GET .../files (URL firmada, null si la firma falló) */
  url?:          string | null
}

export type TransporterProfile = {
  id: string
  admin_id: string | null
  business_name: string | null
  rut: string | null
  account_stage: string | null
  contactability: TransporterContactability | null
  contacts: TransporterContact[]
  drivers: TransporterDriver[]
  vehicles: TransporterVehicle[]
  trailers: TransporterTrailer[]
  company_governance: CompanyGovernance | null
  manually_edited_fields: string[]
  edited_at: string | null
  updated_at?: string | null
  in_admin: boolean
  clients: string[]
  eligibility: TransporterEligibility
  documents: TransporterDocument[]
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
  tracto_count: number
  has_manual_edits: boolean
  has_active_alerts: boolean
  in_admin: boolean
  clients: string[]
  avance_80_20: number | null
  avance_total: number | null
  compliance_pct: number | null
  eligible: boolean | null
  insurance_ok: boolean | null
  blocking_reasons: BlockingReason[]
}

export type TransporterListResponse = {
  data: TransporterListItem[]
  count: number
  page: number
  limit: number
}

// ── Seguros (app.insurance_policies / app.insurance_installments) ──────────

export type InstallmentStatus = 'pagada' | 'pendiente' | 'vencida'
export type PolicyType = 'rc_vehicular' | 'rc_eett' | 'carga' | 'otro'

export type InsuranceInstallment = {
  id:                  string
  policy_id:           string
  installment_number:  number
  total_installments:  number | null
  amount_uf:           number | null
  due_date:            string | null
  status:              InstallmentStatus
  paid_at:             string | null
  payment_url:         string | null
  manual_override:     boolean
  updated_at:          string | null
}

export type InsurancePolicy = {
  id:               string
  transporter_id:   string | null
  rut:              string
  contractor_name:  string | null
  client_group:     string | null
  company:          string
  policy_number:    string
  endorsement:      string | null
  coverage:         string | null
  plate:            string | null
  policy_type:      PolicyType | null
  valid_from:       string | null
  valid_to:         string | null
  payment_url:      string | null
  file_url:         string | null
  storage_path:     string | null
  updated_at:       string | null
  installments?:    InsuranceInstallment[]
}

export type InsuranceSummaryRow = {
  rut:             string
  business_name:   string | null
  transporter_id:  string | null
  policies_count:  number
  next_due:        { date: string; amount_uf: number | null } | null
  overdue_count:   number
  paid_pct:        number | null
  insurance_ok:    boolean
}

export type InsuranceTransporterResponse = {
  rut:            string
  transporter_id: string
  policies:       InsurancePolicy[]
}

// Can an admin manage (change role / deactivate) a target user?
export function canManage(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'owner') return true
  if (actorRole === 'admin') return targetRole !== 'owner' && targetRole !== 'admin'
  return false
}

export type Profile = Database['public']['Tables']['profiles']['Row'] & { active: boolean }
