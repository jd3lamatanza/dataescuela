import { createClient } from 'npm:@supabase/supabase-js@2'

const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key || !origin) { console.error('Acreditación: falta configuración'); return json({ error: 'Servicio no disponible.' }, 503) }
  try {
    const text = await req.text()
    if (text.length > 10000) return json({ error: 'Solicitud demasiado grande.' }, 413)
    const body = JSON.parse(text)
    if (typeof body.evento !== 'string' || !uuid.test(body.evento)) return json({ error: 'Evento inválido.' }, 400)
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    if (body.action === 'datos') {
      const { data: evento, error } = await db.from('acreditacion_eventos').select('id,nombre,lugar,fecha,hora_inicio,hora_fin,descripcion,estado').eq('id', body.evento).maybeSingle()
      if (error) throw error
      if (!evento) return json({ error: 'Evento inexistente.' }, 404)
      const escuelas = []
      if (evento.estado === 'activo') {
        for (let offset = 0; ; offset += 500) {
          const r = await db.from('escuelas').select('id,nombre,tipo,numero,codigo,localidad,eav').order('id').range(offset, offset + 499)
          if (r.error) throw r.error
          escuelas.push(...r.data)
          if (r.data.length < 500) break
        }
      }
      return json({ evento, escuelas })
    }
    if (body.action !== 'registrar' || !body.form || typeof body.form !== 'object') return json({ error: 'Solicitud inválida.' }, 400)
    const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
    const hmac = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const hash = [...new Uint8Array(await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(`acreditacion:${ip}`)))].map((v) => v.toString(16).padStart(2, '0')).join('')
    const limit = await db.rpc('eav_preinscripcion_permitir', { p_ip_hash: hash })
    if (limit.error) throw limit.error
    if (!limit.data) return json({ error: 'Demasiados intentos. Intentá nuevamente más tarde.' }, 429)
    const f = body.form
    const result = f.externa === true
      ? await db.rpc('acreditacion_registrar_externa', { p_evento: body.evento, p_nombre: f.nombre, p_dni: f.dni, p_cargo: f.cargo, p_escuela_externa: f.escuelaExterna, p_email: f.email })
      : await db.rpc('acreditacion_registrar', { p_evento: body.evento, p_nombre: f.nombre, p_dni: f.dni, p_cargo: f.cargo, p_escuela: f.escuela, p_email: f.email, p_publico: true })
    if (result.error) throw result.error
    if (result.data === 'duplicado') return json({ error: 'El DNI ya se encuentra acreditado en este evento.' }, 409)
    if (result.data === 'cerrado') return json({ error: 'La acreditación no está habilitada para este evento.' }, 409)
    if (result.data !== 'ok') return json({ error: 'Revisá los datos ingresados.' }, 400)
    return json({ ok: true }, 201)
  } catch (e) {
    console.error('Acreditación pública:', e instanceof Error ? e.message : e)
    return json({ error: 'No se pudo procesar la solicitud. Intentá nuevamente.' }, 503)
  }
})
