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
}

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

export type UnassignedReasonMeta = {
  id:    string
  label: string
}

/** Clasificación RM/Zona Cero por local (public.locations.operation_type,
 *  catálogo de locales — H2.6). Valores fijos de la planilla, no editables
 *  desde Configuración. */
export type OperationTypeMeta = {
  id:         string
  label:      string
  bg_color:   string
  text_color: string
}

/** Shape común mínimo entre AvailableDriver y DriverSearchResult — lo que
 *  DriverSearchPicker necesita para autocompletar empresa/vehículo al
 *  elegir un conductor, sin importar si vino de la lista sugerida (hoy
 *  disponible) o de una búsqueda libre. */
export type DriverPickCandidate = {
  driver_id:         string
  driver_name:       string
  driver_rut:        string | null
  driver_phone:      string | null
  carrier_id:        string | null
  carrier_name:      string | null
  tractor_asset_id:  string | null
  tractor_plate:     string | null
  /** Solo presente en resultados de GET /drivers/fuzzy-match (HU-06,
   *  Fase 3) — 0-1, similitud de texto (pg_trgm) contra el nombre TMS. */
  similarity?:       number
}

/** Conductor activo del directorio de empresas sin viaje abierto hoy — reasignable */
export type AvailableDriver = DriverPickCandidate & {
  trips_total:    number
  last_report_at: string | null
}

/** Equipo (tracto) activo del directorio de empresas sin viaje abierto hoy —
 *  Centro de Flota (2026-07-28). driver_* viene del viaje de hoy si tuvo
 *  alguno, o del conductor habitual asignado al equipo si no. */
export type AvailableAsset = {
  asset_id:       string
  tractor_plate:  string
  asset_type:     string | null
  carrier_id:     string | null
  carrier_name:   string | null
  trips_total:    number
  last_report_at: string | null
  driver_id:      string | null
  driver_name:    string | null
  driver_rut:     string | null
  driver_phone:   string | null
}

/** Equipo con un viaje ABIERTO hoy (Centro de Flota, Opción B — 2026-07-28)
 *  — el complemento real de `items`, con datos concretos del viaje para
 *  poder abrirlo, en vez de solo un conteo sin filas. */
export type BusyAsset = {
  asset_id:       string
  tractor_plate:  string
  carrier_name:   string | null
  trip_id:        string
  client_name:    string | null
  current_status: string | null
}

export type AvailableAssetsResponse = {
  total_active: number
  items:        AvailableAsset[]
  busy:         BusyAsset[]
}

/** HU-01 (Cierre del Día, Fase 2) — un equipo dentro de la "Vista de flota
 *  del día". `categories` puede traer más de un valor si la empresa tiene
 *  más de un tipo de operación seleccionado (multi-selector, ver Fase 1). */
export type FleetOverviewEquipment = {
  asset_id:       string
  tractor_plate:  string
  carrier_id:     string
  carrier_name:   string
  categories:     ('TRACTOREO' | 'EQUIPO_COMPLETO' | 'SIN_CLASIFICAR')[]
  con_carga:      boolean
  trip_id:        string | null
  client_name:    string | null
  origin:         string | null
}

export type FleetOverviewCategory = {
  category:         'TRACTOREO' | 'EQUIPO_COMPLETO' | 'SIN_CLASIFICAR'
  assigned:         number
  unassigned:       number
  utilization_pct:  number
}

export type FleetDailyOverviewResponse = {
  fecha:      string
  categories: FleetOverviewCategory[]
  equipment:  FleetOverviewEquipment[]
}

/** Resultado de GET /drivers?q= — búsqueda general de conductores activos */
export type DriverSearchResult = DriverPickCandidate

