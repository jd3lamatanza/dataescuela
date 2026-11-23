import { createClient } from 'npm:@supabase/supabase-js@2'
import { tokenDrive } from '../_shared/firmas-drive.ts'

const carpeta = '1jZz36lronDDYJ3FcpcIXvehQjeQbJD3T'
const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, range', 'Access-Control-Allow-Methods': 'POST, GET, HEAD, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length', 'Cache-Control': 'private, no-store', Vary: 'Origin' }
const json = (body: object, status = 200) => Response.json(body, { status, headers: cors })
const idValido = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(id)
const uuidValido = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const desb64 = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0))
type Ticket = { actor: string; sesion: string; guia: string; video: string; exp: number }
function contieneVideo(secciones: unknown, video: string): boolean {
  return Array.isArray(secciones) && secciones.some((s) => Array.isArray(s?.medios) && s.medios.some((m: { video_drive?: unknown } | null) => m?.video_drive === video))
}

async function clave(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
async function firmar(datos: Ticket, secret: string): Promise<string> {
  const contenido = b64(new TextEncoder().encode(JSON.stringify(datos)))
  const firma = await crypto.subtle.sign('HMAC', await clave(secret), new TextEncoder().encode(contenido))
  return `${contenido}.${b64(new Uint8Array(firma))}`
}
async function verificar(token: string, secret: string): Promise<Ticket | null> {
  try {
    const [contenido, firma, extra] = token.split('.')
    if (!contenido || !firma || extra || token.length > 2000) return null
    if (!await crypto.subtle.verify('HMAC', await clave(secret), desb64(firma), new TextEncoder().encode(contenido))) return null
    const d = JSON.parse(new TextDecoder().decode(desb64(contenido))) as Ticket
    if (!uuidValido(d.actor) || !uuidValido(d.sesion) || !/^[a-z0-9-]{1,80}$/.test(d.guia) || !idValido(d.video)
      || !Number.isSafeInteger(d.exp) || d.exp <= Date.now() || d.exp > Date.now() + 10 * 60_000) return null
    return d
  } catch { return null }
}
function sesionJwt(auth: string): string | null {
  try {
    const parte = auth.slice(7).split('.')[1]
    const payload = JSON.parse(new TextDecoder().decode(desb64(parte)))
    return uuidValido(payload.session_id) ? payload.session_id : null
  } catch { return null }
}
async function archivoDrive(id: string, token: string) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=mimeType,parents,trashed,size`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error('No se pudo consultar el video en Drive.')
  const f = await r.json()
  const size = Number(f.size)
  if (f.trashed || !['video/mp4', 'video/webm'].includes(f.mimeType) || !Array.isArray(f.parents) || !f.parents.includes(carpeta) || !Number.isSafeInteger(size) || size < 1) throw new Error('El video no está disponible en la carpeta de ayuda.')
  return { mime: f.mimeType as string, size }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!['POST', 'GET', 'HEAD'].includes(req.method)) return json({ error: 'Método no permitido.' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !secret || !origin) return json({ error: 'El servicio de video no está configurado.' }, 503)
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    if (req.method === 'POST') {
      const authorization = req.headers.get('Authorization') ?? ''
      if (!authorization.startsWith('Bearer ')) return json({ error: 'Sesión requerida.' }, 401)
      const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
      const who = await user.auth.getUser()
      if (who.error || !who.data.user) return json({ error: 'Sesión inválida.' }, 401)
      let body: { accion?: unknown; nombre?: unknown; mime?: unknown; tamano?: unknown; guia?: unknown; video?: unknown }
      try { body = await req.json() } catch { return json({ error: 'Solicitud inválida.' }, 400) }
      if (body?.accion === 'iniciar') {
        const permiso = await user.rpc('tiene_permiso_avanzado')
        if (permiso.error) return json({ error: 'No se pudo verificar el permiso.' }, 503)
        if (permiso.data !== true) return json({ error: 'Sin permiso.' }, 403)
        if (typeof body.nombre !== 'string' || !body.nombre.trim() || !['video/mp4', 'video/webm'].includes(String(body.mime))
          || !Number.isSafeInteger(body.tamano) || Number(body.tamano) < 1) return json({ error: 'Elegí un video MP4 o WebM válido.' }, 400)
        const nombre = body.nombre.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 150)
        const token = await tokenDrive()
        const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': String(body.mime), 'X-Upload-Content-Length': String(body.tamano), Origin: origin },
          body: JSON.stringify({ name: nombre, parents: [carpeta] }),
        })
        const upload = r.headers.get('Location')
        if (!r.ok || !upload || new URL(upload).protocol !== 'https:' || new URL(upload).hostname !== 'www.googleapis.com') throw new Error('No se pudo iniciar la carga en Drive.')
        return json({ upload_url: upload })
      }
      if (body?.accion !== 'reproducir' || typeof body.guia !== 'string' || !/^[a-z0-9-]{1,80}$/.test(body.guia) || !idValido(body.video)) return json({ error: 'Solicitud inválida.' }, 400)
      const sesion = sesionJwt(authorization)
      if (!sesion) return json({ error: 'Sesión inválida.' }, 401)
      const acceso = await admin.rpc('ayuda_video_sesion_valida', { p_actor: who.data.user.id, p_sesion: sesion })
      if (acceso.error) throw new Error('No se pudo verificar el acceso.')
      if (acceso.data !== true) return json({ error: 'Sin permiso.' }, 403)
      const guia = await user.from('ayuda_guias').select('secciones').eq('id', body.guia).maybeSingle()
      if (guia.error) throw new Error('No se pudo consultar la guía.')
      if (!guia.data || !contieneVideo(guia.data.secciones, body.video)) return json({ error: 'Video inexistente.' }, 404)
      const ticket = await firmar({ actor: who.data.user.id, sesion, guia: body.guia, video: body.video, exp: Date.now() + 10 * 60_000 }, secret)
      return json({ ticket })
    }

    const ticket = await verificar(new URL(req.url).searchParams.get('ticket') ?? '', secret)
    if (!ticket) return json({ error: 'La autorización del video venció.' }, 401)
    const [acceso, guia] = await Promise.all([
      admin.rpc('ayuda_video_sesion_valida', { p_actor: ticket.actor, p_sesion: ticket.sesion }),
      admin.from('ayuda_guias').select('secciones').eq('id', ticket.guia).maybeSingle(),
    ])
    if (acceso.error || guia.error) throw new Error('No se pudo verificar el acceso.')
    if (acceso.data !== true) return json({ error: 'Sin permiso.' }, 403)
    if (!guia.data || !contieneVideo(guia.data.secciones, ticket.video)) return json({ error: 'Video inexistente.' }, 404)
    const token = await tokenDrive()
    const file = await archivoDrive(ticket.video, token)
    const headers = { ...cors, 'Content-Type': file.mime, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
    if (req.method === 'HEAD') return new Response(null, { headers: { ...headers, 'Content-Length': String(file.size) } })
    const range = req.headers.get('Range')
    const match = range?.match(/^bytes=(\d*)-(\d*)$/)
    if (range && (!match || (!match[1] && !match[2]))) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.size}` } })
    const inicio = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, file.size - Number(match[2])) : 0
    const finSolicitado = match?.[1] && match[2] ? Number(match[2]) : file.size - 1
    if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(finSolicitado) || inicio >= file.size || finSolicitado < inicio) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.size}` } })
    const fin = Math.min(finSolicitado, file.size - 1, inicio + 4 * 1024 * 1024 - 1)
    const media = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ticket.video)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}`, Range: `bytes=${inicio}-${fin}` } })
    if (media.status !== 206 || !media.body || media.headers.get('Content-Range') !== `bytes ${inicio}-${fin}/${file.size}`) throw new Error('Drive no devolvió el fragmento solicitado.')
    return new Response(media.body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${inicio}-${fin}/${file.size}`, 'Content-Length': String(fin - inicio + 1) } })
  } catch (error) {
    console.error('Video de ayuda:', error instanceof Error ? error.message : String(error))
    return json({ error: 'No se pudo procesar el video. Intentá nuevamente.' }, 503)
  }
})
