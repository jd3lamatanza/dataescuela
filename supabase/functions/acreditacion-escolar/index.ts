import { createClient } from 'npm:@supabase/supabase-js@2'
import { prepararConstancia } from '../_shared/acreditacion-documento.ts'

const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !key || !origin) return json({ error: 'Servicio no disponible.' }, 503)
  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Sesión requerida.' }, 401)
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const who = await user.auth.getUser()
    if (who.error || !who.data.user) return json({ error: 'Sesión inválida.' }, 401)
    const body = await req.json()
    if (typeof body.evento !== 'string' || !uuid.test(body.evento) || !Number.isSafeInteger(body.persona) || body.persona <= 0) return json({ error: 'Solicitud inválida.' }, 400)
    const permiso = await user.rpc('acreditacion_escolar_puede_ver', { p_persona: body.persona, p_evento: body.evento })
    if (permiso.error) throw permiso.error
    if (permiso.data !== true) return json({ error: 'Sin permiso para acceder a esta constancia.' }, 403)
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const { contenido } = await prepararConstancia(admin, body.evento, body.persona)
    return new Response(Uint8Array.from(contenido).buffer, { headers: { ...cors, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="constancia.pdf"' } })
  } catch (e) {
    console.error('Constancia escolar:', e instanceof Error ? e.message : e)
    const mensaje = e instanceof Error && e.message === 'La Distrital todavía no configuró las firmas de este evento.' ? e.message : 'No se pudo preparar la constancia.'
    return json({ error: mensaje }, 503)
  }
})