export type MonitorAlertRules = {
  stale_report_hours:     number
  dwell_hours:            number
  late_arrival_grace_min: number
  unassigned_enabled:     boolean
  /** Hito 14 (minuta 29/07 §4.4): umbrales del semáforo de tiempo en el
   *  local activo, en minutos — verde por debajo de dwell_yellow_min. */
  dwell_yellow_min:       number
  dwell_orange_min:       number
  dwell_red_min:          number
}

export type TripsMeta = {
  statuses:            StatusMeta[]
  tms_sources:         TmsSourceMeta[]
  operational_states:  OperationalStateMeta[]
  alert_thresholds:    AlertThresholdMeta[]
  csv_columns:         CSVColumnDef[]
  temperature_ranges:  TemperatureRangeMeta[]
  unassigned_reasons:  UnassignedReasonMeta[]
  operation_types:     OperationTypeMeta[]
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
  /** Solo tiene significado para note_type='incidente' — null = abierto,
   *  con timestamp = resuelto (Fase 2, Plan 5). */
  resolved_at: string | null
}

export type TripStopCreatePayload = {
  local:               string
  planning_date?:      string | null
  /** Dropdown región/ciudad de Chile — van a las claves destination_* del jsonb stops */
  destination_region?: string | null
  destination_city?:   string | null
  /** 'ORIGIN' | 'DESTINATION' — el origen del viaje se manda como una parada
   *  más (Ronda 26, Fase 2, backend ya unificado). Opcional (default
   *  'DESTINATION' en el backend) para no romper construcciones existentes
   *  de este tipo que todavía no lo mandan (TripAssignDialog.tsx, hasta que
   *  el Plan 3 de esta Fase lo rewiree sobre RouteEditor). */
  stop_type?:          'ORIGIN' | 'DESTINATION'
}

