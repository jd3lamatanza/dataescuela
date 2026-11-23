import { createClient } from 'npm:@supabase/supabase-js@2'
import { tokenDrive } from '../_shared/firmas-drive.ts'

const ROOT = '1Imi-ooGaTXEXscXuNHlxdytnGIxEOwFs'
const ORIGIN = (() => { try { return new URL(Deno.env.get('APP_PUBLIC_URL') ?? '').origin } catch { return '' } })()
const CORS = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'X-Image-Type', 'Cache-Control': 'private, no-store', Vary: 'Origin' }
const json = (body: object, status = 200) => Response.json(body, { status, headers: CORS })
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const driveId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(v)
const headers = (token: string) => ({ Authorization: `Bearer ${token}` })
const validImage = (bytes: Uint8Array, mime: string) => {
  const magic = mime === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : mime === 'image/jpeg' ? [255, 216, 255] : []
  return magic.length > 0 && bytes.length <= 2097152 && magic.every((v, i) => bytes[i] === v)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Sesión requerida.')
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !service || !ORIGIN) throw new HttpError(503, 'El servicio de reportes no está configurado.')
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
    const who = await user.auth.getUser()
    if (who.error || !who.data.user) throw new HttpError(401, 'Sesión inválida.')
    const perfil = await user.rpc('mi_perfil')
    if (perfil.error || !perfil.data?.active || !uuid(perfil.data.id)) throw new HttpError(403, 'Perfil no disponible.')
    const multipart = (req.headers.get('Content-Type') ?? '').toLowerCase().startsWith('multipart/form-data')
    let form: FormData | null = null
    let body: Record<string, unknown> = {}
    try { if (multipart) form = await req.formData(); else body = await req.json() } catch { throw new HttpError(400, 'Solicitud inválida.') }
    const action = form ? form.get('action') : body.action
    if (action === 'upload') {
      if (!form) throw new HttpError(400, 'Falta la captura.')
      const id = form.get('id'), modulo = form.get('modulo'), pagina = form.get('url'), descripcion = form.get('descripcion'), archivo = form.get('archivo')
      if (!uuid(id) || typeof modulo !== 'string' || !modulo.trim() || modulo.trim().length > 150
        || typeof pagina !== 'string' || pagina.length > 2048 || typeof descripcion !== 'string'
        || !descripcion.trim() || descripcion.trim().length > 4000 || !(archivo instanceof File)
        || archivo.size < 1 || archivo.size > 2097152) throw new HttpError(400, 'Completá la descripción y adjuntá una imagen de hasta 2 MB.')
      let paginaUrl: URL
      try { paginaUrl = new URL(pagina) } catch { throw new HttpError(400, 'La URL del reporte no es válida.') }
      if (paginaUrl.origin !== ORIGIN || paginaUrl.username || paginaUrl.password) throw new HttpError(400, 'La URL del reporte no pertenece a la aplicación.')
      const bytes = new Uint8Array(await archivo.arrayBuffer())
      if (!validImage(bytes, archivo.type)) throw new HttpError(400, 'La captura debe ser PNG o JPEG de hasta 2 MB.')
      const anterior = await admin.from('reportes_error').select('id,user_id,actor_id').eq('id', id).maybeSingle()
      if (anterior.error) throw new Error('No se pudo verificar el reporte.')
      if (anterior.data) {
        if (anterior.data.actor_id !== who.data.user.id || anterior.data.user_id !== perfil.data.id) throw new HttpError(403, 'Reporte no disponible.')
        return json({ ok: true, id })
      }
      const token = await tokenDrive()
      const carpeta = await fetch(`https://www.googleapis.com/drive/v3/files/${ROOT}?supportsAllDrives=true&fields=mimeType,capabilities(canAddChildren)`, { headers: headers(token) })
      if (!carpeta.ok) throw new Error('No se puede acceder a la carpeta de reportes de Google Drive.')
      const acceso = await carpeta.json()
      if (acceso.mimeType !== 'application/vnd.google-apps.folder' || !acceso.capabilities?.canAddChildren) {
        throw new Error('La cuenta de Google Drive no puede agregar capturas a la carpeta de reportes.')
      }
      const boundary = `reporte_${crypto.randomUUID().replaceAll('-', '')}`
      const inicio = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: `reporte-${id}.${archivo.type === 'image/png' ? 'png' : 'jpg'}`, parents: [ROOT], appProperties: { dataescuela_reporte: id } })}\r\n--${boundary}\r\nContent-Type: ${archivo.type}\r\n\r\n`)
      const fin = new TextEncoder().encode(`\r\n--${boundary}--`)
      let subida: Response
      try {
        subida = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
          method: 'POST', headers: { ...headers(token), 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: new Blob([inicio, bytes, fin]),
        })
      } catch { throw new Error('No se pudo confirmar la carga en Drive. Consultá a soporte antes de reintentar.') }
      if (!subida.ok) throw new Error('No se pudo guardar la captura en Drive.')
      let fileId: unknown
      try { fileId = (await subida.json()).id } catch { throw new Error('Drive no confirmó la captura. Consultá a soporte antes de reintentar.') }
      if (!driveId(fileId)) throw new Error('Drive no confirmó la captura. Consultá a soporte antes de reintentar.')
      const guardado = await admin.rpc('reporte_error_registrar', {
        p_id: id, p_actor: who.data.user.id, p_user: perfil.data.id, p_modulo: modulo, p_url: pagina,
        p_descripcion: descripcion, p_file: fileId, p_mime: archivo.type, p_bytes: bytes.length,
      })
      if (guardado.error) {
        const consulta = await admin.from('reportes_error').select('id,user_id,actor_id,drive_file_id').eq('id', id).maybeSingle()
        if (consulta.error) throw new Error('No se pudo confirmar el registro. Consultá el listado antes de reintentar.')
        if (consulta.data?.drive_file_id === fileId && consulta.data.actor_id === who.data.user.id && consulta.data.user_id === perfil.data.id) return json({ ok: true, id })
        const limpieza = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: 'DELETE', headers: headers(token) })
        if (!limpieza.ok && limpieza.status !== 404) throw new Error('No se pudo registrar el reporte ni retirar la captura de Drive. Consultá a soporte.')
        if (consulta.data && consulta.data.actor_id === who.data.user.id && consulta.data.user_id === perfil.data.id) return json({ ok: true, id })
        console.error('Error al registrar reporte:', guardado.error.message)
        throw new Error('No se pudo registrar el reporte. Intentá nuevamente.')
      }
      return json({ ok: true, id })
    }
    if (action === 'download') {
      if (!uuid(body.id)) throw new HttpError(400, 'Reporte inválido.')
      const reporte = await user.from('reportes_error').select('id,drive_file_id,mime,bytes').eq('id', body.id).maybeSingle()
      if (reporte.error) throw new Error('No se pudo consultar el reporte.')
      if (!reporte.data || !driveId(reporte.data.drive_file_id)) throw new HttpError(404, 'Reporte no disponible.')
      const token = await tokenDrive()
      const fileId = reporte.data.drive_file_id
      const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=parents,mimeType,trashed,size,appProperties`, { headers: headers(token) })
      if (!meta.ok) throw new Error('No se pudo verificar la captura en Drive.')
      const m = await meta.json()
      if (m.trashed || !m.parents?.includes(ROOT) || m.appProperties?.dataescuela_reporte !== body.id
        || m.mimeType !== reporte.data.mime || Number(m.size) !== reporte.data.bytes) throw new Error('La captura fue modificada o movida en Drive.')
      const imagen = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: headers(token) })
      if (!imagen.ok) throw new Error('No se pudo descargar la captura.')
      const bytes = new Uint8Array(await imagen.arrayBuffer())
      if (bytes.length !== reporte.data.bytes || !validImage(bytes, reporte.data.mime)) throw new Error('La captura no es válida.')
      return new Response(bytes, { headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'X-Image-Type': reporte.data.mime } })
    }
    throw new HttpError(400, 'Operación no válida.')
  } catch (e) {
    console.error('reportes-error:', e instanceof Error ? e.message : String(e))
    return json({ error: e instanceof Error ? e.message : 'No se pudo completar la operación.' }, e instanceof HttpError ? e.status : 503)
  }
})
