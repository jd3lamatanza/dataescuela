const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { webcrypto } = require('node:crypto')

const reference = '11111111-1111-4111-8111-111111111111'
const session = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const folderId = 'carpeta_prueba_123'
const fileId = 'archivo_prueba_123'
const auth = `Bearer a.${Buffer.from(JSON.stringify({ session_id: session })).toString('base64url')}.b`

function harness({ allowed = true, folderMatches = true, fileMatches = true, fileMissing = false } = {}) {
  let handler
  const calls = []
  const info = { nombre_carpeta: '12345678', carpeta_id: folderId, puede_subir: true }
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    rpc: async (name) => {
      if (!allowed) return { error: { message: 'denegado' } }
      if (name === 'eoe_drive_info') return { data: info, error: null }
      if (name === 'eoe_drive_archivo') return { data: { referencia: reference, drive_file_id: fileId, carpeta_id: folderId }, error: null }
      if (name === 'eoe_drive_pendientes') return { data: [{ drive_file_id: fileId, nombre: 'a.pdf', mime: 'application/pdf', bytes: 9 }], error: null }
      throw new Error(`RPC inesperada: ${name}`)
    },
  }
  const admin = { rpc: async (name, args) => {
    calls.push({ name, args })
    if (name === 'eoe_drive_reservar') return { data: { estado: 'lista', id: folderId }, error: null }
    if (name === 'eoe_drive_iniciar') return { data: null, error: null }
    if (name === 'eoe_drive_registrar') return { data: '44444444-4444-4444-8444-444444444444', error: null }
    throw new Error(`RPC inesperada: ${name}`)
  } }
  const fetchMock = async (input, options = {}) => {
    const url = String(input)
    calls.push({ url, options })
    if (url.includes('/files/generateIds')) return Response.json({ ids: [fileId] })
    if (url.includes('/upload/drive/v3/files')) return new Response(null, { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test' } })
    if (url.includes(`/files/${folderId}`)) return Response.json({
      name: info.nombre_carpeta, mimeType: 'application/vnd.google-apps.folder',
      parents: [folderMatches ? '1q4Ua0gbDYYI-0eLXZzPfu7Jwkm4Gkq0Z' : 'otra_carpeta'],
      appProperties: { dataescuela_tipo: 'legajo', dataescuela_ref: reference },
    })
    if (url.includes(`/files/${fileId}`) && url.includes('alt=media')) return new Response('contenido')
    if (url.includes(`/files/${fileId}`) && fileMissing) return new Response(null, { status: 404 })
    if (url.includes(`/files/${fileId}`)) return Response.json({
      id: fileId, name: 'documento.pdf', mimeType: 'application/pdf', size: '9',
      parents: [fileMatches ? folderId : 'otra_carpeta'],
      appProperties: { dataescuela_tipo: 'legajo', dataescuela_ref: reference },
    })
    throw new Error(`URL inesperada: ${url}`)
  }
  const env = { APP_PUBLIC_URL: 'https://ejemplo.test', SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' }
  const source = fs.readFileSync('supabase/functions/eoe-legajo-drive/index.ts', 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const context = {
    exports: {}, require: (name) => name.startsWith('npm:') ? { createClient: (_url, key) => key === 'service' ? admin : user } : { tokenDrive: async () => 'drive-token' },
    Deno: { env: { get: (name) => env[name] }, serve: (fn) => { handler = fn } },
    fetch: fetchMock, Request, Response, URL, crypto: webcrypto, atob, console,
  }
  vm.runInNewContext(code, context)
  return {
    calls,
    request: (body, authorization = auth) => handler(new Request('https://edge.test', {
      method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })),
  }
}

test('exige autorización antes de consultar Drive', async () => {
  const h = harness({ allowed: false })
  const response = await h.request({ action: 'init', tipo: 'legajo', referencia: reference, token: 'pin', nombre: 'a.pdf', bytes: 9 })
  assert.equal(response.status, 403)
  assert.equal(h.calls.length, 0)
})

test('prepara la subida solo en una carpeta verificada', async () => {
  const h = harness()
  const response = await h.request({ action: 'init', tipo: 'legajo', referencia: reference, token: 'pin', nombre: 'a.pdf', mime: 'application/pdf', bytes: 9 })
  assert.equal(response.status, 200)
  const request = h.calls.find((c) => c.url?.includes('/upload/drive/'))
  assert.equal(JSON.parse(request.options.body).id, fileId)
  assert.equal(JSON.parse(request.options.body).appProperties.dataescuela_ref, reference)
  assert.deepEqual(JSON.parse(request.options.body).parents, [folderId])
  assert.ok(h.calls.findIndex((c) => c.name === 'eoe_drive_iniciar') < h.calls.findIndex((c) => c.url?.includes('/upload/drive/')))
  const wrong = harness({ folderMatches: false })
  assert.equal((await wrong.request({ action: 'init', tipo: 'legajo', referencia: reference, token: 'pin', nombre: 'a.pdf', bytes: 9 })).status, 503)
  assert.equal(wrong.calls.some((c) => c.url?.includes('/upload/drive/')), false)
})

test('registra solo archivos de la carpeta y revalida la sesión en el servidor', async () => {
  const h = harness()
  const response = await h.request({ action: 'register', tipo: 'legajo', referencia: reference, token: 'pin', file_id: fileId })
  assert.equal(response.status, 200)
  const registro = h.calls.find((c) => c.name === 'eoe_drive_registrar')
  assert.equal(registro.args.p_usuario, userId)
  assert.equal(registro.args.p_sesion, session)
  assert.equal(registro.args.p_token, 'pin')
  const wrong = harness({ fileMatches: false })
  assert.equal((await wrong.request({ action: 'register', tipo: 'legajo', referencia: reference, token: 'pin', file_id: fileId })).status, 400)
  assert.equal(wrong.calls.some((c) => c.name === 'eoe_drive_registrar'), false)
})

test('no descarga archivos movidos a otra carpeta', async () => {
  const h = harness({ fileMatches: false })
  const response = await h.request({ action: 'download', tipo: 'legajo', id: '44444444-4444-4444-8444-444444444444', token: 'pin' })
  assert.equal(response.status, 503)
  assert.equal(h.calls.some((c) => c.url?.includes('alt=media')), false)
})

test('recupera o reinicia una carga por el identificador guardado', async () => {
  const h = harness({ fileMissing: true })
  const missing = await h.request({ action: 'register', tipo: 'legajo', referencia: reference, token: 'pin', file_id: fileId })
  assert.equal(missing.status, 409)
  const wrong = await h.request({ action: 'init', tipo: 'legajo', referencia: reference, token: 'pin', file_id: fileId, nombre: 'a.pdf', mime: 'application/pdf', bytes: 10 })
  assert.equal(wrong.status, 400)
  const retry = await h.request({ action: 'init', tipo: 'legajo', referencia: reference, token: 'pin', file_id: fileId, nombre: 'a.pdf', mime: 'application/pdf', bytes: 9 })
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).file_id, fileId)
  assert.equal(h.calls.filter((c) => c.name === 'eoe_drive_iniciar').length, 0)
})
