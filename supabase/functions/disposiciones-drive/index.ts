import { createClient } from 'npm:@supabase/supabase-js@2'
import { tokenDrive } from '../_shared/firmas-drive.ts'

const FOLDER = '13F4pjReLUC-FYBq3DcnxaKgnFpPnlQv5'
const MAX = 10 * 1024 * 1024
const TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
const origin = (() => { try { return new URL(Deno.env.get('APP_PUBLIC_URL') ?? '').origin } catch { return '' } })()
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'archivo'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    const header = req.headers.get('Authorization') ?? ''
    if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Sesión requerida')
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: header } }, auth: { persistSession: false } })
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
    const { data: who, error: authError } = await user.auth.getUser()
    if (authError || !who.user) throw new HttpError(401, 'Sesión inválida')
    const body = await req.json()
    const action = String(body?.action ?? '')
    if (action === 'final-init' || action === 'final-register') {
      throw new HttpError(410, 'Actualizá la aplicación para aprobar con el nuevo circuito.')
    }
    if (action === 'approve') {
      const id = Number(body.disposicion_id)
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Disposición inválida.')
      const { data: permitido, error: permisoError } = await user.rpc('disposiciones_permitido')
      if (permisoError) throw permisoError
      if (!permitido) throw new HttpError(403, 'Sin permiso')
      const { error } = await admin.rpc('disposicion_aprobar', { p_id: id, p_actor: who.user.id })
      if (error) { console.error('Aprobación de disposición:', error.message); throw new HttpError(409, error.message) }
      return json({ ok: true })
    }
    if (action === 'init' || action === 'register') {
      const { data: permitido, error: permisoError } = await user.rpc('disposicion_acceso', { p_id: Number(body.disposicion_id) })
      if (permisoError) throw permisoError
      if (!permitido) throw new HttpError(403, 'Sin permiso')
    }
    if (action === 'remove') {
      const { data: permitido, error: permisoError } = await user.rpc('disposiciones_permitido')
      if (permisoError) throw permisoError
      if (!permitido) throw new HttpError(403, 'Sin permiso')
    }
    if (action === 'final-download') {
      const id = Number(body.disposicion_id)
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Disposición inválida.')
      const { data: file, error } = await user.from('disposicion_final').select('drive_file_id').eq('disposicion_id', id).maybeSingle()
      if (error) throw error
      if (!file) throw new HttpError(404, 'PDF final no disponible.')
      const token = await tokenDrive()
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.drive_file_id)}?alt=media&supportsAllDrives=true`, { headers: auth(token) })
      if (!r.ok || !r.body) throw new HttpError(502, 'No se pudo leer el PDF en Google Drive.')
      return new Response(r.body, { headers: { ...cors, 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } })
    }
    if (action === 'init' || action === 'register') {
      const id = Number(body.disposicion_id)
      const seguimiento = body.seguimiento === true
      const lote = String(body.lote_id ?? '')
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Disposición inválida')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lote)) throw new HttpError(400, 'Carga inválida')
      const { data: dispo, error } = await user.from('disposiciones').select('id').eq('id', id).maybeSingle()
      if (error) throw error
      if (!dispo) throw new HttpError(404, 'Disposición inexistente')
      if (action === 'init') {
        const name = String(body.name ?? '').trim(), mime = String(body.mime ?? '').toLowerCase(), size = Number(body.size)
        if (!name || !TYPES.has(mime) || !Number.isSafeInteger(size) || size < 1 || size > MAX) throw new HttpError(400, 'Elegí un PDF, imagen, Word o Excel de hasta 10 MB.')
        const token = await tokenDrive()
        const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
          method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), Origin: origin },
          body: JSON.stringify({ name: `dispo_${id}_${seguimiento ? 'seguimiento_' : ''}${crypto.randomUUID()}_${safeName(name)}`, parents: [FOLDER] }),
        })
        const upload = r.headers.get('Location')
        if (!r.ok || !upload) throw new HttpError(502, 'No se pudo iniciar la carga en la carpeta de Drive.')
        return json({ upload_url: upload })
      }
      const fileId = String(body.file_id ?? ''), name = String(body.name ?? '').trim().slice(0, 200)
      if (!/^[\w-]{10,}$/.test(fileId) || !name) throw new HttpError(400, 'Archivo inválido.')
      const token = await tokenDrive()
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed`, { headers: auth(token) })
      if (!r.ok) throw new HttpError(502, 'No se pudo verificar el archivo en Drive.')
      const file = await r.json()
      if (!file.parents?.includes(FOLDER) || file.trashed || !String(file.name).startsWith(`dispo_${id}_${seguimiento ? 'seguimiento_' : ''}`) || !TYPES.has(file.mimeType) || !Number.isSafeInteger(Number(file.size)) || Number(file.size) < 1 || Number(file.size) > MAX) throw new HttpError(400, 'El archivo no corresponde a esta disposición o no es válido.')
      const { error: saveError } = await admin.rpc('disposicion_lote_registrar', { p_lote: lote, p_id: id, p_actor: who.user.id, p_nombre: name, p_mime: file.mimeType, p_bytes: Number(file.size), p_file_id: fileId, p_tipo: seguimiento ? 'seguimiento' : 'inicial' })
      if (saveError) throw saveError
      return json({ ok: true })
    }
    if (action === 'download' || action === 'remove') {
      const id = Number(body.archivo_id)
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Archivo inválido.')
      const { data: file, error } = await user.from('disposicion_archivos').select('id,drive_file_id,mime').eq('id', id).maybeSingle()
      if (error) throw error
      if (!file) throw new HttpError(404, 'Archivo inexistente.')
      if (action === 'remove') {
        const { error: removeError } = await admin.from('disposicion_archivos').delete().eq('id', id)
        if (removeError) throw removeError
        return json({ ok: true })
      }
      const token = await tokenDrive()
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.drive_file_id)}?alt=media&supportsAllDrives=true`, { headers: auth(token) })
      if (!r.ok || !r.body) throw new HttpError(502, 'No se pudo leer el archivo en Google Drive.')
      return new Response(r.body, { headers: { ...cors, 'Content-Type': file.mime, 'Cache-Control': 'no-store' } })
    }
    throw new HttpError(400, 'Operación no válida.')
  } catch (e) {
    console.error('disposiciones-drive:', e instanceof Error ? e.message : String(e))
    return json({ error: e instanceof HttpError ? e.message : 'No se pudo completar la operación de Drive.' }, e instanceof HttpError ? e.status : 500)
  }
})
