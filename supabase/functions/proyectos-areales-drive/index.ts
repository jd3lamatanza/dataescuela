import { createClient } from 'npm:@supabase/supabase-js@2'
import { tokenDrive } from '../_shared/firmas-drive.ts'
import { esPdf, MAX_PROYECTO } from '../_shared/proyectos.ts'

const ROOT = '1CF4-0MzsO9Byc1zrtc3ScpTeBOIojr5j'
const ORIGIN = (() => { try { return new URL(Deno.env.get('APP_PUBLIC_URL') ?? '').origin } catch { return '' } })()
const CORS = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'private, no-store', Vary: 'Origin' }
const json = (body: object, status = 200) => Response.json(body, { status, headers: CORS })
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const headers = (token: string) => ({ Authorization: `Bearer ${token}` })
const driveId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(id)
const uuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const adminClient = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
type Client = ReturnType<typeof adminClient>

async function carpetaInspector(admin: Client, token: string, userId: string, nombre: string): Promise<string> {
  const reserva = crypto.randomUUID()
  const r = await admin.rpc('proyecto_areal_carpeta_reservar', { p_user: userId, p_nombre: nombre, p_reserva: reserva })
  if (r.error) throw new Error('No se pudo reservar la carpeta del inspector.')
  if (r.data?.estado === 'ocupada') throw new HttpError(409, 'Otra carga está preparando la carpeta. Intentá nuevamente.')
  if (r.data?.estado === 'lista' && driveId(r.data.id)) return r.data.id
  if (r.data?.estado !== 'reservada') throw new Error('Respuesta inválida al preparar la carpeta.')
  try {
    const q = `'${ROOT}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='dataescuela_inspector' and value='${userId}' }`
    const busqueda = await fetch(`https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=2&fields=files(id)&q=${encodeURIComponent(q)}`, { headers: headers(token) })
    if (!busqueda.ok) throw new Error('No se pudo buscar la carpeta en Drive.')
    const encontrados = (await busqueda.json()).files
    if (!Array.isArray(encontrados)) throw new Error('Respuesta inválida al buscar la carpeta.')
    if (encontrados.length > 1) throw new Error('Hay varias carpetas de este inspector. Consultá con la Jefatura.')
    let id: unknown = encontrados[0]?.id
    if (!id) {
      const creado = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
        method: 'POST', headers: { ...headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [ROOT], appProperties: { dataescuela_inspector: userId } }),
      })
      if (!creado.ok) throw new Error('No se pudo crear la carpeta del inspector en Drive.')
      id = (await creado.json()).id
    }
    if (!driveId(id)) throw new Error('Drive no devolvió una carpeta válida.')
    const guardado = await admin.rpc('proyecto_areal_carpeta_confirmar', { p_user: userId, p_reserva: reserva, p_carpeta: id })
    if (guardado.error || guardado.data !== true) throw new Error('No se pudo confirmar la carpeta. Intentá nuevamente.')
    return id
  } finally {
    const liberada = await admin.rpc('proyecto_areal_carpeta_liberar', { p_user: userId, p_reserva: reserva })
    if (liberada.error) console.error('No se pudo liberar la reserva de carpeta:', liberada.error.message)
  }
}

