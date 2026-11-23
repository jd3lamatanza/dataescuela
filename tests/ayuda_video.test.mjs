import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'

const actor = '10000000-0000-4000-8000-000000000001'
const sesion = '20000000-0000-4000-8000-000000000002'
const video = 'video_de_prueba_123'
const jwt = 'header.' + Buffer.from(JSON.stringify({ session_id: sesion })).toString('base64url') + '.firma'

function servicio() {
  const estado = { acceso: true, avanzado: true, publicado: true, carpeta: true, solicitudes: [], ahora: Date.now() }
  class Reloj extends Date { static now() { return estado.ahora } }
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    rpc: async () => ({ data: estado.avanzado, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: estado.publicado ? { secciones: [{ medios: [{ video_drive: video }] }] } : null, error: null }) }) }) }),
  }
  const admin = {
    rpc: async () => ({ data: estado.acceso, error: null }),
    from: user.from,
  }
  let handler
  const source = readFileSync(new URL('../supabase/functions/ayuda-video/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { tokenDrive } from '../_shared/firmas-drive.ts'", 'const tokenDrive = globalThis.tokenDrive')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'secreto-prueba' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : admin,
    tokenDrive: async () => 'drive-token',
    fetch: async (url, opts) => {
      estado.solicitudes.push({ url, opts })
      if (url.includes('uploadType=resumable')) return new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test' } })
      if (url.includes('alt=media')) {
        const range = opts.headers.Range.match(/bytes=(\d+)-(\d+)/)
        const start = Number(range[1]), end = Number(range[2])
        return new Response(new Uint8Array(end - start + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/10000000` } })
      }
      return Response.json({ mimeType: 'video/mp4', parents: [estado.carpeta ? '1jZz36lronDDYJ3FcpcIXvehQjeQbJD3T' : 'otra'], trashed: false, size: '10000000' })
    },
    crypto: webcrypto, Uint8Array, Request, Response, URL, TextEncoder, TextDecoder, btoa, atob, console, Date: Reloj,
  })
  const post = (body, auth = true) => handler(new Request('https://db.example/functions/v1/ayuda-video', { method: 'POST', headers: { ...(auth ? { authorization: `Bearer ${jwt}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  const get = (ticket, range) => handler(new Request(`https://db.example/functions/v1/ayuda-video?ticket=${encodeURIComponent(ticket)}`, { headers: range ? { Range: range } : {} }))
  return { estado, post, get }
}

test('solo Distrital autorizado puede iniciar carga y se usa la carpeta solicitada', async () => {
  const s = servicio()
  const cuerpo = { accion: 'iniciar', nombre: 'guía.mp4', mime: 'video/mp4', tamano: 100 }
  assert.equal((await s.post(cuerpo, false)).status, 401)
  s.estado.avanzado = false
  assert.equal((await s.post(cuerpo)).status, 403)
  assert.equal(s.estado.solicitudes.length, 0)
  s.estado.avanzado = true
  assert.equal((await s.post({ ...cuerpo, mime: 'text/html' })).status, 400)
  const r = await s.post(cuerpo)
  assert.equal(r.status, 200)
  assert.match((await r.json()).upload_url, /^https:\/\/www\.googleapis\.com\//)
  assert.deepEqual(JSON.parse(s.estado.solicitudes[0].opts.body).parents, ['1jZz36lronDDYJ3FcpcIXvehQjeQbJD3T'])
})

test('solo reproduce videos publicados de la guía y revoca acceso al cerrar sesión', async () => {
  const s = servicio()
  assert.equal((await s.post({ accion: 'reproducir', guia: 'inicio', video: 'archivo_no_asociado' })).status, 404)
  s.estado.acceso = false
  assert.equal((await s.post({ accion: 'reproducir', guia: 'inicio', video })).status, 403)
  s.estado.acceso = true
  const ticket = (await (await s.post({ accion: 'reproducir', guia: 'inicio', video })).json()).ticket
  assert.equal((await s.get(ticket + 'x')).status, 401)
  assert.equal((await s.get(ticket, 'bytes=100-199')).status, 206)
  s.estado.publicado = false
  assert.equal((await s.get(ticket)).status, 404)
  s.estado.publicado = true
  s.estado.acceso = false
  assert.equal((await s.get(ticket)).status, 403)
  s.estado.acceso = true
  s.estado.ahora += 10 * 60_000
  assert.equal((await s.get(ticket)).status, 401)
})

test('transmite rangos acotados, admite búsqueda y rechaza archivos ajenos', async () => {
  const s = servicio()
  const ticket = (await (await s.post({ accion: 'reproducir', guia: 'inicio', video })).json()).ticket
  const r = await s.get(ticket, 'bytes=500-')
  assert.equal(r.status, 206)
  assert.equal(r.headers.get('Content-Range'), 'bytes 500-4194803/10000000')
  assert.equal((await r.arrayBuffer()).byteLength, 4194304)
  const fin = await s.get(ticket, 'bytes=-20')
  assert.equal(fin.headers.get('Content-Range'), 'bytes 9999980-9999999/10000000')
  assert.equal((await s.get(ticket, 'bytes=10000000-')).status, 416)
  assert.equal((await s.get(ticket, 'bytes=0-5,10-15')).status, 416)
  s.estado.carpeta = false
  assert.equal((await s.get(ticket)).status, 503)
})
