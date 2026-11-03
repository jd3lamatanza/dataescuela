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
    const dirId = Number(body?.directivo_id)

    // La visibilidad la decide la RLS con el usuario real de la sesión
    const load = async (id: number) => {
      if (!Number.isInteger(id)) throw new HttpError(400, 'Directivo inválido')
      const { data } = await user.from('eav_directivos').select('id, cue, clave, cuil, drive_folder_id').eq('id', id).maybeSingle()
      if (!data) throw new HttpError(404, 'Directivo inexistente')
      return data as any
    }
    const requireEditable = async (id: number) => {
      const { data } = await user.rpc('eav_directivo_editable', { p_id: id })
      if (!data) throw new HttpError(403, 'El directivo no se puede modificar en su estado actual')
    }

    // {raíz}/{clave}/Cargos/Directivo-{CUIL}; si cambió el CUIL se renombra la carpeta existente
    const ensureFolder = async (token: string, d: any) => {
      const name = `Directivo-${d.cuil}`
      if (d.drive_folder_id) {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${d.drive_folder_id}?supportsAllDrives=true&fields=id`, { method: 'PATCH', headers: { ...AUTH(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
        if (r.ok) return d.drive_folder_id as string
        if (r.status !== 404) { console.error('Drive rename error:', r.status, await r.text()); throw new HttpError(503, 'No se pudo actualizar la carpeta en Google Drive') }
      }
      const escuela = await findOrCreateFolder(token, safeName(d.clave || d.cue), env('EAV_FOLDER_ID'))
      const cargos = await findOrCreateFolder(token, 'Cargos', escuela)
      const folder = await findOrCreateFolder(token, name, cargos)
      await admin.from('eav_directivos').update({ drive_folder_id: folder }).eq('id', d.id)
      return folder
    }

    if (action === 'init') {
      await requireEditable(dirId)
      const d = await load(dirId)
      const name = safeName(String(body?.name ?? ''))
      const size = Number(body?.size)
      const mime = clean(String(body?.mime || 'application/octet-stream')).slice(0, 120)
      if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'El archivo está vacío')
      const token = await driveToken()
      const folder = await ensureFolder(token, d)
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
      await requireEditable(dirId)
      const d = await load(dirId)
      const fileId = String(body?.file_id ?? '')
      if (!/^[\w-]{10,}$/.test(fileId) || !d.drive_folder_id) throw new HttpError(400, 'Archivo inválido')
      const token = await driveToken()
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name,size,mimeType,parents`, { headers: AUTH(token) })
      const f = await r.json()
      if (!r.ok || !f.parents?.includes(d.drive_folder_id)) throw new HttpError(400, 'El archivo no corresponde a este directivo')
      const { error } = await admin.from('eav_directivo_archivos').insert({ directivo_id: dirId, nombre: f.name, mime: f.mimeType, bytes: Number(f.size ?? 0), drive_file_id: f.id })
      if (error) throw new HttpError(500, 'No se pudo registrar el archivo')
      return json({ ok: true })
    }

    if (action === 'quitar') {
      const { data: a } = await user.from('eav_directivo_archivos').select('id, directivo_id, drive_file_id').eq('id', Number(body?.archivo_id)).maybeSingle()
      if (!a) throw new HttpError(404, 'Archivo inexistente')
      await requireEditable(a.directivo_id)
      const token = await driveToken()
      await fetch(`https://www.googleapis.com/drive/v3/files/${a.drive_file_id}?supportsAllDrives=true`, { method: 'PATCH', headers: { ...AUTH(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
      await admin.from('eav_directivo_archivos').delete().eq('id', a.id)
      return json({ ok: true })
    }

    if (action === 'download') {
      const { data: a } = await user.from('eav_directivo_archivos').select('nombre, mime, drive_file_id').eq('id', Number(body?.archivo_id)).maybeSingle()
      if (!a) throw new HttpError(404, 'Archivo inexistente')
      const token = await driveToken()
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${a.drive_file_id}?alt=media&supportsAllDrives=true`, { headers: AUTH(token) })
      if (!r.ok || !r.body) throw new HttpError(502, 'No se pudo leer el archivo de Google Drive')
      return new Response(r.body, { headers: { ...CORS, 'Content-Type': a.mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}` } })
    }

    throw new HttpError(400, 'Acción inválida')
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('eav-drive failed:', e instanceof Error ? e.message : String(e))
    return json({ error: 'Error interno' }, 500)
  }
})
