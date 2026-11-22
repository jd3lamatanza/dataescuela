import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createHmac, webcrypto } from 'node:crypto'
import ts from 'typescript'

const encode = (buffer) => Buffer.from(buffer).toString('base64url')

async function servicio(envios, responder = async () => new Response(null, { status: 201 })) {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await webcrypto.subtle.exportKey('jwk', keys.privateKey)
  const pub = encode(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]))
  const finales = []
  const llamadas = []
  let handler
  const source = readFileSync(new URL('../supabase/functions/push-dispatch/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ PUSH_DISPATCH_SECRET: 'secreto-prueba', PUSH_VAPID_PUBLIC: pub, PUSH_VAPID_PRIVATE: jwk.d, SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'ficticio' })[name] }, serve: (fn) => { handler = fn } },
    createClient: () => ({ rpc: async (name, args) => {
      if (name === 'push_tomar') return { data: envios, error: null }
      finales.push(args)
      return { error: null }
    } }),
    fetch: async (url, options) => { llamadas.push({ url, options }); return responder(url, options) },
    Request, Response, URL, Uint8Array, TextEncoder, AbortSignal, crypto: webcrypto, btoa, atob, console,
  })
  const llamar = (valid = true) => {
    const time = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', valid ? 'secreto-prueba' : 'incorrecto').update(time).digest('hex')
    return handler(new Request('https://example.test', { method: 'POST', headers: { 'x-push-time': time, 'x-push-signature': signature } }))
  }
  return { llamar, finales, llamadas, keys }
}

test('requiere firma válida y envía sin datos sensibles usando VAPID', async () => {
  const s = await servicio([{ id: 1, endpoint: 'https://fcm.googleapis.com/fcm/send/prueba' }])
  assert.equal((await s.llamar(false)).status, 401)
  assert.equal(s.llamadas.length, 0)
  assert.equal((await s.llamar()).status, 200)
  const { url, options } = s.llamadas[0]
  assert.equal(url.origin, 'https://fcm.googleapis.com')
  assert.equal(options.body, undefined)
  assert.equal(options.redirect, 'error')
  const token = options.headers.Authorization.match(/^vapid t=([^,]+), k=/)[1]
  const [header, payload, signature] = token.split('.')
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).aud, url.origin)
  assert.ok(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, s.keys.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${payload}`)))
  assert.equal(s.finales[0].p_resultado, 'enviado')
})

test('elimina suscripciones vencidas, reintenta fallos y bloquea destinos ajenos', async () => {
  const s = await servicio([
    { id: 1, endpoint: 'https://fcm.googleapis.com/fcm/send/vencido' },
    { id: 2, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/error' },
    { id: 3, endpoint: 'https://fcm.googleapis.com.ejemplo.test/ataque' },
  ], async (url) => new Response(null, { status: url.hostname === 'fcm.googleapis.com' ? 410 : 503 }))
  assert.equal((await s.llamar()).status, 200)
  assert.equal(s.llamadas.length, 2)
  assert.equal(s.finales.find((x) => x.p_id === 1).p_resultado, 'vencido')
  assert.equal(s.finales.find((x) => x.p_id === 2).p_resultado, 'reintentar')
  assert.equal(s.finales.find((x) => x.p_id === 3).p_resultado, 'reintentar')
})
