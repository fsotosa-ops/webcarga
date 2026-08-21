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
  /** Última corrida de esta TMS (el status_reported_at más reciente de todos
   *  sus viajes). null si la fuente todavía no tiene viajes. */
  last_run_at?: string | null
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

/** Cliente (shipper) con viajes reales en el Diario — dinámico, no el
 *  catálogo completo de public.shippers (bug 5.2, 2026-08-07). */
export type ClientMeta = {
  id:   string
  name: string
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
  /** Horas que una TMS puede seguir corriendo sin traer un viaje antes de que
   *  se marque como "Ya no está en el TMS" (Ronda 126). Configurable porque el
   *  criterio de negocio lo define operaciones — GitHub issue #3. */
  tms_dropped_hours:      number
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
  clients:             ClientMeta[]
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
  /** Nº de entrega de la parada. Una parada puede tener varias entregas al
   *  mismo local, por eso es un array. Opcional (no `null` obligatorio) por
   *  la misma razón que temp_status/desc_manual: hoy solo lo reporta IANSA,
   *  y las paradas manuales ni siquiera traen la clave. Lo usan Operaciones
   *  y Facturación. */
  delivery_numbers?:   string[] | null
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
  /** El TMS siguió corriendo sin traer este viaje (Ronda 126). Resuelto en el
   *  backend (_tms_dropped, trips.py) porque el umbral vive en la base.
   *  Distinto de la señal `stale`: ésta compara contra la última corrida de
   *  la propia TMS, no contra ahora, así que no se enciende cuando el que
   *  está caído es nuestro scraper. Sólo viajes abiertos. */
  tms_dropped?:           boolean
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
  /** Vínculo resuelto (`vfr.resolved_driver_id`). **Es la única señal fiable**
   *  de si hay conductor identificado: `driver_name` sale de un COALESCE que
   *  cae al nombre del TMS cuando no hay vínculo, así que nunca es null si el
   *  TMS reportó algo. Ver `CeldaConductor`. */
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
/** Solo para filas a nivel EMPRESA (Carrier/CarrierListItem/
 *  CarrierInsuranceOverviewItem) — conductores/equipos no tienen concepto
 *  de onboarding, siguen tipando contra OperationalStatus. Una empresa
 *  creada sin tax_id queda en ONBOARDING (POST /carriers, tarea backend
 *  previa) hasta completar el RUT. */
export type CarrierOperationalStatus = OperationalStatus | 'ONBOARDING'
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
  /** Qué hace el requisito con la fecha de vencimiento. Opcional porque el
   *  backend lo agregó después: frontend y API se despliegan por separado, así
   *  que la ventana en que no viene es real y dura minutos. Ausente significa
   *  "no sé" — se pregunta la fecha sin exigirla. */
  expiration_policy?: PoliticaVencimiento
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
/** Qué hace el sistema con la fecha de vencimiento de un requisito.
 *
 *  Reemplaza a `has_expiration`, que era un booleano cargando estos tres
 *  significados en dos valores — y por eso `classify-batch` trataba "tiene
 *  vencimiento" como "el vencimiento es obligatorio", rechazando con 422 la
 *  carga de 19 de los 35 requisitos activos sin que la pantalla pidiera nunca
 *  la fecha. */
export type PoliticaVencimiento = 'REQUIRED' | 'OPTIONAL' | 'NONE'

/** Por qué un requisito cuenta como pendiente, o si no cuenta. Excluyentes y
 *  exhaustivos: 'VENCIDO' ya pasó su fecha, 'POR_VENCER' la pasa dentro de 30
 *  días, 'FALTA' no tiene documento, 'AL_DIA' está cubierto y sin problema de
 *  fecha. Antes de la Ronda 129 'POR_VENCER' no existía y renovar no tenía
 *  superficie en ninguna pantalla. 'AL_DIA' se sumó en la ronda de arreglo 1
 *  de la ficha de empresa (Task 4): con `estado='falta'` (el default de
 *  siempre) el backend nunca devolvía una fila cubierta, así que el valor no
 *  hacía falta; con `estado='todos'` sí, y sin él una fila al día salía
 *  'FALTA' igual que una que de verdad falta — un valor cargando dos
 *  sentidos, la misma clase de bug que este módulo ya tuvo cinco veces. */
export type Urgencia = 'VENCIDO' | 'POR_VENCER' | 'FALTA' | 'AL_DIA'

/** Qué mostrar de la documentación de una empresa. `falta` es el default del
 *  backend y reproduce el comportamiento anterior a la ficha. */
export type EstadoDocumental = 'todos' | 'falta' | 'por_vencer' | 'al_dia'

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
  requirement_id:            string
  requirement_code:          string
  document_name:              string
  status:                    ComplianceStatus
  expiration_date:            string | null
  /** Si hay un archivo cargado. Es un hecho (`file_url IS NOT NULL`), no una
   *  lectura de `status`: `MISSING`/`EXPIRED` se venía usando como si
   *  significara "no tiene archivo", y un `EXPIRED` sí lo tiene —venció
   *  porque alguien lo subió—, así que la ficha escondía el documento
   *  cargado de todo lo vencido. */
  tiene_archivo:              boolean
  /** Por qué esta fila está pendiente. Lo resuelve el SQL, no el cliente:
   *  recalcularlo comparando fechas acá es como dos superficies del mismo
   *  dato terminan discrepando. */
  urgencia:                   Urgencia
  /** Qué exige su requisito. El renglón lo necesita para pedir la fecha
   *  ANTES de subir; sin él pregunta siempre o no pregunta nunca, y no
   *  preguntar nunca es un 422 con el archivo ya subido. */
  expiration_policy:          PoliticaVencimiento
}

