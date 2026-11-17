import { createClient } from 'npm:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import { remitente, validarConfiguracion, type ConfiguracionEmail } from '../_shared/configuracion-email.ts'
import { generarConstancia, type EventoConstancia, type PersonaConstancia, type FirmaConstancia } from '../_shared/constancia.ts'
import { descargarFirma, tokenDrive } from '../_shared/firmas-drive.ts'
import { comprobarFirmas, validarFirmas } from '../_shared/firmas-seleccion.ts'

const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const smtpUser = Deno.env.get('SMTP_USERNAME'), smtpPassword = Deno.env.get('SMTP_PASSWORD')
  if (!url || !anon || !key || !origin || !smtpUser || !smtpPassword) { console.error('Acreditación: falta configuración de correo'); return json({ error: 'Servicio no disponible.' }, 503) }
  let token: string | null = null, personaId: number | null = null, iniciadoSmtp = false
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Sesión requerida.' }, 401)
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const who = await user.auth.getUser()
    if (who.error || !who.data.user) return json({ error: 'Sesión inválida.' }, 401)
    const role = await user.rpc('app_role')
    if (role.error) throw role.error
    if (role.data !== 'distrital') return json({ error: 'Sin permiso.' }, 403)
    const body = await req.json()
    if (typeof body.evento !== 'string' || !Number.isSafeInteger(body.persona) || body.persona <= 0) return json({ error: 'Solicitud inválida.' }, 400)
    let ids: number[] | null = null
    try { if (body.firmas !== undefined) ids = validarFirmas(body.firmas) }
    catch (e) { return json({ error: e instanceof Error ? e.message : 'Selección inválida.' }, 400) }
    personaId = body.persona
    const claim = await admin.rpc('acreditacion_iniciar_envio', { p_evento: body.evento, p_persona: personaId })
    if (claim.error) return json({ error: claim.error.message }, 409)
    token = claim.data as string
    const [ev, person, imgs, config] = await Promise.all([
      admin.from('acreditacion_eventos').select('nombre,lugar,fecha,hora_inicio,hora_fin').eq('id', body.evento).single(),
      admin.from('acreditacion_personas').select('nombre,email,cargo,escuela_id,escuela_externa').eq('id', personaId).eq('evento_id', body.evento).single(),
      admin.rpc('acreditacion_firmas_datos', { p_ids: ids }),
      admin.from('configuracion_email').select('salidas_destino,sistema_remitente,respuesta,nombre_remitente').eq('id', true).maybeSingle(),
    ])
    if (ev.error || person.error || imgs.error || config.error) throw new Error('No se pudieron cargar los datos de la constancia.')
    if (!imgs.data?.length) throw new Error('Configurá al menos una imagen de firma antes de enviar constancias.')
    if (ids) comprobarFirmas(ids, imgs.data)
    if (imgs.data.length > 6) throw new Error('Seleccioná entre una y seis firmas válidas.')
    const driveToken = imgs.data.some((f: { drive_file_id: string | null }) => f.drive_file_id) ? await tokenDrive() : null
    const firmas: FirmaConstancia[] = await Promise.all(imgs.data.map(async (f: { mime: string; base64: string | null; drive_file_id: string | null }) => ({
      mime: f.mime,
      base64: f.drive_file_id && driveToken ? await descargarFirma(driveToken, f.drive_file_id, f.mime) : f.base64!,
    })))
    let nombreEscuela = person.data.escuela_externa
    if (person.data.escuela_id != null) {
      const { data: escuela, error: errorEscuela } = await admin.from('escuelas').select('id,clave,tipo,numero,nombre,codigo,localidad').eq('id', person.data.escuela_id).single()
      if (errorEscuela || !escuela) throw new Error('No se pudo cargar la escuela del acreditado.')
      nombreEscuela = escuela.clave?.trim() || [escuela.tipo || escuela.codigo, escuela.numero, escuela.nombre, escuela.localidad ? `(${escuela.localidad})` : ''].filter(Boolean).join(' ') || `Escuela ${escuela.id}`
    }
    if (!nombreEscuela) throw new Error('La escuela del acreditado no tiene identificación.')
    const persona: PersonaConstancia = { nombre: person.data.nombre, cargo: person.data.cargo, escuela: nombreEscuela }
    const contenido = await generarConstancia(ev.data as EventoConstancia, persona, firmas)
    const configuracion = config.data as ConfiguracionEmail | null
    if (configuracion) validarConfiguracion(configuracion)
    const mailer = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: smtpUser, password: smtpPassword } } })
    try {
      iniciadoSmtp = true
      await mailer.send({
        from: configuracion ? remitente(configuracion) : `DataEscuela <${smtpUser}>`, to: person.data.email,
        ...(configuracion ? { replyTo: configuracion.respuesta } : {}),
        subject: 'Constancia de participación - Jefatura Distrital 3',
        content: 'Adjuntamos la constancia de participación. Jefatura Distrital 3 - La Matanza.',
        attachments: [{ filename: 'constancia.pdf', content: contenido, encoding: 'binary', contentType: 'application/pdf' }],
      })
      const resultado = await admin.rpc('acreditacion_finalizar_envio', { p_persona: personaId, p_token: token, p_estado: 'enviado' })
      if (resultado.error) throw resultado.error
      token = null
    } finally { try { await mailer.close() } catch (e) { console.error('SMTP cierre:', e) } }
    return json({ ok: true })
  } catch (e) {
    console.error('Envío de constancia:', e)
    if (token && personaId) {
      const result = await admin.rpc('acreditacion_finalizar_envio', { p_persona: personaId, p_token: token, p_estado: iniciadoSmtp ? 'incierto' : 'pendiente' })
      if (result.error) console.error('No se pudo actualizar estado de envío:', result.error.message)
    }
    const problema = e instanceof Error ? e.message : ''
    const previsto = ['Configurá al menos una imagen de firma antes de enviar constancias.', 'Los datos son demasiado extensos para la constancia A5.', 'Seleccioná entre una y seis firmas válidas.', 'Una firma seleccionada ya no está disponible. Actualizá la selección.', 'No se pudo leer una firma de Google Drive.', 'Google Drive no está configurado.', 'No se pudo conectar con Google Drive.'].includes(problema)
    return json({ error: iniciadoSmtp ? 'No se pudo confirmar el envío. El reintento podría duplicar el correo.' : previsto ? problema : 'No se pudo preparar la constancia. Revisá la configuración e intentá nuevamente.' }, 503)
  }
})
