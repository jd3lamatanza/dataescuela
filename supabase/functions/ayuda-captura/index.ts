import { createClient } from 'npm:@supabase/supabase-js@2'
import { tokenDrive } from '../_shared/firmas-drive.ts'

const carpeta = '1HChSKnfT-wXedYF98-t08i5vFwCdx5m3'
const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'private, no-store', Vary: 'Origin' }
const json = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json('Método no permitido.', 405)
  try {
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !anon || !origin) return json('El servicio de ayuda no está configurado.', 503)
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json('Sesión requerida.', 401)
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const who = await user.auth.getUser()
    if (who.error || !who.data.user) return json('Sesión inválida.', 401)
    const [perfil, real, avanzado] = await Promise.all([user.rpc('mi_perfil'), user.rpc('real_role'), user.rpc('tiene_permiso_avanzado')])
    if (perfil.error || real.error || avanzado.error) return json('No se pudo verificar el acceso.', 503)
    if (!(perfil.data?.role === 'escolar' && ['escolar', 'distrital'].includes(real.data)) && avanzado.data !== true) return json('Sin permiso.', 403)
    let body: { captura?: unknown; imagen?: unknown }
    try { body = await req.json() } catch { return json('Solicitud inválida.', 400) }
    if (typeof body?.captura !== 'string' || !/^[a-z0-9-]{1,80}$/.test(body.captura)) return json('Captura inexistente.', 404)
    const guia = await user.from('ayuda_guias').select('captura_drive,secciones').eq('id', body.captura).maybeSingle()
    if (guia.error) throw new Error('No se pudo consultar la captura.')
    let id: unknown = guia.data?.captura_drive
    if (body.imagen !== undefined) {
      if (typeof body.imagen !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(body.imagen)) return json('Captura inexistente.', 404)
      const secciones = guia.data?.secciones
      const existe = Array.isArray(secciones) && secciones.some((s) => Array.isArray(s?.medios) && s.medios.some((m: { imagen_drive?: unknown } | null) => m?.imagen_drive === body.imagen))
      id = existe ? body.imagen : null
    }
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(id)) return json('Captura inexistente.', 404)
    const token = await tokenDrive()
    const headers = { Authorization: `Bearer ${token}` }
    const metadata = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=mimeType,parents,trashed,size`, { headers })
    if (!metadata.ok) throw new Error('No se pudo consultar la captura en Drive.')
    const file = await metadata.json()
    if (file.trashed || !['image/png', 'image/jpeg'].includes(file.mimeType) || !Array.isArray(file.parents) || !file.parents.includes(carpeta)
      || !Number.isSafeInteger(Number(file.size)) || Number(file.size) < 1 || Number(file.size) > 2 * 1024 * 1024) {
      throw new Error('La captura no está disponible en la carpeta de ayuda.')
    }
    const image = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers })
    if (!image.ok) throw new Error('No se pudo descargar la captura de Drive.')
    const bytes = new Uint8Array(await image.arrayBuffer())
    const firma = file.mimeType === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255]
    if (bytes.length !== Number(file.size) || firma.some((b, i) => bytes[i] !== b)) throw new Error('La imagen de Drive no es válida.')
    return new Response(bytes, { headers: { ...cors, 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    console.error('Captura de ayuda:', error instanceof Error ? error.message : String(error))
    return json('No se pudo cargar la captura. Intentá nuevamente.', 503)
  }
})
