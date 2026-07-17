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

// ── Empresas (public.carriers/drivers/assets/contacts + vistas de H1) ──────

export type OperationalStatus = 'ACTIVE' | 'INACTIVE' | 'LEGACY_INACTIVE'
export type EntityType = 'CARRIER' | 'DRIVER' | 'ASSET'
export type RequirementLevel = 'LEGAL_MANDATORY' | 'SHIPPER_REQUIRED' | 'CONDITIONAL_OPTIONAL'

/** Valores reales del CHECK constraint de public.compliance_records.status
 *  (init_compliance_engine.sql) — 7 estados, no los 5 legacy de Checkpoint A-E. */
export type ComplianceStatus =
  | 'MISSING' | 'PENDING_REVIEW' | 'APPROVED_MANUAL' | 'APPROVED'
  | 'REJECTED' | 'EXPIRED' | 'ARCHIVED'

/** Fila anidada en Carrier.compliance_records (GET /carriers/{id}) —
 *  is_expired/is_expiring_soon vienen calculados por el backend. */
export type ComplianceRecord = {
  id:                 string
  requirement_id:     string
  requirement_code:   string
  name:               string
  requirement_level:  RequirementLevel
  requires_file:      boolean
  status:             ComplianceStatus
  expiration_date:    string | null
  file_url:           string | null
  metadata:           Record<string, unknown>
  is_manual_override: boolean
  is_expired:         boolean
  is_expiring_soon:   boolean
  /** Última vez que cambió status/expiration_date — para "sin actualizar
   *  hace X días" (pedido explícito del usuario 2026-07-16: las alertas
   *  eran binarias MISSING/vencido sin decir desde cuándo). */
  updated_at:         string | null
}

/** GET/PATCH /compliance-records/{id} standalone — shape distinto al
 *  anidado: trae entity_id/entity_type/created_at/updated_at pero NO los
 *  flags is_expired/is_expiring_soon (esos solo se calculan en el detalle
 *  del carrier, ver _assemble_carrier_detail en routers/carriers.py). */
export type ComplianceRecordDetail = {
  id:                 string
  entity_id:          string
  entity_type:        EntityType
  requirement_id:     string
  requirement_code:   string
  name:               string
  requirement_level:  RequirementLevel
  requires_file:      boolean
  status:             ComplianceStatus
  expiration_date:    string | null
  file_url:           string | null
  metadata:           Record<string, unknown>
  is_manual_override: boolean
  created_at:         string | null
  updated_at:         string | null
}

/** Historial de reemplazos de un documento — derivado de public.audit_log,
 *  no de una tabla de versiones dedicada. Mismo shape para compliance_records
 *  y policies (ambos usan document_storage.py). */
export type DocumentVersion = {
  storage_path:  string | null
  status:        ComplianceStatus | null
  expiry_date:   string | null
  replaced_at:   string | null
  replaced_by:   string | null
  /** URL firmada, null si el storage_path es null o si la firma falló */
  url:           string | null
}

/** contact_role no tiene CHECK constraint en DB — string abierto (valores
 *  documentados: 'LEGAL_REP', 'OPERATIONS', etc., ver schemas/contact.py). */
export type Contact = {
  id:           string
  contact_role: string
  first_name:   string | null
  last_name:    string | null
  job_title:    string | null
  email:        string | null
  phone:        string | null
  is_primary:   boolean
  is_active:    boolean
}

export type ComplianceHealth = 'PENDING' | 'OK'

export type CarrierListItem = {
  id:                    string
  tax_id:                string
  country_code:          string
  business_name:         string
  operational_status:    OperationalStatus
  total_requirements:    number
  last_document_update:  string | null
  /** Requisitos LEGAL_MANDATORY MISSING/EXPIRED/REJECTED o vencidos por fecha —
   *  mismo criterio que `mandatoryProblems` en la ficha de empresa. */
  pending_mandatory:     number
  compliance_health:     ComplianceHealth
}

export type CarrierListFacets = {
  pending: number
  ok:      number
  total:   number
}

export type CarrierListResponse = {
  data:   CarrierListItem[]
  count:  number
  page:   number
  limit:  number
  facets: CarrierListFacets
}

/** GET /carriers/{id} — payload anidado (context_carriers.md §5 Paso 1) */
export type Carrier = {
  id:                  string
  tax_id:              string
  country_code:        string
  business_name:       string
  operational_status:  OperationalStatus
  legacy_admin_id:     string | null
  erp_id:              string | null
  is_manual_override:  boolean
  overridden_by:       string | null
  overridden_at:       string | null
  created_at:          string | null
  updated_at:          string | null
  contacts:            Contact[]
  compliance_records:  ComplianceRecord[]
}