export type PendingComplianceListResponse = {
  total: number
  rows:  PendingComplianceRow[]
}

/** Las cuatro cifras, ya particionadas por `urgencia`: `al_dia + por_vencer +
 *  falta === todos` siempre (`falta` agrupa VENCIDO y FALTA, las dos ramas
 *  que la ficha ya mostraba juntas — ver `avanceDelSujeto`). Las calcula el
 *  servidor agrupando sobre las filas que trajo la CTE — que SÍ puede venir
 *  truncada (`SUMMARY_LIMIT` entra como su LIMIT, antes del GROUP BY): ver
 *  `ComplianceSummaryResponse.completo`, la guarda que reemplaza a la
 *  `completa` que tenía `PendingComplianceRow` (hallazgo 3 de la revisión
 *  final de perf/compresion-y-resumen — este comentario decía "el resumen
 *  nunca viene truncado", y era falso). */
export type ComplianceSummaryCounts = {
  todos:      number
  al_dia:     number
  por_vencer: number
  falta:      number
}

/** Los dos tipos que existen de verdad. CAMION, FURGON y OTRO eran
 *  placeholders del commit 5955c5f (Empresas/Seguros), anteriores a la
 *  taxonomía real de vehículos —migraciones 20260802–20260804— y nunca
 *  describieron el negocio: cero de los 124 vehículos los usa. El subtipo
 *  fino vive en fleet_service_type_id, que es un catálogo de 10 valores.
 *
 *  Vive acá y no en `lib/api/assets.ts` porque ese archivo ya importa de
 *  este: al revés sería un ciclo. `assets.ts` lo re-exporta, así que los
 *  llamadores que ya lo pedían de ahí siguen funcionando. */
export type AssetType = 'TRACTOCAMION' | 'RAMPLA'

/** Cómo se escribe cada chasis en pantalla. Una sola vez: la misma tabla
 *  estaba copiada en tres componentes, y una etiqueta que se corrige en uno
 *  y no en los otros no rompe nada — sólo hace que la misma flota se llame
 *  distinto según la pantalla. */
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  TRACTOCAMION: 'Tracto',
  RAMPLA:       'Rampla',
}

/** Una cabecera de la ficha de empresa: la empresa misma, o uno de sus
 *  conductores o vehículos, con sus cuatro cifras — sin las filas de
 *  detalle. Esas se piden aparte, sólo al desplegar el sujeto
 *  (`complianceApi.listPending({ entityId })`). */
export type ComplianceSummarySubject = ComplianceSummaryCounts & {
  entity_type:  EntityType
  entity_id:    string
  subject_name: string | null
  /** Qué ES el vehículo. `asset_type` es el chasis y lo tienen los 124
   *  vehículos; `fleet_service_type_*` es el subtipo de carrocería y sólo lo
   *  llevan las ramplas (los tractocamiones lo traen en `null`). Nulos los
   *  cuatro para CARRIER y DRIVER: no es "desconocido", es que la pregunta no
   *  aplica. Se dibuja un badge por campo presente — mismo criterio y mismo
   *  marcado que `VehicleRosterCard`. */
  asset_type:                    AssetType | null
  fleet_service_type_label:      string | null
  fleet_service_type_bg_color:   string | null
  fleet_service_type_text_color: string | null
}