async function verificarCarpeta(token: string, id: string, userId: string, nombre: string) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=name,mimeType,parents,trashed,appProperties`, { headers: headers(token) })
  if (!r.ok) throw new Error('No se pudo acceder a la carpeta del inspector en Drive.')
  const data = await r.json()
  if (data.trashed || data.mimeType !== 'application/vnd.google-apps.folder' || !data.parents?.includes(ROOT) || data.appProperties?.dataescuela_inspector !== userId) {
    throw new Error('La carpeta del inspector fue modificada o movida. Consultá con la Jefatura.')
  }
  if (data.name !== nombre) {
    const renombrado = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
      method: 'PATCH', headers: { ...headers(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nombre }),
    })
    if (!renombrado.ok) throw new Error('No se pudo actualizar el nombre de la carpeta del inspector.')
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Sesión requerida.')
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !service || !ORIGIN) throw new HttpError(503, 'El servicio de proyectos no está configurado.')
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const admin = adminClient(url, service)
    const who = await user.auth.getUser()
    if (who.error || !who.data.user) throw new HttpError(401, 'Sesión inválida.')
    const perfil = await user.rpc('mi_perfil')
    if (perfil.error) throw new Error('No se pudo verificar el perfil.')
    const rol = perfil.data?.role, userId = perfil.data?.id
    if (!['areal', 'distrital'].includes(rol) || !uuid(userId)) throw new HttpError(403, 'Sin permiso para acceder a proyectos.')
    const multipart = (req.headers.get('Content-Type') ?? '').toLowerCase().startsWith('multipart/form-data')
    let form: FormData | null = null
    let body: Record<string, unknown> = {}
    try { if (multipart) form = await req.formData(); else body = await req.json() } catch { throw new HttpError(400, 'Solicitud inválida.') }
    const action = form ? form.get('action') : body.action
    if ((action === 'upload' || action === 'remove') && rol !== 'areal') throw new HttpError(403, 'Solo el inspector puede gestionar sus proyectos.')
    if (action === 'upload') {
      if (!form) throw new HttpError(400, 'Elegí un archivo PDF.')
      const archivo = form.get('archivo'), tipo = form.get('tipo'), otro = form.get('otro_tipo')
      if (!(archivo instanceof File) || !/\.pdf$/i.test(archivo.name) || !archivo.name.trim() || archivo.name.length > 255
        || archivo.size < 1 || archivo.size > MAX_PROYECTO) throw new HttpError(400, 'Elegí un PDF de hasta 5 MB.')
      if (typeof tipo !== 'string' || (tipo !== 'otro' && !/^[1-9]\d*$/.test(tipo))
        || (tipo === 'otro' && (typeof otro !== 'string' || !otro.trim() || otro.trim().length > 150))) {
        throw new HttpError(400, 'Seleccioná un tipo de proyecto válido.')
      }
      if (tipo !== 'otro') {
        const existe = await user.from('proyectos_areales_tipos').select('id').eq('id', tipo).maybeSingle()
        if (existe.error) throw new Error('No se pudo consultar el tipo de proyecto.')
        if (!existe.data) throw new HttpError(400, 'El tipo de proyecto ya no está disponible.')
      }
      const bytes = new Uint8Array(await archivo.arrayBuffer())
      if (!esPdf(bytes)) throw new HttpError(400, 'El archivo no es un PDF válido.')
      const inspector = await user.rpc('proyecto_areal_mi_inspector')
      if (inspector.error || typeof inspector.data !== 'string' || !inspector.data.trim()) throw new HttpError(403, inspector.error?.message ?? 'No se encontró el inspector.')
      const token = await tokenDrive()
      const folder = await carpetaInspector(admin, token, userId, inspector.data)
      await verificarCarpeta(token, folder, userId, inspector.data)
      const id = crypto.randomUUID()
      const boundary = `proyecto_${crypto.randomUUID().replaceAll('-', '')}`
      const inicio = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: archivo.name.trim(), parents: [folder], appProperties: { dataescuela_proyecto_areal: id } })}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`)
      const fin = new TextEncoder().encode(`\r\n--${boundary}--`)
      let subida: Response
      try {
        subida = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
          method: 'POST', headers: { ...headers(token), 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: new Blob([inicio, bytes, fin]),
        })
      } catch {
        throw new Error('No se pudo confirmar la carga en Drive. Revisá la carpeta antes de reintentar.')
      }
      if (!subida.ok) throw new Error('No se pudo confirmar la carga en Drive. Revisá la carpeta antes de reintentar.')
      let fileId: unknown
      try { fileId = (await subida.json()).id } catch { throw new Error('Drive no confirmó el archivo. Revisá la carpeta antes de reintentar.') }
      if (!driveId(fileId)) throw new Error('Drive no confirmó el archivo. Revisá la carpeta antes de reintentar.')
      const guardado = await admin.from('proyectos_areales').insert({
        id, user_id: userId, tipo_id: tipo === 'otro' ? null : tipo, otro_tipo: tipo === 'otro' && typeof otro === 'string' ? otro.trim() : null,
        nombre: archivo.name.trim(), bytes: bytes.length, drive_file_id: fileId,
      })
      if (guardado.error) {
        const consulta = await admin.from('proyectos_areales').select('id').eq('id', id).maybeSingle()
        if (consulta.error) throw new Error('No se pudo confirmar el registro. Revisá el listado y la carpeta antes de reintentar.')
        if (!consulta.data) {
          const limpieza = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: 'DELETE', headers: headers(token) })
          if (!limpieza.ok && limpieza.status !== 404) throw new Error('No se guardó el proyecto y no se pudo quitar el archivo de Drive. Consultá con la Jefatura.')
          throw new Error('No se pudo registrar el proyecto. Intentá nuevamente.')
        }
      }
      return json({ ok: true, id })
    }
    if (action === 'download' || action === 'remove') {
      const id = body.id
      if (!uuid(id)) throw new HttpError(400, 'Proyecto inválido.')
      const proyecto = await user.from('proyectos_areales').select('id,user_id,drive_file_id').eq('id', id).maybeSingle()
      if (proyecto.error) throw new Error('No se pudo consultar el proyecto.')
      if (!proyecto.data || !driveId(proyecto.data.drive_file_id)) throw new HttpError(404, 'Proyecto inexistente.')
      const propietario: string = proyecto.data.user_id
      if (action === 'remove' && propietario !== userId) throw new HttpError(403, 'Solo el inspector puede eliminar sus proyectos.')
      const carpeta = await admin.from('proyectos_areales_carpetas').select('drive_folder_id').eq('user_id', propietario).maybeSingle()
      if (carpeta.error || !driveId(carpeta.data?.drive_folder_id)) throw new Error('No se pudo consultar la carpeta del inspector.')
      const token = await tokenDrive()
      const fileId = proyecto.data.drive_file_id
      const metadata = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,parents,mimeType,trashed,size`, { headers: headers(token) })
      if (metadata.status !== 404) {
        if (!metadata.ok) throw new Error('No se pudo verificar el proyecto en Drive.')
        const archivo = await metadata.json()
        if (!archivo.parents?.includes(carpeta.data.drive_folder_id) || archivo.mimeType !== 'application/pdf') throw new Error('El archivo ya no está en la carpeta del inspector.')
        if (action === 'download' && (archivo.trashed || !Number.isSafeInteger(Number(archivo.size)) || Number(archivo.size) < 1 || Number(archivo.size) > MAX_PROYECTO)) throw new Error('El archivo no está disponible o supera 5 MB.')
      } else if (action === 'download') throw new HttpError(404, 'El archivo ya no está disponible en Drive.')
      if (action === 'remove') {
        if (metadata.status !== 404) {
          const eliminado = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: 'DELETE', headers: headers(token) })
          if (!eliminado.ok && eliminado.status !== 404) throw new Error('No se pudo eliminar el archivo de Drive.')
        }
        const eliminado = await admin.from('proyectos_areales').delete().eq('id', id).eq('user_id', propietario)
        if (eliminado.error) throw new Error('Se eliminó el archivo de Drive, pero no se pudo actualizar el listado. Reintentá eliminarlo.')
        return json({ ok: true })
      }
      const archivo = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: headers(token) })
      if (!archivo.ok || !archivo.body) throw new Error('No se pudo descargar el proyecto.')
      return new Response(archivo.body, { headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } })
    }
    throw new HttpError(400, 'Operación no válida.')
  } catch (e) {
    console.error('proyectos-areales-drive:', e instanceof Error ? e.message : String(e))
    return json({ error: e instanceof Error ? e.message : 'No se pudo completar la operación.' }, e instanceof HttpError ? e.status : 503)
  }
})