export type TripCreatePayload = {
  planning_date:          string
  /** Sistema de ORIGEN del viaje (TMS mapeado, texto libre o null) — el canal
   *  de ingreso es siempre 'manual' (lo fuerza el backend) */
  origin_tms?:            string | null
  source_system_trip_id?: string | null
  client_name?:           string | null
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
  carrier_id?:            string | null
  driver_id?:             string | null
  tractor_asset_id?:      string | null
  trailer_asset_id?:      string | null
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
  /** true si unload_start/unload_end vienen de un override manual (Desc.
   *  Inicio/Fin) en vez de lo reportado por el TMS — campo híbrido, ver
   *  esquema de fechas 2026-07-17. Ausente (no `false` explícito) cuando el
   *  viaje no tiene ningún override todavía. */
  desc_manual?:        boolean
  /** Mismo mecanismo que desc_manual, generalizado a arrival_date/
   *  departure_date (bitácora 2026-07-29). gps_arrival_date/gps_departure_date
   *  ya no tienen override manual — son inamovibles (minuta 29/07 §4.2, fix
   *  2026-07-31), siempre de solo lectura en el frontend. */
  arrival_manual?:      boolean
  departure_manual?:    boolean
  /** Clasificación RM/Zona Cero resuelta en runtime contra public.locations
   *  por (nombre, N° de local) — null si no matchea ningún local del
   *  generador de carga (ver plan maestro H2.6). */
  operation_type?:     string | null
  /** ORIGIN (a lo sumo 1 por viaje, stop_order=0) o DESTINATION — origen
   *  unificado como parada 0 del mismo timeline (Fase 1 del hardening del
   *  Diario, 2026-07-18). Un viaje sin match de origen simplemente no trae
   *  ninguna fila ORIGIN en `stops` (no es un `null`, está ausente).
   *  Opcional en el tipo (el backend real siempre lo manda) para no romper
   *  fixtures de test anteriores a esta fase — toda la lógica que lo lee
   *  trata `undefined` igual que 'DESTINATION'. */
  stop_type?:          'ORIGIN' | 'DESTINATION'
  /** true en, a lo sumo, una parada del viaje — "dónde está el camión
   *  ahora", calculado en el backend (_mark_active_stop, trips.py). FIX
   *  2026-08-01: antes se recalculaba por separado en el frontend
   *  (lib/utils/temperature.ts y StopTimeline.tsx, con reglas
   *  ligeramente distintas) — bug real reportado en producción: para
   *  QAnalytics/Sodimac (~90% de los viajes), que nunca reportan la
   *  salida del origen, la parada activa quedaba pegada en el origen
   *  para siempre. Única fuente de verdad ahora. */
  is_active?:          boolean
  /** Clasificación de cumplimiento de cadena de frío DE ESTA PARADA
   *  (_annotate_stop_temp_status, trips.py — 2026-08-01, pedido explícito
   *  de operaciones). A diferencia de Trip.temp_status, nunca se apaga
   *  por cargo_delivered: una vez que la parada salió, su `temperature`
   *  queda congelada (trip_stops.sql) y es exactamente el dato que se
   *  quiere auditar por entrega. null = parada aún no visitada (su
   *  `temperature` todavía espeja la lectura en vivo del vehículo, no es
   *  su propio dato todavía) o sin cargo_type clasificable. */
  temp_status?:        'ok' | 'out_of_range' | null
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
  /** Valor crudo del TMS (sin resolver contra el vínculo manual) — permite
   *  detectar divergencia cuando ops vinculó a mano y el TMS reporta otro
   *  dato después. Ver reconciliación TMS↔manual, Fase 1.5b. */
  tractor_plate_tms:      string | null
  trailer_plate:          string | null
  driver_name:            string | null
  driver_name_tms:        string | null
  driver_tax_id:          string | null
  driver_phone:           string | null
  carrier_name:           string | null   // linked company (public.carriers.business_name) only
  carrier_name_tms:       string | null   // TMS-reported name (fleet->>'transporter_name_tms')
  /** Nombre del local de origen — computado desde la parada ORIGIN de
   *  `stops` (Fase 1 del hardening del Diario, 2026-07-18). Ya no es una
   *  columna propia de app.trips; se expone acá como conveniencia de
   *  lectura para no romper vistas que solo necesitan el nombre. Editar
   *  Carga Inicio/Fin ahora se hace vía la parada ORIGIN en `stops`
   *  (mismo mecanismo que Desc. Inicio/Fin de cualquier destino), no acá. */
  origin:                 string | null
  /** Ubicación complementaria asignada desde el Monitor (dropdown Chile) —
   *  el pipeline nunca la escribe */
  origin_region?:         string | null
  origin_city?:           string | null
  cargo_type:             string | null
  /** True cuando el camión ya salió de TODOS sus destinos (_cargo_delivered,
   *  trips.py) — no queda carga fría a bordo. QAnalytics reporta la
   *  temperatura como lectura EN VIVO del vehículo, no una foto histórica
   *  por parada, así que sigue "reportando algo" después de la última
   *  entrega — pero ya no es un posible incumplimiento de cadena de frío. */
  cargo_delivered:        boolean
  /** Clasificación de cumplimiento de cadena de frío, ya resuelta en el
   *  backend (_trip_temp_status, trips.py — 2026-08-01: movida del
   *  frontend acá, es una regla de negocio real, no de presentación).
   *  null = sin dato, sin cargo_type clasificable, o cargo_delivered=true. */
  temp_status:             'ok' | 'out_of_range' | null
  stops:                  TripStop[]
  is_active:              boolean
  is_working:             boolean
  is_assigned:            boolean
  is_first_leg:           boolean
  manual_status:          string | null
  notes:                  string | null
  comments:               string | null
  /** Motivo de no asignación (app.unassigned_reasons) — Fase 1.5d */
  unassigned_reason_id:   string | null
  fleet_link_id:          string | null
  carrier_id:             string | null
  driver_id:              string | null
  tractor_asset_id:       string | null
  trailer_asset_id:       string | null
  manually_edited_fields: string[]
  edited_at:              string | null
  edited_by:              string | null  // nombre/email ya resueltos por el backend, nunca un uuid
  updated_at:             string | null
  created_at:             string | null
  source_system_trip_id:  string | null
  milestone_status:       string | null  // trip-level, distinct from TripStop.milestone_status
  pipeline_updated_at:    string | null
  /** Clasificación RM/Zona Cero del origen — mismo mecanismo que
   *  TripStop.operation_type. Casi siempre null para orígenes tipo CD (no
   *  son locales de cliente, no están en el catálogo). */
  origin_operation_type?: string | null
  /** Nº de viaje del conductor ese día (1 = primero, 2 = segundo...),
   *  calculado en vivo por trips.py vía app.v_driver_daily_trip_legs — null
   *  si no hay driver_id explícito. Reemplaza a is_first_leg como fuente
   *  del filtro "2ª+ vuelta". */
  driver_leg_number?:      number | null
  /** HU-04 (Fase 0, 2026-07-21): MATCHED (default) | UNMATCHED (flota
   *  reportada sin poder cruzar con empresa) | MISMATCH (conductor y tracto
   *  calzan cada uno por su lado pero bajo empresas distintas — regla de
   *  Pablo: ambos deben pertenecer a la misma empresa de transporte). */
  fleet_match_status?:    'MATCHED' | 'UNMATCHED' | 'MISMATCH'
  /** Empresa propia del conductor cuando difiere de la empresa resuelta
   *  para el tracto (solo presente si fleet_match_status === 'MISMATCH') */
  fleet_match_driver_home_carrier?: string | null
  /** HU-12 (Fase 2, 2026-07-22): alerta de póliza del transportista resuelto
   *  para este viaje — regla del eslabón más débil sobre
   *  app.carrier_insurance_status (una empresa puede tener varias pólizas).
   *  null cuando no hay empresa resuelta o su cobertura está VALID. */
  insurance_alert?: 'EXPIRED' | 'OVERDUE_INSTALLMENTS' | 'EXPIRING_SOON' | null
  /** Cierre del gap detectado 2026-07-22: el Diario solo mostraba alerta de
   *  Seguros — la documentación LEGAL_MANDATORY de conductor/tracto/empresa
   *  (HU-08/09) nunca llegaba acá (el summary endpoint viejo que la
   *  alimentaba se borró en Checkpoint A-E). Consolidado, no tri-state: el
   *  100% del roster tiene al menos 1 documento pendiente hoy — un badge
   *  binario saturaría cada fila sin aportar señal. null cuando el dominio
   *  no tiene ID resuelto todavía (no confundir con "0 pendientes"). */
  driver_pending_docs?:            number | null
  /** true cuando el pendiente incluye Licencia de Conducir o Carnet — los
   *  "más críticos" según el usuario, distintos del resto de LEGAL_MANDATORY. */
  driver_pending_docs_critical?:   boolean | null
  tractor_pending_docs?:           number | null
  tractor_pending_docs_critical?:  boolean | null
  carrier_pending_docs?:           number | null
  carrier_pending_docs_critical?:  boolean | null
  /** Nota humana más reciente en la bitácora del viaje (excluye notas
   *  note_type='sistema') — usado para saber si una alerta activa ya tuvo
   *  seguimiento. Ver kpis.ts:needsBitacoraFollowup. */
  last_human_note_at?: string | null
}

