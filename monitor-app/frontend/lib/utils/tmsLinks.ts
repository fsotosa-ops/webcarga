/** URLs públicas de login de cada TMS — NO son credenciales, solo el punto
 *  de entrada donde el gestor inicia sesión con su propia cuenta y busca el
 *  viaje a mano del otro lado. Nunca usar esto para ningún flujo
 *  autenticado/deep-link con la cuenta de servicio de extraction_service —
 *  esa cuenta es compartida (sin trazabilidad por usuario) y Sodimac además
 *  usa evasión de Cloudflare pensada para scraping, no sesiones humanas
 *  (decisión de seguridad explícita, Fase 2 del hardening del Diario). */
export const TMS_LOGIN_URLS: Record<string, string> = {
  qanalytics: 'https://www.qanalytics.cl/qnew/#',
  wingsuite:  'https://suite.wing.cl/web/core/inicio_sesion.php',
  sodimac:    'https://tms.falabella.supply/login',
}
