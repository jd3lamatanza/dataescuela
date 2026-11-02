import { createClient } from 'npm:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const APP_ORIGIN = (() => { try { return new URL(Deno.env.get('APP_PUBLIC_URL') ?? '').origin } catch { return '' } })()
const CORS = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

// Gmail admite 25 MB por mensaje y el adjunto crece ~37 % al codificarse: se adjunta hasta este total
const MAX_ATTACH_BYTES = 17 * 1024 * 1024

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

// DRIVE_FOLDER_ID / {clave de la escuela} / {fecha de carga}
async function ensureFolder(admin: ReturnType<typeof createClient>, token: string, s: { id: number; clave: string | null; cue: string; drive_folder_id: string | null }) {
  if (s.drive_folder_id) return s.drive_folder_id
  const escuela = await findOrCreateFolder(token, safeName(s.clave ?? s.cue), env('DRIVE_FOLDER_ID'))
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  const id = await findOrCreateFolder(token, hoy, escuela)
  await admin.from('salidas').update({ drive_folder_id: id }).eq('id', s.id)
  return id
}

async function sendMail(opts: { to: string; cc?: string; subject: string; content: string; attachments: { filename: string; content: Uint8Array; contentType: string }[] }) {
  const user = env('SMTP_USERNAME')
  const mailer = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: user, password: env('SMTP_PASSWORD') } } })
  try {
    await mailer.send({
      from: `DataEscuela <${user}>`, to: opts.to, ...(opts.cc ? { cc: opts.cc } : {}),
      subject: opts.subject, content: opts.content,
      attachments: opts.attachments.map((a) => ({ filename: a.filename, content: a.content, encoding: 'binary', contentType: a.contentType })),
    })
  } finally { await mailer.close() }
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
    const salidaId = Number(body?.salida_id)

    // La visibilidad la decide la RLS con el usuario real de la sesión
    const loadSalida = async (id: number) => {
      if (!Number.isInteger(id)) throw new HttpError(400, 'Salida inválida')
      const { data } = await user.from('salidas').select('id, clave, cue, escuela, titulo, fecha, destino, observaciones, drive_folder_id, user_id, estado:salida_estados(nombre)').eq('id', id).maybeSingle()
      if (!data) throw new HttpError(404, 'Salida inexistente')
      return data as any
    }
    const requireOwner = async (id: number) => {
      const { data } = await user.rpc('salida_es_dueno', { p_id: id })
      if (!data) throw new HttpError(403, 'Sin permiso')
    }
    const requireEditable = async (id: number) => {
      const { data } = await user.rpc('salida_editable', { p_id: id })
      if (!data) throw new HttpError(403, 'La salida no admite más archivos en su estado actual')
    }

    if (action === 'init') {
      await requireEditable(salidaId)
      const s = await loadSalida(salidaId)
      const name = safeName(String(body?.name ?? ''))
      const size = Number(body?.size)
      const mime = clean(String(body?.mime || 'application/octet-stream')).slice(0, 120)
      if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'El archivo está vacío')
      const token = await driveToken()
      const folder = await ensureFolder(admin, token, s)
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size),
          // Habilita CORS en la sesión de subida para que el navegador envíe el archivo directo a Drive
          Origin: APP_ORIGIN,
        },
        body: JSON.stringify({ name, parents: [folder] }),
      })
      const sessionUrl = r.headers.get('Location')
      if (!r.ok || !sessionUrl) { console.error('Drive init error:', r.status, await r.text()); throw new HttpError(503, 'No se pudo iniciar la subida a Google Drive') }
      return json({ upload_url: sessionUrl })
    }

    if (action === 'register') {
      await requireEditable(salidaId)
      const s = await loadSalida(salidaId)
      const fileId = String(body?.file_id ?? '')
      if (!/^[\w-]{10,}$/.test(fileId)) throw new HttpError(400, 'Archivo inválido')
      const token = await driveToken()
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=id,name,size,mimeType,parents`, { headers: { Authorization: `Bearer ${token}` } })
      const f = await r.json()
      if (!r.ok || !f.parents?.includes(s.drive_folder_id)) throw new HttpError(400, 'El archivo no corresponde a esta salida')
      const { error } = await admin.from('salida_archivos').insert({ salida_id: salidaId, nombre: f.name, mime: f.mimeType, bytes: Number(f.size ?? 0), drive_file_id: f.id })
      if (error) throw new HttpError(500, 'No se pudo registrar el archivo')
      return json({ ok: true })
    }

    if (action === 'download') {
      const { data: a } = await user.from('salida_archivos').select('nombre, mime, drive_file_id').eq('id', Number(body?.archivo_id)).maybeSingle()
      if (!a) throw new HttpError(404, 'Archivo inexistente')
      const token = await driveToken()
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${a.drive_file_id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok || !r.body) throw new HttpError(502, 'No se pudo leer el archivo de Google Drive')
      return new Response(r.body, { headers: { ...CORS, 'Content-Type': a.mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}` } })
    }

    if (action === 'send') {
      await requireOwner(salidaId)
      const s = await loadSalida(salidaId)
      const { data: files } = await user.from('salida_archivos').select('nombre, mime, bytes, drive_file_id').eq('salida_id', salidaId).order('id')
      const { data: esc } = await admin.from('escuelas').select('email').eq('cue', s.cue).not('email', 'is', null).order('id').limit(1).maybeSingle()
      const cc = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((esc?.email ?? '').trim()) ? (esc!.email as string).trim() : undefined
      const token = await driveToken()

      const attachments: { filename: string; content: Uint8Array; contentType: string }[] = []
      const links: string[] = []
      let total = 0
      for (const f of files ?? []) {
        const size = Number(f.bytes ?? 0)
        if (total + size <= MAX_ATTACH_BYTES) {
          const r = await fetch(`https://www.googleapis.com/drive/v3/files/${f.drive_file_id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
          if (r.ok) { attachments.push({ filename: f.nombre, content: new Uint8Array(await r.arrayBuffer()), contentType: f.mime || 'application/octet-stream' }); total += size; continue }
        }
        links.push(`${f.nombre}: https://drive.google.com/file/d/${f.drive_file_id}/view`)
      }

      const fecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(s.fecha + 'T00:00:00Z'))
      const content = [
        'Se registró una nueva salida educativa en DataEscuela.', '',
        `Escuela: ${s.escuela}`, `Clave provincial: ${s.clave ?? '-'}`, `CUE: ${s.cue}`, '',
        `Título: ${s.titulo}`, `Fecha: ${fecha}`, `Destino: ${s.destino}`,
        `Observaciones: ${s.observaciones || 'Sin observaciones'}`, `Estado: ${s.estado?.nombre ?? 'Pendiente'}`, '',
        `Documentación (${(files ?? []).length}): ${attachments.length ? `${attachments.length} adjunta(s) a este correo` : 'sin adjuntos en este correo'}`,
        ...(links.length ? ['', 'Archivos que superan el límite de adjuntos (disponibles en Google Drive):', ...links] : []),
      ].join('\n')

      await sendMail({ to: env('JD3_EMAIL'), cc, subject: `Salida Educativa ${clean(s.clave ?? s.cue)} a ${clean(s.destino)}`, content, attachments })
      await admin.from('salidas').update({ mail_enviado_at: new Date().toISOString() }).eq('id', salidaId)
      return json({ ok: true, adjuntos: attachments.length, enlaces: links.length })
    }

    throw new HttpError(400, 'Acción inválida')
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error('salidas-drive failed:', e instanceof Error ? e.message : String(e))
    return json({ error: 'Error interno' }, 500)
  }
})
