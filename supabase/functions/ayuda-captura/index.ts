import { createClient } from 'npm:@supabase/supabase-js@2'
import { tokenDrive } from '../_shared/firmas-drive.ts'

const carpeta = '1HChSKnfT-wXedYF98-t08i5vFwCdx5m3'
const capturas: Record<string, string> = {
  inicio: '1tPNV9DcyJdfpiBZ-FsVv7a8KcfLJz96j',
  mensajes: '1dYrgfkL6BOqwXXRbVh_YGTHX7yiMkJh9',
  articulacion: '1t2gFbyg6C9td_0OmEQmZxG1YPI0mCUgY',
  estadistica: '1FZ9-XwWIDr-8Wav7j2HVVfWgXLyF0IcY',
  acreditacion: '1hkYwq_gD_wrg6MTBGAuBDK5xtwB985u3',
  'mapa-escolar': '1zoe7XSEEUinEZ7k1ZTLmAYsxQvLm61Cn',
  disposiciones: '146tQIjmVWVkfjGB9b9raY1se4M5lk45i',
  fichas: '1Pf5qjGA89-a7mZVpV_HLojMkRxh_k77z',
  planta: '1KoZDLukmi7xNTy8rMGyS4ZXUnKIfHjsa',
  matricula: '1qw0luY4Zmo5DIwWd2aodlQKUdjBkMiTU',
  salidas: '1GWyyO8Bj9Gh5w9UHbDn1BkdGbWZNSSOe',
  eav: '16LYAOGIStc-pkMZuwVYuTld-lAWJmDbV',
}
const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'private, no-store', Vary: 'Origin' }
const json = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json('Método no permitido.', 405)
  try {
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !anon || !origin) return json('El servicio de ayuda no está configurado.', 503)
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json('Sesión requerida.', 401)
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const who = await user.auth.getUser()
    if (who.error || !who.data.user) return json('Sesión inválida.', 401)
    const [perfil, real] = await Promise.all([user.rpc('mi_perfil'), user.rpc('real_role')])
    if (perfil.error || real.error) return json('No se pudo verificar el acceso.', 503)
    if (perfil.data?.role !== 'escolar' || !['escolar', 'distrital'].includes(real.data)) return json('Sin permiso.', 403)
    let body: { captura?: unknown }
    try { body = await req.json() } catch { return json('Solicitud inválida.', 400) }
    if (typeof body?.captura !== 'string' || !Object.hasOwn(capturas, body.captura)) return json('Captura inexistente.', 404)
    const id = capturas[body.captura]
    const token = await tokenDrive()
    const headers = { Authorization: `Bearer ${token}` }
    const metadata = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=mimeType,parents,trashed,size`, { headers })
    if (!metadata.ok) throw new Error('No se pudo consultar la captura en Drive.')
    const file = await metadata.json()
    if (file.trashed || file.mimeType !== 'image/png' || !Array.isArray(file.parents) || !file.parents.includes(carpeta)
      || !Number.isSafeInteger(Number(file.size)) || Number(file.size) < 1 || Number(file.size) > 2 * 1024 * 1024) {
      throw new Error('La captura no está disponible en la carpeta de ayuda.')
    }
    const image = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers })
    if (!image.ok) throw new Error('No se pudo descargar la captura de Drive.')
    const bytes = new Uint8Array(await image.arrayBuffer())
    if (bytes.length !== Number(file.size) || [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => bytes[i] !== b)) throw new Error('La captura de Drive no es una imagen PNG válida.')
    return new Response(bytes, { headers: { ...cors, 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    console.error('Captura de ayuda:', error instanceof Error ? error.message : String(error))
    return json('No se pudo cargar la captura. Intentá nuevamente.', 503)
  }
})
