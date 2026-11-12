import { createClient } from 'npm:@supabase/supabase-js@2'

const origin = (() => { try { return new URL(Deno.env.get('APP_PUBLIC_URL') ?? '').origin } catch { return '' } })()
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const MAX = 5 * 1024 * 1024
const folder = '1pZLb95o2_pqqXgAcA9OlsS0KuVPISv-b'
const env = (key: string) => {
  const value = Deno.env.get(key)
  if (!value) throw new HttpError(503, 'El servicio de adjuntos no está configurado')
  return value
}

async function tokenDrive() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token' }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) { console.error('Drive token failed', response.status); throw new HttpError(503, 'No se pudo conectar con Google Drive') }
  return data.access_token as string
}

async function limpiarPendientes(url: string) {
  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.from('correo_limpieza_drive').select('drive_file_id').order('creado_en').limit(5)
  if (error) { console.error('Drive cleanup queue lookup failed', error.message); return }
  if (!data.length) return
  const token = await tokenDrive()
  for (const item of data) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.drive_file_id)}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok && response.status !== 404) { console.error('Drive cleanup pending', response.status, item.drive_file_id); continue }
    const { error: deleteError } = await admin.from('correo_limpieza_drive').delete().eq('drive_file_id', item.drive_file_id)
    if (deleteError) console.error('Drive cleanup record failed', deleteError.message)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    const auth = req.headers.get('Authorization') ?? ''
    if (!auth.startsWith('Bearer ')) throw new HttpError(401, 'Sesión requerida')
    const url = env('SUPABASE_URL')
    const user = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: who, error: authError } = await user.auth.getUser()
    if (authError || !who.user) throw new HttpError(401, 'Sesión inválida')
    await limpiarPendientes(url)
    const type = req.headers.get('content-type') ?? ''
    if (type.startsWith('multipart/form-data')) {
      const length = Number(req.headers.get('content-length'))
      if (!Number.isFinite(length) || length <= 0 || length > MAX + 65536) throw new HttpError(413, 'El archivo supera el límite de 5 MB')
      const form = await req.formData()
      const file = form.get('file')
      const draft = Number(form.get('borrador'))
      if (!(file instanceof File) || !Number.isSafeInteger(draft) || draft <= 0 || file.size < 1 || file.size > MAX) throw new HttpError(400, 'Archivo o borrador inválido; máximo 5 MB por archivo')
      const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 255)
      if (!name) throw new HttpError(400, 'Nombre de archivo inválido')
      const allowed = await user.rpc('correo_borrador_autorizado', { p_id: draft })
      if (allowed.error) { console.error('Draft check failed', allowed.error.message); throw new HttpError(503, 'No se pudo comprobar el borrador') }
      if (!allowed.data) throw new HttpError(403, 'Borrador no disponible')
      const token = await tokenDrive()
      const boundary = 'correo_' + crypto.randomUUID().replaceAll('-', '')
      const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`)
      const suffix = new TextEncoder().encode(`\r\n--${boundary}--`)
      const body = new Blob([prefix, file, suffix])
      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      })
      const uploaded = await response.json()
      if (!response.ok || !uploaded.id) { console.error('Drive upload failed', response.status); throw new HttpError(503, 'No se pudo subir el adjunto') }
      const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await admin.from('correo_adjuntos').insert({ borrador_id: draft, nombre: name, mime: 'application/octet-stream', bytes: file.size, drive_file_id: uploaded.id })
      if (error) {
        const cleanup = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
        if (!cleanup.ok) console.error('Drive cleanup failed', cleanup.status, uploaded.id)
        console.error('Attachment registration failed', error.message)
        throw new HttpError(503, 'No se pudo guardar el adjunto; volvé a intentarlo')
      }
      return json({ ok: true })
    }
    const body = await req.json()
    if (!Number.isSafeInteger(body?.id) || body.id <= 0) throw new HttpError(400, 'Solicitud inválida')
    if (body?.action === 'remove') {
      const { data: fileId, error } = await user.rpc('correo_quitar_adjunto', { p_id: body.id })
      if (error) { console.error('Attachment removal failed', error.message); throw new HttpError(400, 'No se pudo quitar el adjunto') }
      if (fileId) {
        const token = await tokenDrive()
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
        if (!response.ok && response.status !== 404) {
          console.error('Drive removal pending', response.status, fileId)
          return json({ ok: true, warning: 'El adjunto se quitó del borrador; quedó pendiente su limpieza en Drive.' })
        }
        const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
        const { error: cleanupError } = await admin.from('correo_limpieza_drive').delete().eq('drive_file_id', fileId)
        if (cleanupError) {
          console.error('Drive cleanup record failed', cleanupError.message)
          return json({ ok: true, warning: 'El adjunto se eliminó de Drive; quedó pendiente actualizar el registro de limpieza.' })
        }
      }
      return json({ ok: true })
    }
    if (body?.action !== 'download') throw new HttpError(400, 'Solicitud inválida')
    const { data, error } = await user.rpc('correo_adjunto_autorizado', { p_id: body.id })
    if (error) { console.error('Attachment access check failed', error.message); throw new HttpError(503, 'No se pudo consultar el adjunto') }
    const attachment = data?.[0]
    if (!attachment) throw new HttpError(404, 'Adjunto no disponible')
    const token = await tokenDrive()
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(attachment.drive_file_id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok || !response.body) { console.error('Drive download failed', response.status); throw new HttpError(502, 'No se pudo descargar el adjunto') }
    return new Response(response.body, { headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.nombre)}` } })
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error('Correo Drive error:', error instanceof Error ? error.message : String(error))
    return json({ error: 'No se pudo procesar el adjunto' }, 500)
  }
})
