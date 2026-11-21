import { createClient } from 'npm:@supabase/supabase-js@2'
import { tokenDrive } from '../_shared/firmas-drive.ts'

const FOLDER = '13F4pjReLUC-FYBq3DcnxaKgnFpPnlQv5'
const MAX = 10 * 1024 * 1024
const TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])
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
    const { data: permitido, error: permisoError } = await user.rpc('disposiciones_permitido')
    if (permisoError) throw permisoError
    if (!permitido) throw new HttpError(403, 'Sin permiso')
    const body = await req.json()
    const action = String(body?.action ?? '')
    if (action === 'init' || action === 'register') {
      const id = Number(body.disposicion_id)
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Disposición inválida')
      const { data: dispo, error } = await user.from('disposiciones').select('id').eq('id', id).maybeSingle()
      if (error) throw error
      if (!dispo) throw new HttpError(404, 'Disposición inexistente')
      if (action === 'init') {
        const name = String(body.name ?? '').trim(), mime = String(body.mime ?? '').toLowerCase(), size = Number(body.size)
        if (!name || !TYPES.has(mime) || !Number.isSafeInteger(size) || size < 1 || size > MAX) throw new HttpError(400, 'Elegí un PDF, JPG o PNG de hasta 10 MB.')
        const { count, error: countError } = await user.from('disposicion_archivos').select('id', { count: 'exact', head: true }).eq('disposicion_id', id)
        if (countError) throw countError
        if ((count ?? 0) >= 3) throw new HttpError(400, 'Solo se permiten hasta 3 archivos de probanza.')
        const token = await tokenDrive()
        const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
          method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), Origin: origin },
          body: JSON.stringify({ name: `dispo_${id}_${crypto.randomUUID()}_${safeName(name)}`, parents: [FOLDER] }),
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
      if (!file.parents?.includes(FOLDER) || file.trashed || !String(file.name).startsWith(`dispo_${id}_`) || !TYPES.has(file.mimeType) || Number(file.size) < 1 || Number(file.size) > MAX) throw new HttpError(400, 'El archivo no corresponde a esta disposición o no es válido.')
      const { error: saveError } = await admin.from('disposicion_archivos').insert({ disposicion_id: id, nombre: name, mime: file.mimeType, bytes: Number(file.size), drive_file_id: fileId })
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