// ── Catálogo de locales por generador de carga (public.locations, H2.6) ──

export type Location = {
  id:                  string
  entity_type:         'SHIPPER'
  entity_id:           string
  site_number:         string | null
  name:                string
  country_code:        string
  format:              string | null
  address:             string | null
  region_name:         string | null
  region_number:       number | null
  opens_at:            string | null
  closes_at:           string | null
  operation_type:      string | null
  operational_status:  'ACTIVE' | 'INACTIVE'
  /** Robustecer Tarifario (2026-07-27): true cuando la clasificación
   *  (operation_type) fue elegida a mano — el trigger de auto-registro de
   *  locales nunca la pisa en ese caso. */
  is_manual_override:  boolean
  created_at:          string | null
  updated_at:          string | null
  /** Solo presentes cuando se pide ?include_rate=true (Fase 5, Tarifario
   *  1.0) — tarifa vigente resuelta en el momento de la consulta
   *  (valid_from <= hoy <= valid_to, o valid_to NULL). */
  current_rate?:                string | null
  current_rate_valid_from?:     string | null
  current_rate_valid_to?:       string | null
}

// ── Tarifario (public.location_rates, Fase 5) ──────────────────────────────
// tarifa es texto libre a propósito, no numérico — depende de contexto de
// viaje que este proyecto no modela (ver docs/superpowers/specs/
// 2026-07-22-tarifario-design.md).

