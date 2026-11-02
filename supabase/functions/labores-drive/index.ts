import { createClient } from 'npm:@supabase/supabase-js@2'

const APP_ORIGIN = (() => { try { return new URL(Deno.env.get('APP_PUBLIC_URL') ?? '').origin } catch { return '' } })()
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

const env = (k: string) => Deno.env.get(k) ?? ''
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()
const safeName = (s: string) => clean(s).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 150) || 'archivo'

async function driveToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_REFRESH_TOKEN'), grant_type: 'refresh_token',
    }),
  })
  const d = await r.json()
  if (!r.ok || !d.access_token) { console.error('Drive token error:', d.error, d.error_description); throw new HttpError(503, 'No se pudo conectar con Google Drive') }
  return d.access_token as string
}

async function findOrCreateFolder(token: string, name: string, parent: string) {
  const auth = { Authorization: `Bearer ${token}` }
  const esc = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const q = `name = '${esc}' and '${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const f = await fetch(`https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id)&pageSize=1&q=${encodeURIComponent(q)}`, { headers: auth })
  const fd = await f.json()
  if (!f.ok) { console.error('Drive search error:', JSON.stringify(fd)); throw new HttpError(503, 'No se pudo consultar Google Drive') }
  if (fd.files?.[0]?.id) return fd.files[0].id as string
  const r = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
  })
  const d = await r.json()
  if (!r.ok || !d.id) { console.error('Drive folder error:', JSON.stringify(d)); throw new HttpError(503, 'No se pudo crear la carpeta en Google Drive') }
  return d.id as string
}

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}` })
// Drive admite "/" en los nombres: se conserva para el formato de fecha pedido
const folderName = (s: string) => clean(s).replace(/[\\:*?"<>|]+/g, '_').slice(0, 200) || 'Sin nombre'

async function uploadText(token: string, fileId: string | null, parent: string, name: string, text: string) {
  if (fileId) {
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true&fields=id`, {
      method: 'PATCH', headers: { ...AUTH(token), 'Content-Type': 'text/plain; charset=UTF-8' }, body: text,
    })
    if (r.ok) return fileId
    if (r.status !== 404) { console.error('Drive info update error:', r.status, await r.text()); throw new HttpError(503, 'No se pudo actualizar el archivo de la labor') }
  }
  const boundary = 'b' + crypto.randomUUID().replace(/-/g, '')
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent], mimeType: 'text/plain' })}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'POST', headers: { ...AUTH(token), 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  })
  const d = await r.json()
  if (!r.ok || !d.id) { console.error('Drive info create error:', JSON.stringify(d)); throw new HttpError(503, 'No se pudo crear el archivo de la labor') }
  return d.id as string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    const auth = req.headers.get('Authorization') ?? ''
    if (!auth.startsWith('Bearer ')) throw new HttpError(401, 'Sesión requerida')
    const url = env('SUPABASE_URL')
    const user = createClient(url, env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } })
    const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: who } = await user.auth.getUser()
    if (!who?.user) throw new HttpError(401, 'Sesión inválida')

    const body = await req.json()
    const action = String(body?.action ?? '')
    const laborId = Number(body?.labor_id)

    // La visibilidad la decide la RLS con el usuario real de la sesión
    const loadLabor = async (id: number) => {
      if (!Number.isInteger(id)) throw new HttpError(400, 'Labor inválida')
      const { data } = await user.from('labores').select('id, user_id, autor, fecha, motivo, acuerdos, equipo, drive_folder_id, drive_info_id').eq('id', id).maybeSingle()
      if (!data) throw new HttpError(404, 'Labor inexistente')
      return data as any
    }
    const requireAutor = async (id: number) => {
      const { data } = await user.rpc('labor_es_autor', { p_id: id })
      if (!data) throw new HttpError(403, 'Solo el autor puede modificar la labor')
    }

    // Carpeta del inspector / "{aaaa/mm/dd} - {motivo} - {evento}" + archivo de texto con toda la información
    const sync = async (id: number) => {
      await requireAutor(id)
      const l = await loadLabor(id)
      const { data: cat } = await admin.from('labores').select('lugar:catalogos!labores_lugar_id_fkey(nombre), tipo:catalogos!labores_tipo_id_fkey(nombre), dimension:catalogos!labores_dimension_id_fkey(nombre), evento:catalogos!labores_evento_id_fkey(nombre)').eq('id', id).single()
      const { data: part } = await admin.from('labor_inspectores').select('nombre').eq('labor_id', id).order('nombre')
      const { data: files } = await admin.from('labor_archivos').select('nombre, bytes, drive_file_id').eq('labor_id', id).order('id')
      const token = await driveToken()
      const c = cat as any
      const inspector = await findOrCreateFolder(token, folderName(l.autor), env('LABORES_FOLDER_ID'))
      const nombre = folderName(`${String(l.fecha).replaceAll('-', '/')} - ${l.motivo} - ${c.evento.nombre}`)
      let folder: string = l.drive_folder_id
      if (folder) {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${folder}?supportsAllDrives=true&fields=id`, { method: 'PATCH', headers: { ...AUTH(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nombre }) })
        if (r.status === 404) folder = ''
        else if (!r.ok) { console.error('Drive rename error:', r.status, await r.text()); throw new HttpError(503, 'No se pudo actualizar la carpeta en Google Drive') }
      }
      if (!folder) {
        const r = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
          method: 'POST', headers: { ...AUTH(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [inspector] }),
        })
        const d = await r.json()
        if (!r.ok || !d.id) { console.error('Drive folder error:', JSON.stringify(d)); throw new HttpError(503, 'No se pudo crear la carpeta en Google Drive') }
        folder = d.id
      }
      const fecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(l.fecha + 'T00:00:00Z'))
      const text = [
        'LABOR DE INSPECTOR', '',
        `Inspector: ${l.autor}`, `Fecha: ${fecha}`, `Evento: ${c.evento.nombre}`, `Lugar: ${c.lugar.nombre}`, `Tipo: ${c.tipo.nombre}`, `Dimensión: ${c.dimension.nombre}`,
        `Motivo: ${l.motivo}`, '',
        `Labor de Equipo Supervisivo: ${l.equipo ? 'Sí' : 'No'}`,
        ...(l.equipo ? [`Inspectores participantes: ${(part ?? []).map((p: any) => p.nombre).join(', ') || 'ninguno'}`] : []), '',
        'Acuerdos:', l.acuerdos || 'Sin acuerdos', '',
        `Probanza (${(files ?? []).length}):`, ...((files ?? []).length ? (files ?? []).map((f: any) => `- ${f.nombre}`) : ['- Sin archivos']), '',
      ].join('\n')
      const infoId = await uploadText(token, l.drive_info_id, folder, 'Labor.txt', text)
      await admin.from('labores').update({ drive_folder_id: folder, drive_info_id: infoId }).eq('id', id)
      return { token, folder }
    }

    if (action === 'sync') { await sync(laborId); return json({ ok: true }) }

    if (action === 'init') {
      await requireAutor(laborId)
      const existente = await loadLabor(laborId)
      const { token, folder } = existente.drive_folder_id ? { token: await driveToken(), folder: existente.drive_folder_id as string } : await sync(laborId)
      const name = clean(String(body?.name ?? '')).slice(0, 200) || 'archivo'
      const size = Number(body?.size)
      const mime = clean(String(body?.mime || 'application/octet-stream')).slice(0, 120)
      if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'El archivo está vacío')
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
        method: 'POST',
        headers: { ...AUTH(token), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), Origin: APP_ORIGIN },
        body: JSON.stringify({ name, parents: [folder] }),
      })
      const sessionUrl = r.headers.get('Location')
      if (!r.ok || !sessionUrl) { console.error('Drive init error:', r.status, await r.text()); throw new HttpError(503, 'No se pudo iniciar la subida a Google Drive') }
      return json({ upload_url: sessionUrl })
    }

    if (action === 'register') {
      await requireAutor(laborId)
      const l = await loadLabor(laborId)
      const fileId = String(body?.file_id ?? '')
      if (!/^[\w-]{10,}$/.test(fileId) || !l.drive_folder_id) throw new HttpError(400, 'Archivo inválido')
      const token = await driveToken()
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name,size,mimeType,parents`, { headers: AUTH(token) })
      const f = await r.json()
      if (!r.ok || !f.parents?.includes(l.drive_folder_id)) throw new HttpError(400, 'El archivo no corresponde a esta labor')
      const { error } = await admin.from('labor_archivos').insert({ labor_id: laborId, nombre: f.name, mime: f.mimeType, bytes: Number(f.size ?? 0), drive_file_id: f.id })
      if (error) throw new HttpError(500, 'No se pudo registrar el archivo')
      return json({ ok: true })
    }

    if (action === 'quitar') {
      const { data: a } = await user.from('labor_archivos').select('id, labor_id, drive_file_id').eq('id', Number(body?.archivo_id)).maybeSingle()
      if (!a) throw new HttpError(404, 'Archivo inexistente')
      await requireAutor(a.labor_id)
      const token = await driveToken()
      await fetch(`https://www.googleapis.com/drive/v3/files/${a.drive_file_id}?supportsAllDrives=true`, { method: 'PATCH', headers: { ...AUTH(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
      await admin.from('labor_archivos').delete().eq('id', a.id)
      return json({ ok: true })
    }

    if (action === 'eliminar') {
      await requireAutor(laborId)
      const l = await loadLabor(laborId)
      if (l.drive_folder_id) {
        const token = await driveToken()
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${l.drive_folder_id}?supportsAllDrives=true`, { method: 'PATCH', headers: { ...AUTH(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
        if (!r.ok && r.status !== 404) { console.error('Drive trash error:', r.status, await r.text()); throw new HttpError(503, 'No se pudo mover la carpeta a la papelera de Drive') }
      }
      await admin.from('notifications').delete().eq('url', `/labores-distrito?labor=${laborId}`)
      const { error } = await admin.from('labores').delete().eq('id', laborId)
      if (error) throw new HttpError(500, 'No se pudo eliminar la labor')
      return json({ ok: true })
    }

    if (action === 'download') {
      const { data: a } = await user.from('labor_archivos').select('nombre, mime, drive_file_id').eq('id', Number(body?.archivo_id)).maybeSingle()
      if (!a) throw new HttpError(404, 'Archivo inexistente')
      const token = await driveToken()
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${a.drive_file_id}?alt=media&supportsAllDrives=true`, { headers: AUTH(token) })
      if (!r.ok || !r.body) throw new HttpError(502, 'No se pudo leer el archivo de Google Drive')
      return new Response(r.body, { headers: { ...CORS, 'Content-Type': a.mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}` } })
    }

    throw new HttpError(400, 'Acción inválida')
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('labores-drive failed:', e instanceof Error ? e.message : String(e))
    return json({ error: 'Error interno' }, 500)
  }
})
