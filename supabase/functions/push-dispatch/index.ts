import { createClient } from 'npm:@supabase/supabase-js@2'

const encode = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), (c) => c.charCodeAt(0))
const utf8 = (value: string) => new TextEncoder().encode(value)

function concatenar(...partes: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const resultado = new Uint8Array(partes.reduce((total, parte) => total + parte.length, 0))
  let offset = 0
  for (const parte of partes) { resultado.set(parte, offset); offset += parte.length }
  return resultado
}

async function hkdf(entrada: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, longitud: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', entrada, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, longitud * 8))
}

async function cifrarPush(p256dh: string, auth: string, titulo: string): Promise<Uint8Array<ArrayBuffer>> {
  const receptor = decode(p256dh)
  const secreto = decode(auth)
  if (receptor.length !== 65 || receptor[0] !== 4 || secreto.length !== 16) throw new Error('Claves de suscripción inválidas')
  const claveReceptor = await crypto.subtle.importKey('raw', receptor, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const emisor = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', emisor.publicKey))
  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: claveReceptor }, emisor.privateKey, 256))
  const ikm = await hkdf(compartido, secreto, concatenar(utf8('WebPush: info\0'), receptor, publica), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(ikm, salt, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(ikm, salt, utf8('Content-Encoding: nonce\0'), 12)
  const contenido = concatenar(utf8(JSON.stringify({ titulo })), new Uint8Array([2]))
  if (contenido.length + 16 > 4096) throw new Error('Aviso push demasiado grande')
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, contenido))
  return concatenar(salt, new Uint8Array([0, 0, 16, 0, publica.length]), publica, cifrado)
}

function destinoSeguro(endpoint: string): URL {
  const url = new URL(endpoint)
  const host = url.hostname
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || !/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com)$/.test(host)) {
    throw new Error('Destino push no permitido')
  }
  return url
}

async function autorizado(request: Request, secret: string): Promise<boolean> {
  const timestamp = request.headers.get('x-push-time') ?? ''
  const signature = request.headers.get('x-push-signature') ?? ''
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 120 || !/^[0-9a-f]{64}$/.test(signature)) return false
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const bytes = Uint8Array.from(signature.match(/../g)!, (part) => parseInt(part, 16))
  return await crypto.subtle.verify('HMAC', key, bytes, utf8(timestamp))
}

async function vapid(endpoint: URL, publicKey: string, privateKey: string): Promise<string> {
  const punto = decode(publicKey)
  const privada = decode(privateKey)
  if (punto.length !== 65 || punto[0] !== 4 || privada.length !== 32) throw new Error('Claves VAPID inválidas')
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x: encode(punto.slice(1, 33)), y: encode(punto.slice(33)), d: privateKey,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = encode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = encode(utf8(JSON.stringify({
    aud: endpoint.origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: 'https://jd3lamatanza.github.io',
  })))
  const contenido = `${header}.${payload}`
  const firma = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(contenido)))
  return `vapid t=${contenido}.${encode(firma)}, k=${publicKey}`
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Método no permitido', { status: 405 })
  const secret = Deno.env.get('PUSH_DISPATCH_SECRET')
  const publicKey = Deno.env.get('PUSH_VAPID_PUBLIC')
  const privateKey = Deno.env.get('PUSH_VAPID_PRIVATE')
  const url = Deno.env.get('SUPABASE_URL')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !publicKey || !privateKey || !url || !service) {
    console.error('Falta configuración del despachador push')
    return new Response('Servicio no configurado', { status: 503 })
  }
  if (!await autorizado(request, secret)) return new Response('Sin permiso', { status: 401 })
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const reserva = crypto.randomUUID()
  const tomados = await admin.rpc('push_tomar', { p_reserva: reserva })
  if (tomados.error || !Array.isArray(tomados.data)) {
    console.error('No se pudo reservar la cola push:', tomados.error?.message)
    return new Response('No se pudo reservar la cola', { status: 500 })
  }
  let fallos = 0
  const envios: { id: number; endpoint: string; p256dh: string | null; auth_key: string | null; titulo: string }[] = tomados.data
  for (let i = 0; i < envios.length; i += 10) {
    await Promise.all(envios.slice(i, i + 10).map(async (envio) => {
      let resultado = 'reintentar'
      let codigo: number | null = null
      try {
        const endpoint = destinoSeguro(envio.endpoint)
        const authorization = await vapid(endpoint, publicKey, privateKey)
        const headers: Record<string, string> = { Authorization: authorization, TTL: '86400', Urgency: 'normal' }
        let body: Uint8Array<ArrayBuffer> | undefined
        if (envio.p256dh !== null || envio.auth_key !== null) {
          if (typeof envio.p256dh !== 'string' || typeof envio.auth_key !== 'string' || typeof envio.titulo !== 'string' || !envio.titulo.trim()) {
            throw new Error('Datos de suscripción push inválidos')
          }
          body = await cifrarPush(envio.p256dh, envio.auth_key, envio.titulo)
          headers['Content-Encoding'] = 'aes128gcm'
          headers['Content-Type'] = 'application/octet-stream'
        }
        const response = await fetch(endpoint, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers, body,
        })
        codigo = response.status
        if (response.ok) resultado = 'enviado'
        else if (codigo === 404 || codigo === 410) resultado = 'vencido'
        else console.error('Servicio push rechazó el envío:', codigo)
      } catch (error) {
        console.error('No se pudo enviar un aviso push:', error instanceof Error ? error.name : 'Error')
      }
      const finalizado = await admin.rpc('push_finalizar', { p_id: envio.id, p_reserva: reserva, p_resultado: resultado, p_error: codigo })
      if (finalizado.error) {
        fallos++
        console.error('No se pudo confirmar un envío push:', finalizado.error.message)
      }
    }))
  }
  return new Response(fallos ? 'No se pudieron confirmar algunos envíos' : 'OK', { status: fallos ? 500 : 200 })
})