/** GET /compliance-records/summary — lo que la ficha de empresa pide al
 *  llegar. Reemplaza el fetch de 457 filas de detalle que se hacía solo para
 *  dibujar nueve cabeceras plegadas con sus conteos (medido en dev: 57.183
 *  bytes en la primera carga). */
export type ComplianceSummaryResponse = {
  totales: ComplianceSummaryCounts
  sujetos: ComplianceSummarySubject[]
  /** `false` si `SUMMARY_LIMIT` cortó la CTE del backend antes de agrupar:
   *  `totales` y las cifras de cada sujeto se calcularon sobre una lista
   *  recortada. La pantalla no muestra esas cifras cuando esto es `false`
   *  —igual que hacía la guarda `completa` que existía antes de este
   *  endpoint—, en vez de mostrar un número que podría estar mal. */
  completo: boolean
  /** Tipo de Operación (Tractoreo/Equipo Completo) agregado de la flota
   *  activa de la empresa. Escalar, no fila de detalle: por eso viaja acá y
   *  no obliga a desplegar el sujeto CARRIER para conocerlo. */
  carrier_operation_types: string[]
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
  operational_status:    CarrierOperationalStatus
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
  operational_status:  CarrierOperationalStatus
  /** Gestión DECLARADA en el alta. La flota manda cuando existe; esto cubre a
   *  la empresa sin vehículos y preselecciona la gestión del primero. */
  management_types:    ManagementType[] | null
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

/** Tarea 8 (plan 3.1, minuta 2026-08-03) — GET /carriers/fleet-driver-gap,
 *  inconsistencias de dotación tracto/conductor, solo empresas con
 *  desbalance (gap != 0). */
export type FleetDriverGapRow = {
  carrier_id:     string
  business_name:  string
  n_tractos:      number
  n_conductores:  number
  gap:            number
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
  operational_status:          CarrierOperationalStatus
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
  /** Tarea 5 (plan 2.2) — tracto habitual del conductor, mejor esfuerzo vía
   *  el viaje más reciente resuelto para él; puede ser null si no tiene
   *  ninguno. */
  last_known_tractor_plate:    string | null
  /** Tipo de operación (Tractoreo/Equipo Completo) de ESE tracto puntual —
   *  no el del roster de la empresa, que puede operar ambos tipos. */
  last_known_operation_type:   string | null
}

export type DailyClosureInfo = {
  closed_by:      string
  closed_at:      string
  total_drivers:  number
  resolved_count: number
  override_count: number
}

/** HU-02 (pre-cierre) — Tarea 12 (plan 1.3): corre siempre antes de
 *  recalcular la cuadratura/cierre de equipos, viene en el payload de
 *  GET /daily-closures y GET /equipment-closures desde que HU-02 se
 *  implementó, pero sin UI propia hasta esta tarea. */
export type PreCierreAutoResolved = {
  type:    string
  message: string
}
export type PreCierreEscalations = {
  PATENTE_NO_REGISTRADA:   { tractor_plate: string; reason: string }[]
  EMPRESA_NO_RECONOCIDA:   { tractor_plate: string; tms_carrier_name: string; directory_carrier_name: string }[]
  CONDUCTOR_NO_REGISTRADO: { driver_rut: string }[]
  EMPRESA_ONBOARDING:      { carrier_id: string; carrier_name: string }[]
  SIN_TIPO_OPERACION:      { carrier_id: string; carrier_name: string }[]
}
export type PreCierreResult = {
  auto_resolved: PreCierreAutoResolved[]
  escalations:   PreCierreEscalations
}

/** Tarea 7 (plan cierre-paso-viajes): el delta de viajes que llegaron
 *  después de firmar el día. El día no se reabre — la firma sigue siendo
 *  verdadera sobre `total_trips_al_firmar`; `posteriores_al_cierre` es lo
 *  que se sumó después, sin invalidar la firma original. */
export type CierrePosteriorInfo = {
  total_trips_al_firmar: number | null
  posteriores_al_cierre: number
}

export type DailyClosureStatus = {
  business_date:    string
  closed:           boolean
  closure:          DailyClosureInfo | null
  /** Opcional en el tipo porque son varios los fixtures de test que arman
   *  este objeto a mano y no les concierne — el backend real siempre lo
   *  manda (ver `daily_closures.py::get_daily_closure_status`). */
  cierre?:          CierrePosteriorInfo
  total_drivers:    number
  assigned_count:   number
  unassigned_count: number
  mismatch_count:   number
  pending_count:    number
  drivers:          DriverDayStatusRow[]
  pre_cierre:       PreCierreResult
}

export type CloseDayPending = {
  driver_id: string
  full_name: string
  status:    DriverDayStatusValue
}

// ── Reportería (spec 2026-07-21-cuadratura-reporteria-redesign-design.md) ──
// Fila plana por conductor×día — sin agregar, el pivot se arma en el cliente.
export type DailyClosureReportRow = Omit<
  DriverDayStatusRow,
  | 'resolved_by' | 'resolved_at' | 'driver_pending_docs_critical' | 'suggested_reason_id' | 'trip_id'
  // Tarea 7 (plan 2.4): _REPORT_SQL (backend) no trae estos 2 campos —
  // solo _DETAIL_SQL (GET /daily-closures) los expone.
  | 'last_known_tractor_plate' | 'last_known_operation_type'
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
  /** Viaje de HOY, si el equipo está ASSIGNED — paridad con Tractoreo
   *  (2026-08-04), necesario para "Ver viaje" en Flota del día. */
  trip_id:                 string | null
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
    /** Fila plana por equipo — paridad con tractoreo.equipment (2026-08-04),
     *  la usa Flota del día para la vista Equipo Completo. */
    equipment:   EquipmentDayStatusRow[]
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

// ── Cierre del Día, paso "Viajes" (Tarea 6) ─────────────────────────────────

/** Un viaje en el paso "Viajes" del Cierre. `dias_sin_novedad` cuenta desde el
 *  último reporte del TMS, NO desde la planificación: un viaje planificado hace
 *  9 días puede haber reportado hace 2 horas, y a los 7 sin novedad desaparece
 *  del Monitor — que es exactamente cuando empieza a importar. */
export type ViajeDelCierre = {
  trip_id:                 string
  planning_date:           string
  client_name:             string | null
  source_system_trip_id:   string | null
  trip_status:             string | null
  dias_sin_novedad:        number
  unassigned_reason_id:    string | null
  unassigned_reason_label: string | null
}

export type GrupoDelCierre = 'hoy' | 'rezago' | 'en_curso' | 'abandonado'

export type CierreViajesResponse = {
  grupos:   Record<GrupoDelCierre, ViajeDelCierre[]>
  /** Cuántos impiden firmar el día: sólo `hoy` + `rezago`. */
  bloquean: number
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

/** Tabla Empresa/Enrolados/Asignados/No asignados/% utilización — mismo
 *  shape para Tractoreo y Equipo Completo (paridad pedida por el usuario
 *  2026-08-04: la tab "por empresa" solo existía para Equipo Completo). */
export type CarrierUtilizationRow = {
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

/** Tarea 6 (plan 2.3) — fila plana por conductor Tractoreo no trabajando,
 *  con el tipo de operación de su tracto habitual (puede diferir del
 *  roster, que se arma a nivel empresa). El backend ya la devuelve desde
 *  esa tarea, sin tipo en el frontend hasta la Tarea 14. */
export type DriverDetailRow = {
  driver_id:                 string
  full_name:                 string
  carrier_name:               string | null
  cd_origen:                  string | null
  unassigned_reason_label:    string | null
  tractor_plate:               string | null
  operation_type:              string | null
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
    driver_detail:    DriverDetailRow[]
  }
  section_tractoreo_por_empresa: CarrierUtilizationRow[]
  section5_equipos_completos: CarrierUtilizationRow[]
  section6_resumen_general: {
    tractoreo:          EquipmentCategorySummary
    equipos_completos:  EquipmentCategorySummary
    por_cd:      { cd: string; enrolled: number; assigned: number }[]
    por_cliente: { client_name: string; assigned: number }[]
  }
}

// ── Bandeja de documentos sin clasificar (HU-01) ──────────────────────────
// Un item es un archivo ya subido que todavia no pertenece a ningun
// compliance_record. Los campos de match quedan vacios en esta etapa: son los
// que llenara el agente de clasificacion automatica cuando llegue.

export type IngestMatchStatus =
  | 'AUTO' | 'SUGGESTED' | 'AMBIGUOUS' | 'UNMATCHED' | 'COMMITTED' | 'DISCARDED'

export type TrayItem = {
  id:           string
  file_name:    string
  mime_type:    string | null
  size_bytes:   number | null
  storage_path: string
  match_status: IngestMatchStatus
  preview_url:  string | null
}

/** Fila de la cola global de sin clasificar.
 *
 *  `carrier_name` viene del servidor porque la cola mezcla empresas y la tabla
 *  se agrupa por ese valor. Los campos de sugerencia hoy llegan vacios: los
 *  llena el agente de clasificacion cuando exista, sobre este mismo contrato.
 *
 *  No trae `preview_url`: se pide con `previewUrl(id)` al enfocar el archivo. */
export type QueueRow = {
  id:                         string
  file_name:                  string
  mime_type:                  string | null
  size_bytes:                 number | null
  storage_path:               string
  match_status:               IngestMatchStatus
  created_at:                 string
  carrier_id:                 string | null
  carrier_name:               string | null
  confidence:                 number | null
  suggested_requirement_name: string | null
  candidate_count:            number
  /** Cuántos items pendientes comparten este destino / este contenido,
   *  incluyéndose a sí mismo. 1 = sin colisión. Dos señales distintas aunque
   *  compartan forma: mismo contenido -> "este archivo ya está en la cola,
   *  borra uno"; mismo destino -> "dos archivos distintos reclaman el
   *  casillero, elige cuál". */
  mismo_casillero:            number
  /** `null` = NO SE SABE: el item entró sin `content_sha256`, así que no hay
   *  con qué compararlo. No es 1 ("no está duplicado"); un valor con dos
   *  sentidos fue el defecto que este módulo ya tuvo cinco veces, y acá la
   *  pantalla se calla en vez de afirmar que no hay colisión. */
  mismo_contenido:            number | null
  /** El requisito destino YA tiene un archivo vigente (mira
   *  `compliance_records`, no la cola). Confirmar este item lo reemplaza.
   *  Distinta de `mismo_casillero`: esa señal sólo ve items que siguen sin
   *  clasificar, y el ocupante de este casillero ya salió de la cola porque
   *  fue confirmado. */
  casillero_ocupado:          boolean
}

export type TrayPage = { total: number; rows: QueueRow[] }

export type CertificationGroup = 'carrier' | 'driver' | 'asset' | 'requirement'

/** Las dos mitades del catálogo de empresas, disjuntas y exhaustivas: `active`
 *  son las operativas más cualquiera con documentos esperando, y `catalog` es
 *  exactamente su complemento. Se piden por separado porque juntas no caben en
 *  el límite, y el catálogo va plegado. */
export type CertificationScope = 'active' | 'catalog'

/** Las etapas del embudo (spec §4). Las decide el backend en SQL, de una sola
 *  definición: calcularlas acá obligaría a repetir el criterio en el conteo del
 *  encabezado y en el orden. */
export type FunnelGroup =
  | 'sin_documentos'
  | 'en_proceso'
  | 'renovar'
  | 'al_dia'
  | 'catalogo'

/** Códigos del tipo de gestión. La API habla códigos y no las etiquetas del
 *  catálogo, que se renombraron dos veces en dos días. */
export type ManagementType = 'TRACTOREO' | 'EQUIPO_COMPLETO'

/** Fila del módulo Certificación, agrupada por empresa, conductor, vehículo o
 *  requisito.
 *
 *  `carrier_*` viaja siempre salvo agrupando por requisito, que cruza todas las
 *  empresas: un conductor o un vehículo sin la empresa a la que pertenece no
 *  dice nada. Agrupando por empresa, la entidad y la empresa son la misma.
 *
 *  Los cuatro campos del embudo llegan **sólo** agrupando por empresa: un
 *  conductor no tiene etapa de certificación propia. */
export type CertificationStatusRow = {
  entity_id:          string
  entity_name:        string
  carrier_id:         string | null
  carrier_name:       string | null
  operational_status: string | null
  total_count:        number
  satisfied_count:    number
  pending_count:      number
  pending_mandatory:  number
  unclassified_count: number
  expired_count?:     number
  management_types?:  ManagementType[] | null
  trips_30d?:         number
  funnel_group?:      FunnelGroup
}

export type CertificationStatus = {
  total_pending:      number
  total_unclassified: number
  rows:               CertificationStatusRow[]
}

export type IngestUploadResult = {
  batch_id: string
  items:    TrayItem[]
  errors:   { file_name: string; error: string }[]
}

/** A cuántas entidades alcanza la condición de un requisito, sobre el
 *  universo de su tipo de entidad: "36 de 118 vehículos". Los dos números
 *  viajan juntos porque separados no dicen nada — "36" sin el universo no
 *  distingue una regla acotada de una general.
 *
 *  `alcanzadas` cuenta la CONDICIÓN, no la vigencia: una regla apagada sigue
 *  diciendo a cuántos alcanzaría si se encendiera. */
export interface Alcance {
  alcanzadas: number
  universo:   number
}

export type RequirementOption = {
  id:                string
  target_entity:     'CARRIER' | 'DRIVER' | 'ASSET'
  requirement_code:  string
  name:              string
  requirement_level: 'LEGAL_MANDATORY' | 'SHIPPER_REQUIRED' | 'CONDITIONAL_OPTIONAL'
  has_expiration:    boolean
  /** Qué hace el sistema con la fecha de vencimiento. Es la fuente de verdad;
   *  `has_expiration` sigue viajando por sus lectores vivos, pero es el
   *  booleano de dos valores que cargaba estos tres significados. */
  expiration_policy: PoliticaVencimiento
  /** Tramo 3: la regla de a quién se le exige este documento es dato del
   *  catálogo, no código. `null` en los dos `applies_to_*` significa "sin
   *  restricción" (aplica a todos), no "no cargado". */
  is_active:                         boolean
  applies_to_fleet_service_type_ids: string[] | null
  applies_to_management_types:       ManagementType[] | null
  /** A cuántas entidades alcanza la regla, sobre el universo de su entidad.
   *  Sin esto la frase de la condición no dice si son veinte vehículos o dos. */
  alcance:                           Alcance
}

/** La condición de un requisito, sin lo que no hace falta para editarla: un
 *  subconjunto de `RequirementOption` sin `requirement_level` ni
 *  `has_expiration`. Es la forma que viaja en `PATCH /conditions`
 *  (`lib/api/requirements.ts`); el panel que le daba nombre
 *  —`RequirementConditionsPanel`— ya no existe, lo reemplazó `CondicionPanel`,
 *  que dibuja desde `RequirementOption` completo. */
export type RequirementConditions = Pick<RequirementOption,
  'id' | 'requirement_code' | 'name' | 'target_entity' |
  'is_active' | 'applies_to_fleet_service_type_ids' | 'applies_to_management_types'>

/** `PATCH /conditions` devuelve solo las columnas de su propio `RETURNING`
 *  (ver `app/routers/requirements.py`) — NO el `name` ni el `target_entity`.
 *  Tiparlo como `RequirementConditions` completo sería mentir sobre lo que
 *  realmente vuelve del backend. */
export type RequirementConditionsPatchResult = Pick<RequirementConditions,
  'id' | 'requirement_code' | 'is_active' |
  'applies_to_fleet_service_type_ids' | 'applies_to_management_types'>

export type RecalcPreview = {
  crear:      number
  quitar:     number
  bloqueados: number
}

export type RecalcResult = {
  creados:    number
  quitados:   number
  bloqueados: number
}


/** Candidato a ser la persona que el TMS nombra así — GET /trips/driver-candidates.
 *  `contiene` (todas las palabras del TMS están en este nombre, o al revés) es
 *  la señal que decide; `similitud` sólo desempata y NUNCA debe usarse como
 *  umbral: sobre los casos de identidad segura cae a 0,40 por nombres
 *  incompletos. */
export type CandidatoConductor = {
  driver_id:    string
  full_name:    string
  tax_id:       string | null
  carrier_name: string | null
  contiene:     boolean
  similitud:    number
}

/** Respuesta de GET /trips/driver-candidates.
 *
 *  `trip_ids_de_la_persona` son los viajes REALES sin identificar de ese mismo
 *  nombre en los últimos 30 días. Vienen del backend a propósito: el popover
 *  ofrece "aplicar a sus N viajes" y varios de esos no están en pantalla —
 *  contar en el cliente lo que la tabla tiene cargado sería prometer un
 *  alcance y aplicar otro. */
export type CandidatosConductorResponse = {
  candidatos:             CandidatoConductor[]
  trip_ids_de_la_persona: string[]
}