export type CarrierDriverRosterItem = {
  id:                    string
  tax_id:                string
  full_name:             string
  operational_status:    OperationalStatus
  total_requirements:    number | null
  last_document_update:  string | null
}

export type CarrierAssetRosterItem = {
  id:                    string
  license_plate:         string
  asset_type:            string
  operational_status:    OperationalStatus
  total_requirements:    number | null
  last_document_update:  string | null
}

/** GET /carriers/{id}/shippers — generadores de carga (public.shippers) con
 *  los que opera la empresa, vía public.carrier_shippers. */
export type CarrierShipper = {
  id:          string
  name:        string
  status:      string
  start_date:  string | null
  end_date:    string | null
}

/** Conductor/vehículo como master data — independiente de a qué carrier
 *  esté asignado (GET/POST/PATCH /drivers, /assets). */
export type Driver = {
  id:                    string
  tax_id:                string
  country_code:          string
  full_name:             string
  operational_status:    OperationalStatus
  is_manual_override:    boolean
  created_at:            string | null
  total_requirements:    number | null
  last_document_update:  string | null
}

export type Asset = {
  id:                    string
  license_plate:         string
  asset_type:            string
  operational_status:    OperationalStatus
  is_manual_override:    boolean
  created_at:            string | null
  total_requirements:    number | null
  last_document_update:  string | null
}

// ── Seguros (public.insurance_* — M:N coberturas/activos) ──────────────────

export type PolicyStatus   = 'ACTIVE' | 'EXPIRED' | 'CANCELLED'
export type PaymentStatus  = 'PENDING' | 'PAID' | 'OVERDUE'
/** Calculado por app.carrier_insurance_status, no una columna real. */
export type PolicyHealth   = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'CANCELLED'

export type CoverageType = {
  id:          string
  code:        string
  name:        string
  description: string | null
}

/** Fila de GET /carriers/{id}/policies (vista app.carrier_insurance_status —
 *  coverage_names ya viene agregado como string, no la lista de ids). */
export type CarrierPolicyListItem = {
  id:                      string
  insurance_company:       string
  policy_number:           string | null
  coverage_names:          string
  total_assets_covered:    number
  policy_expiration_date:  string | null
  policy_health:           PolicyHealth
  missing_physical_file:   boolean
  total_installments:      number
  paid_installments:       number
  overdue_installments:    number
  next_payment_date:       string | null
}

/** Fila de GET /carriers/insurance-overview — un carrier con sus pólizas
 *  agregadas (peor salud, cuotas vencidas totales, próximo pago), misma
 *  fuente real (app.carrier_insurance_status) que la tab Seguros de la
 *  ficha. worst_policy_health es null cuando el carrier no tiene pólizas. */
export type CarrierInsuranceOverviewItem = {
  carrier_id:                  string
  business_name:               string
  tax_id:                      string
  operational_status:          OperationalStatus
  total_policies:              number
  total_overdue_installments:  number
  next_payment_date:           string | null
  worst_policy_health:         PolicyHealth | null
}

export type InsuranceOverviewFacets = {
  expired:        number
  expiring_soon:  number
  valid:          number
  cancelled:      number
  no_policy:      number
  total:          number
}

export type CarrierInsuranceOverviewResponse = {
  data:   CarrierInsuranceOverviewItem[]
  count:  number
  page:   number
  limit:  number
  facets: InsuranceOverviewFacets
}

export type PolicyCoverage = {
  coverage_type_id: string
  code:             string
  name:             string
}

export type PolicyAsset = {
  asset_id:      string
  license_plate: string
  asset_type:    string
}

export type InsuranceInstallment = {
  id:                  string
  installment_number:  number
  total_installments:  number
  amount_uf:           number | null
  due_date:            string | null
  payment_status:      PaymentStatus
  paid_at:             string | null
}

/** GET /policies/{id} — payload anidado (coverages/assets/installments M:N) */
export type InsurancePolicy = {
  id:                        string
  carrier_id:                string
  insurance_company:         string
  policy_number:             string | null
  valid_from:                string | null
  valid_to:                  string | null
  expiration_alert_days:     number
  policy_document_url:       string | null
  has_endorsement:           boolean
  endorsement_document_url:  string | null
  external_portal_url:       string | null
  status:                    PolicyStatus
  is_manual_override:        boolean
  created_at:                string | null
  updated_at:                string | null
  coverages:                 PolicyCoverage[]
  assets:                    PolicyAsset[]
  installments:              InsuranceInstallment[]
}

// Can an admin manage (change role / deactivate) a target user?
export function canManage(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'owner') return true
  if (actorRole === 'admin') return targetRole !== 'owner' && targetRole !== 'admin'
  return false
}

export type Profile = Database['public']['Tables']['profiles']['Row'] & { active: boolean }
