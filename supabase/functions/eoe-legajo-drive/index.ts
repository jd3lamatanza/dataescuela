import { createClient } from 'npm:@supabase/supabase-js@2'
import { tokenDrive } from '../_shared/firmas-drive.ts'

const ROOT = '1q4Ua0gbDYYI-0eLXZzPfu7Jwkm4Gkq0Z'
const ORIGIN = (() => { try { return new URL(Deno.env.get('APP_PUBLIC_URL') ?? '').origin } catch { return '' } })()
const CORS = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'private, no-store', Vary: 'Origin' }
const json = (body: object, status = 200) => Response.json(body, { status, headers: CORS })
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const authDrive = (token: string) => ({ Authorization: `Bearer ${token}` })
const driveId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(id)
const uuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const adminClient = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
type Client = ReturnType<typeof adminClient>
type Tipo = 'legajo' | 'solicitud'
interface Info { nombre_carpeta: string; carpeta_id: string | null; puede_subir: boolean }
interface CargaPendiente { drive_file_id: string; nombre: string; mime: string; bytes: number }

async function verificarCarpeta(token: string, id: string, tipo: Tipo, referencia: string) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,mimeType,parents,trashed,appProperties`, { headers: authDrive(token) })
  if (!r.ok) throw new Error('No se pudo consultar la carpeta en Drive.')
  const folder = await r.json()
  if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.parents?.includes(ROOT)
    || folder.appProperties?.dataescuela_tipo !== tipo || folder.appProperties?.dataescuela_ref !== referencia) {
    throw new Error('La carpeta del legajo fue modificada o movida. Consultá con la Jefatura.')
  }
  return folder as { name: string }
}

async function sincronizarCarpeta(token: string, id: string, tipo: Tipo, referencia: string, nombre: string) {
  const folder = await verificarCarpeta(token, id, tipo, referencia)
  if (folder.name === nombre) return
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
    method: 'PATCH', headers: { ...authDrive(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nombre }),
  })
  if (!r.ok) throw new Error('No se pudo actualizar el nombre de la carpeta en Drive.')
}

async function prepararCarpeta(admin: Client, token: string, tipo: Tipo, referencia: string, nombre: string): Promise<string> {
  const reserva = crypto.randomUUID()
  const r = await admin.rpc('eoe_drive_reservar', { p_tipo: tipo, p_referencia: referencia, p_reserva: reserva })
  if (r.error) throw new Error('No se pudo reservar la carpeta.')
  if (r.data?.estado === 'ocupada') throw new HttpError(409, 'Otra carga está preparando la carpeta. Intentá nuevamente.')
  if (r.data?.estado === 'lista' && driveId(r.data.id)) {
    await sincronizarCarpeta(token, r.data.id, tipo, referencia, nombre)
    return r.data.id
  }
  if (r.data?.estado !== 'reservada') throw new Error('Respuesta inválida al preparar la carpeta.')
  try {
    const q = `'${ROOT}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='dataescuela_tipo' and value='${tipo}' } and appProperties has { key='dataescuela_ref' and value='${referencia}' }`
    const busqueda = await fetch(`https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=2&fields=files(id)&q=${encodeURIComponent(q)}`, { headers: authDrive(token) })
    if (!busqueda.ok) throw new Error('No se pudo buscar la carpeta en Drive.')
    const encontrados = (await busqueda.json()).files
    if (!Array.isArray(encontrados) || encontrados.length > 1) throw new Error('No se pudo identificar la carpeta de forma segura. Consultá con la Jefatura.')
    let id: unknown = encontrados[0]?.id
    if (!id) {
      const creado = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
        method: 'POST', headers: { ...authDrive(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [ROOT], appProperties: { dataescuela_tipo: tipo, dataescuela_ref: referencia } }),
      })
      if (!creado.ok) throw new Error('No se pudo crear la carpeta en Drive.')
      id = (await creado.json()).id
    }
    if (!driveId(id)) throw new Error('Drive no devolvió una carpeta válida.')
    await sincronizarCarpeta(token, id, tipo, referencia, nombre)
    const confirmada = await admin.rpc('eoe_drive_confirmar', { p_tipo: tipo, p_referencia: referencia, p_reserva: reserva, p_carpeta: id })
    if (confirmada.error || confirmada.data !== true) throw new Error('No se pudo confirmar la carpeta. Intentá nuevamente.')
    return id
  } finally {
    const liberada = await admin.rpc('eoe_drive_liberar', { p_tipo: tipo, p_referencia: referencia, p_reserva: reserva })
    if (liberada.error) console.error('No se pudo liberar la reserva de carpeta:', liberada.error.message)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Sesión requerida.')
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !service || !ORIGIN) throw new HttpError(503, 'El servicio de archivos no está configurado.')
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const admin = adminClient(url, service)
    const who = await user.auth.getUser()
    if (who.error || !who.data.user) throw new HttpError(401, 'Sesión inválida.')
    let sesion: unknown
    try {
      const payload = authorization.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      sesion = JSON.parse(atob(payload)).session_id
    } catch { throw new HttpError(401, 'Sesión inválida.') }
    if (!uuid(sesion)) throw new HttpError(401, 'Sesión inválida.')
    let body: Record<string, unknown>
    try { body = await req.json() } catch { throw new HttpError(400, 'Solicitud inválida.') }
    const tipo = body.tipo
    if (tipo !== 'legajo' && tipo !== 'solicitud') throw new HttpError(400, 'Tipo de archivo inválido.')
    const tokenLegajo = typeof body.token === 'string' ? body.token : null
    const info = async (referencia: string, escritura = false): Promise<Info> => {
      const r = await user.rpc('eoe_drive_info', { p_tipo: tipo, p_referencia: referencia, p_token: tokenLegajo })
      if (r.error || !r.data) throw new HttpError(403, 'Acceso vencido o no autorizado.')
      const d = r.data as Info
      if (escritura && !d.puede_subir) throw new HttpError(403, 'No se pueden agregar archivos a esta solicitud.')
      return d
    }
    if (body.action === 'init' || body.action === 'sync' || body.action === 'register') {
      const referencia = body.referencia
      if (!uuid(referencia)) throw new HttpError(400, 'Referencia inválida.')
      const estado = await info(referencia, body.action !== 'sync')
      if (body.action === 'sync' && !estado.carpeta_id) return json({ ok: true })
      const token = await tokenDrive()
      if (body.action === 'sync') {
        if (!driveId(estado.carpeta_id)) throw new Error('Carpeta inválida.')
        await sincronizarCarpeta(token, estado.carpeta_id, tipo, referencia, estado.nombre_carpeta)
        return json({ ok: true })
      }
      if (body.action === 'init') {
        const nombre = typeof body.nombre === 'string' ? body.nombre.replace(/[\r\n]/g, ' ').trim() : ''
        const mime = typeof body.mime === 'string' && body.mime.trim() ? body.mime.trim() : 'application/octet-stream'
        const bytes = body.bytes
        if (!nombre || nombre.length > 255 || mime.length > 255 || /[\r\n]/.test(mime) || mime.startsWith('application/vnd.google-apps.')
          || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1) throw new HttpError(400, 'Archivo inválido.')
        const folder = await prepararCarpeta(admin, token, tipo, referencia, estado.nombre_carpeta)
        await info(referencia, true)
        let fileId: string
        if (body.file_id !== undefined) {
          if (!driveId(body.file_id)) throw new HttpError(400, 'Carga inválida.')
          const pendientes = await user.rpc('eoe_drive_pendientes', { p_tipo: tipo, p_referencia: referencia, p_token: tokenLegajo })
          if (pendientes.error || !Array.isArray(pendientes.data)) throw new HttpError(403, 'Carga no disponible.')
          const carga = (pendientes.data as CargaPendiente[]).find((p) => p.drive_file_id === body.file_id)
          if (!carga || carga.nombre !== nombre || carga.mime !== mime || Number(carga.bytes) !== bytes) throw new HttpError(400, 'Seleccioná el mismo archivo pendiente.')
          fileId = body.file_id
        } else {
          const ids = await fetch('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive', { headers: authDrive(token) })
          if (!ids.ok) throw new Error('No se pudo preparar el identificador de Drive.')
          const generado = (await ids.json()).ids?.[0]
          if (!driveId(generado)) throw new Error('Drive no devolvió un identificador válido.')
          fileId = generado
          const registrada = await admin.rpc('eoe_drive_iniciar', {
            p_tipo: tipo, p_referencia: referencia, p_token: tokenLegajo, p_usuario: who.data.user.id, p_sesion: sesion,
            p_drive_id: fileId, p_nombre: nombre, p_mime: mime, p_bytes: bytes,
          })
          if (registrada.error) throw new Error('No se pudo preparar el seguimiento de la carga.')
        }
        const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
          method: 'POST', headers: { ...authDrive(token), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(bytes), Origin: ORIGIN },
          body: JSON.stringify({ id: fileId, name: nombre, parents: [folder], appProperties: { dataescuela_tipo: tipo, dataescuela_ref: referencia } }),
        })
        const location = r.headers.get('Location')
        let subida: URL
        try { subida = new URL(location ?? '') } catch { throw new Error('Drive no confirmó la preparación de la carga.') }
        if (!r.ok || subida.protocol !== 'https:' || subida.hostname !== 'www.googleapis.com' || subida.pathname !== '/upload/drive/v3/files') throw new Error('Drive no confirmó la preparación de la carga.')
        return json({ upload_url: subida.toString(), file_id: fileId })
      }
      if (!driveId(body.file_id) || !driveId(estado.carpeta_id)) throw new HttpError(400, 'Archivo inválido.')
      const metadata = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.file_id)}?supportsAllDrives=true&fields=id,name,size,mimeType,parents,trashed,appProperties`, { headers: authDrive(token) })
      if (metadata.status === 404) throw new HttpError(409, 'La carga todavía no se completó. Seleccioná el mismo archivo para reiniciarla.')
      if (!metadata.ok) throw new Error('No se pudo verificar el archivo en Drive.')
      const f = await metadata.json()
      if (f.trashed || f.id !== body.file_id || !f.parents?.includes(estado.carpeta_id)
        || f.appProperties?.dataescuela_tipo !== tipo || f.appProperties?.dataescuela_ref !== referencia
        || typeof f.name !== 'string' || typeof f.mimeType !== 'string' || !Number.isSafeInteger(Number(f.size)) || Number(f.size) < 1) {
        throw new HttpError(400, 'El archivo no corresponde a esta carpeta.')
      }
      await verificarCarpeta(token, estado.carpeta_id, tipo, referencia)
      const guardado = await admin.rpc('eoe_drive_registrar', {
        p_tipo: tipo, p_referencia: referencia, p_token: tokenLegajo, p_usuario: who.data.user.id, p_sesion: sesion,
        p_carpeta: estado.carpeta_id, p_drive_id: f.id, p_nombre: f.name, p_mime: f.mimeType, p_bytes: Number(f.size),
      })
      if (guardado.error) throw new Error('No se pudo registrar el archivo. Revisá el listado antes de reintentar o consultá con la Jefatura.')
      return json({ ok: true })
    }
    if (body.action === 'download') {
      if (!uuid(body.id)) throw new HttpError(400, 'Archivo inválido.')
      const datos = await user.rpc('eoe_drive_archivo', { p_tipo: tipo, p_archivo: body.id, p_token: tokenLegajo })
      if (datos.error || !datos.data) throw new HttpError(403, 'Archivo no disponible.')
      const { referencia, drive_file_id: fileId, carpeta_id: folder } = datos.data
      if (!uuid(referencia) || !driveId(fileId) || !driveId(folder)) throw new Error('Datos del archivo inválidos.')
      const token = await tokenDrive()
      await verificarCarpeta(token, folder, tipo, referencia)
      const metadata = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=parents,trashed,appProperties`, { headers: authDrive(token) })
      if (!metadata.ok) throw new Error('No se pudo verificar el archivo en Drive.')
      const archivo = await metadata.json()
      if (archivo.trashed || !archivo.parents?.includes(folder) || archivo.appProperties?.dataescuela_tipo !== tipo || archivo.appProperties?.dataescuela_ref !== referencia) throw new Error('El archivo ya no está en la carpeta correspondiente.')
      await info(referencia)
      const descarga = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: authDrive(token) })
      if (!descarga.ok || !descarga.body) throw new Error('No se pudo descargar el archivo.')
      await info(referencia)
      return new Response(descarga.body, { headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff' } })
    }
    throw new HttpError(400, 'Operación no válida.')
  } catch (e) {
    console.error('eoe-legajo-drive:', e instanceof Error ? e.message : String(e))
    return json({ error: e instanceof Error ? e.message : 'No se pudo completar la operación.' }, e instanceof HttpError ? e.status : 503)
  }
})
