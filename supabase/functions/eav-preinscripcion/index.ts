import { createClient } from 'npm:@supabase/supabase-js@2'

const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key || !origin) {
    console.error('EAV preinscripción: falta configuración')
    return json({ error: 'El servicio no está disponible.' }, 503)
  }
  try {
    const text = await req.text()
    if (text.length > 10000) return json({ error: 'Solicitud demasiado grande.' }, 413)
    const body = JSON.parse(text)
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    if (body.action === 'escuelas') {
      const escuelas: { id: number; nombre: string | null; tipo: string | null; numero: number | null; codigo: string | null; localidad: string | null; eav: string | null }[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await db.from('escuelas').select('id,nombre,tipo,numero,codigo,localidad,eav').order('id').range(offset, offset + 499)
        if (error) throw error
        escuelas.push(...data)
        if (data.length < 500) break
      }
      return json({ escuelas })
    }
    if (body.action !== 'enviar') return json({ error: 'Solicitud inválida.' }, 400)
    const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
    const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const hash = [...new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(ip)))].map((v) => v.toString(16).padStart(2, '0')).join('')
    const { data: permitido, error: limitError } = await db.rpc('eav_preinscripcion_permitir', { p_ip_hash: hash })
    if (limitError) throw limitError
    if (!permitido) return json({ error: 'Demasiados intentos. Intentá nuevamente más tarde.' }, 429)
    const f = body.form
    if (!f || typeof f !== 'object') return json({ error: 'Revisá los datos del formulario.' }, 400)
    const { data, error } = await db.rpc('eav_preinscribir', {
      p_escuela: f.escuela, p_dni: f.dni, p_nombre: f.nombre, p_nacimiento: f.nacimiento, p_genero: f.genero,
      p_actual: f.actual, p_otra: f.otra, p_domicilio: f.domicilio, p_responsable: f.responsable,
      p_vinculo: f.vinculo, p_telefono: f.telefono, p_email: f.email,
    })
    if (error) {
      console.error('EAV preinscripción RPC:', error.message)
      return json({ error: 'No se pudo procesar la preinscripción. Revisá los datos e intentá nuevamente.' }, 400)
    }
    if (data === 'duplicado') return json({ error: 'El DNI ya tiene una preinscripción para esta temporada.' }, 409)
    if (data === 'sin_cupo' || data === 'escuela') return json({ error: 'La escuela seleccionada no tiene cupos disponibles para preinscripción.' }, 409)
    if (data !== 'ok') return json({ error: 'Revisá los datos del formulario.' }, 400)
    return json({ ok: true }, 201)
  } catch (error) {
    console.error('EAV preinscripción:', error instanceof Error ? error.message : 'Error del servicio')
    return json({ error: 'El servicio no está disponible. Intentá nuevamente más tarde.' }, 503)
  }
})
