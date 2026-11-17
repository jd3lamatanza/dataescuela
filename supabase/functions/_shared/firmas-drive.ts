const CARPETA = '1eU2sauAJU1MSdNp27JTrbd__rCqK8ctV'
const MAX = 2 * 1024 * 1024

export async function tokenDrive(): Promise<string> {
  const client = Deno.env.get('GOOGLE_CLIENT_ID'), secret = Deno.env.get('GOOGLE_CLIENT_SECRET'), refresh = Deno.env.get('GOOGLE_REFRESH_TOKEN')
  if (!client || !secret || !refresh) throw new Error('Google Drive no está configurado.')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  })
  const data = await r.json()
  if (!r.ok || typeof data.access_token !== 'string') throw new Error('No se pudo conectar con Google Drive.')
  return data.access_token
}

export async function comprobarCarpeta(token: string): Promise<void> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${CARPETA}?supportsAllDrives=true&fields=mimeType,capabilities(canAddChildren)`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new Error('No se puede acceder a la carpeta de firmas de Google Drive.')
  const carpeta = await r.json()
  if (carpeta.mimeType !== 'application/vnd.google-apps.folder' || !carpeta.capabilities?.canAddChildren) {
    throw new Error('La cuenta de Google Drive no puede agregar archivos a la carpeta de firmas.')
  }
}

export function validarImagen(mime: unknown, base64: unknown): Uint8Array {
  if ((mime !== 'image/png' && mime !== 'image/jpeg') || typeof base64 !== 'string' || base64.length > 2796204) {
    throw new Error('Elegí una imagen PNG o JPEG de hasta 2 MB.')
  }
  let decoded: string
  try { decoded = atob(base64.replace(/\s/g, '')) } catch { throw new Error('La imagen no es válida.') }
  const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0))
  const magic = mime === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10] : [255, 216, 255]
  if (!bytes.length || bytes.length > MAX || magic.some((b, i) => bytes[i] !== b)) throw new Error('La imagen no es válida.')
  return bytes
}

export async function subirFirma(token: string, nombre: string, mime: string, bytes: Uint8Array): Promise<string> {
  const boundary = 'firma_' + crypto.randomUUID().replaceAll('-', '')
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: nombre, parents: [CARPETA] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`)
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`)
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: new Blob([prefix, Uint8Array.from(bytes), suffix]),
  })
  const data = await r.json()
  if (!r.ok || typeof data.id !== 'string') { console.error('Error al subir firma a Drive:', r.status); throw new Error('No se pudo guardar la firma en Google Drive. Revisá el acceso a la carpeta.') }
  return data.id
}

export async function borrarFirma(token: string, id: string): Promise<void> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok && r.status !== 404) { console.error('Error al eliminar firma de Drive:', r.status); throw new Error('No se pudo eliminar la firma de Google Drive.') }
}

export async function descargarFirma(token: string, id: string, mime: string): Promise<string> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) { console.error('Error al descargar firma de Drive:', r.status); throw new Error('No se pudo leer una firma de Google Drive.') }
  const bytes = new Uint8Array(await r.arrayBuffer())
  if (bytes.length > MAX) throw new Error('Una firma supera el límite de 2 MB.')
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const base64 = btoa(binary)
  validarImagen(mime, base64)
  return base64
}