export type LocationRate = {
  id:          string
  location_id: string
  tarifa:      string
  valid_from:  string
  valid_to:    string | null
  created_at:  string | null
  updated_at:  string | null
}

export type LocationRateCreatePayload = {
  tarifa:      string
  valid_from?: string
  valid_to?:   string | null
}

export type LocationRatePatchPayload = Partial<LocationRateCreatePayload>

export type LocationCreatePayload = {
  entity_type:     'SHIPPER'
  entity_id:       string
  name:            string
  country_code?:   string
  site_number?:    string | null
  format?:         string | null
  address?:        string | null
  region_name?:    string | null
  region_number?:  number | null
  opens_at?:       string | null
  closes_at?:      string | null
  operation_type?: string | null
}

export type LocationPatchPayload = Partial<Omit<LocationCreatePayload, 'entity_type' | 'entity_id'>> & {
  operational_status?: 'ACTIVE' | 'INACTIVE'
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
  /** true = versión vigente (nunca reemplazada), no una entrada de audit_log */
  is_current:    boolean
}

/** Módulo Documentos (sábana) — GET /compliance-records/pending. Un
 *  compliance_record pendiente por fila, con la empresa/sujeto ya
 *  resueltos (cruza toda la flota en vez de navegar empresa por empresa). */
export type PendingComplianceRow = {
  id:                      string
  carrier_id:              string
  carrier_name:            string
  carrier_tax_id:          string
  /** Tipo de Operación (Tractoreo/Equipo Completo) agregado desde los
   *  vehículos activos de la empresa — puede traer ambos si la flota es
   *  mixta, no se fuerza un solo valor. */
  carrier_operation_types: string[]
  certification_type:      'BASICA' | 'ADICIONAL'
  category:                'EMPRESA' | 'CHOFER' | 'EQUIPO'
  entity_type:              EntityType
  entity_id:                string
  subject_name:              string | null
  requirement_code:          string
  document_name:              string
  status:                    ComplianceStatus
  expiration_date:            string | null
}

export type PendingComplianceListResponse = {
  total: number
  rows:  PendingComplianceRow[]
}

export type BulkUploadResult = {
  uploaded: { record_id: string; status: string; file_name: string; storage_path: string; mime_type: string; size_bytes: number }[]
  errors:   { record_id: string; file_name: string | null; error: string }[]
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
  pending_mandatory:     number
  compliance_health:     ComplianceHealth
}

export type CarrierAssetRosterItem = {
  id:                          string
  license_plate:               string
  asset_type:                  string
  operational_status:          OperationalStatus
  fleet_service_type_id:       string | null
  fleet_service_type_label:    string | null
  fleet_service_type_bg_color: string | null
  fleet_service_type_text_color: string | null
  total_requirements:          number | null
  last_document_update:        string | null
  pending_mandatory:           number
  compliance_health:           ComplianceHealth
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
  id:                          string
  license_plate:               string
  asset_type:                  string
  operational_status:          OperationalStatus
  manufacture_year:            number | null
  is_manual_override:          boolean
  created_at:                  string | null
  /** "Tipo Vehículo" — hoja Vehiculos_Equipos del SharePoint (columna nueva,
   *  distinta de asset_type/"Tipo de Equipo"), mismo catálogo FLEET_SERVICE_TYPE
   *  que HU §2.2 usa para clasificar el Cierre del Día. */
  fleet_service_type_id:        string | null
  fleet_service_type_label:     string | null
  fleet_service_type_bg_color:  string | null
  fleet_service_type_text_color: string | null
  total_requirements:          number | null
  last_document_update:        string | null
}

/** GET /assets/{id}/driver-assignment — conductor habitual asignado a este
 *  vehículo (Fase 1 del hardening del Diario, 2026-07-18). El Diario lo
 *  resuelve automáticamente para viajes nuevos que reporten esta patente,
 *  en vez de depender de un bootstrap histórico único (raw_bd_ot). */
export type VehicleDriverAssignment = {
  id:          string
  driver_id:   string
  driver_name: string
  start_date:  string
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
  endorsement_number:        string | null
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

// ── Cuadratura diaria (Fase 1, HU-01/02/03 — ver AGENTLOG.md) ───────────────
export type DriverDayStatusValue = 'ASSIGNED' | 'UNASSIGNED' | 'MISMATCH'

export type DriverDayStatusRow = {
  driver_id:                  string
  full_name:                  string
  tax_id:                     string | null
  /** Empresa activa del conductor — puede ser null si no tiene ninguna
   *  asignación ACTIVE (ej. recién dado de alta). Usado para linkear a
   *  "Revisar en Empresas" desde Cerrar el día. */
  carrier_id:                  string | null
  carrier_name:                string | null
  status:                     DriverDayStatusValue
  unassigned_reason_id:        string | null
  unassigned_reason_label:     string | null
  resolved_by:                 string | null
  resolved_at:                 string | null
  /** Cliente(s) servidos ese día (Fase 1.5) — denominador común de los 3
   *  reportes manuales hoy armados a mano (Sider/Lansa, Sodimac, Walmart). */
  client_names:                string[]
  /** Ronda 43: alerta de documentación vencida ya calculada — usada para
   *  sugerir un motivo en CloseDayDialog, no bloquea nada. */
  driver_pending_docs_critical: boolean | null
  suggested_reason_id:         string | null
  /** Viaje real que causó el MISMATCH ese día (Centro de Flota, 2026-07-28)
   *  — null para ASSIGNED/UNASSIGNED. Reemplaza el link genérico a Empresas
   *  en CloseDayDialog por un link directo al viaje. */
  trip_id:                     string | null
}

export type DailyClosureInfo = {
  closed_by:      string
  closed_at:      string
  total_drivers:  number
  resolved_count: number
  override_count: number
}

export type DailyClosureStatus = {
  business_date:    string
  closed:           boolean
  closure:          DailyClosureInfo | null
  total_drivers:    number
  assigned_count:   number
  unassigned_count: number
  mismatch_count:   number
  pending_count:    number
  drivers:          DriverDayStatusRow[]
}

export type CloseDayPending = {
  driver_id: string
  full_name: string
  status:    DriverDayStatusValue
}

// ── Reportería (spec 2026-07-21-cuadratura-reporteria-redesign-design.md) ──
// Fila plana por conductor×día — sin agregar, el pivot se arma en el cliente.
export type DailyClosureReportRow = Omit<
  DriverDayStatusRow, 'resolved_by' | 'resolved_at' | 'driver_pending_docs_critical' | 'suggested_reason_id' | 'trip_id'
> & {
  business_date: string
}

// ── Cierre del día por tracto/equipo (Fase 4, HU-03) — reemplaza al cierre
// por conductor de arriba como el flujo que usa la UI (docs/AGENTLOG.md). ──

export type EquipmentDayStatusValue = 'ASSIGNED' | 'UNASSIGNED'

export type EquipmentDayStatusRow = {
  asset_id:                string
  tractor_plate:           string
  carrier_id:              string | null
  carrier_name:            string | null
  /** "Tipo Vehículo" — hoja Vehiculos_Equipos del SharePoint, mismo campo
   *  que ya decide requires_motivo (ver abajo). null = sin clasificar. */
  fleet_service_type_label:      string | null
  fleet_service_type_bg_color:   string | null
  fleet_service_type_text_color: string | null
  status:                  EquipmentDayStatusValue
  /** true = Tractoreo o Sin clasificar (cierre activo, exige motivo);
   *  false = Equipo Completo puro (cierre pasivo, nunca bloquea). */
  requires_motivo:         boolean
  unassigned_reason_id:    string | null
  unassigned_reason_label: string | null
  resolved_by:             string | null
  resolved_at:             string | null
  driver_id:               string | null
  driver_name:              string | null
  /** Mejor esfuerzo — origen de su viaje más reciente, no un "CD habitual"
   *  real (ese dato no existe en el modelo hoy). null si nunca tuvo viaje. */
  last_known_origin:       string | null
}

export type EquipmentCategorySummary = {
  total:            number
  assigned:         number
  unassigned:       number
  utilization_pct:  number
}

export type EquipmentByCarrierSummary = {
  carrier_id:   string | null
  carrier_name: string | null
  enrolled:     number
  assigned:     number
  unassigned:   number
}

export type EquipmentClosureInfo = {
  closed_by:       string
  closed_at:       string
  total_equipment: number
  resolved_count:  number
  override_count:  number
}

export type EquipmentClosureStatus = {
  business_date: string
  closed:        boolean
  closure:       EquipmentClosureInfo | null
  tractoreo: {
    summary:       EquipmentCategorySummary
    equipment:     EquipmentDayStatusRow[]
    pending_count: number
  }
  equipos_completos: {
    summary:     EquipmentCategorySummary
    by_carrier:  EquipmentByCarrierSummary[]
  }
}

export type EquipmentClosePending = {
  asset_id:      string
  tractor_plate: string
}

export type DailyClosureReport = {
  fecha_desde: string
  fecha_hasta: string
  rows:        DailyClosureReportRow[]
}

// ── Reporte de estatus del día, 6 secciones (Fase 5, HU-04) ─────────────────

export type ZoneCrossTab = {
  cd: string
  carrier_name?: string
  RM: number
  Z0: number
  "Región": number
  "Sin clasificar": number
  total: number
}

export type MotivoCrossTab = {
  cd: string
  carrier_name?: string
  [motivo: string]: string | number | undefined
  total: number
}

export type EquipoCompletoResumen = {
  carrier_name:     string
  enrolled:         number
  assigned:         number
  unassigned:       number
  utilization_pct:  number
}

export type VueltaRow = {
  carrier_name: string
  cd_origen:    string | null
  tipo_destino: string | null
  vueltas:      number
}

export type StatusReport = {
  business_date: string
  client_filter: string | null
  section1_resumen: {
    total_equipos_activos: number
    tractoreo:              EquipmentCategorySummary
    equipos_completos:      EquipmentCategorySummary
    multi_dia_activos: { total: number; por_dias_atras: Record<string, number> }
  }
  section2_tractoreo_asignado: {
    por_cd:          ZoneCrossTab[]
    por_empresa_y_cd: ZoneCrossTab[]
  }
  section3_vueltas: VueltaRow[]
  section4_tractoreo_no_trabajando: {
    por_cd:           MotivoCrossTab[]
    por_empresa_y_cd: MotivoCrossTab[]
  }
  section5_equipos_completos: EquipoCompletoResumen[]
  section6_resumen_general: {
    tractoreo:          EquipmentCategorySummary
    equipos_completos:  EquipmentCategorySummary
    por_cd:      { cd: string; enrolled: number; assigned: number }[]
    por_cliente: { client_name: string; assigned: number }[]
  }
}
