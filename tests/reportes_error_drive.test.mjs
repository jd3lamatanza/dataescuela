import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const USER = '00000000-0000-4000-8000-000000000001'
const ACTOR = '00000000-0000-4000-8000-000000000002'
const ID = '00000000-0000-4000-8000-000000000003'
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

function servicio({ visible = true, falla = false, sesion = true, carpeta = true } = {}) {
  let handler, uploads = 0, deletes = 0, tokens = 0, registro = null
  const user = {
    auth: { getUser: async () => ({ data: { user: sesion ? { id: ACTOR } : null }, error: null }) },
    rpc: async () => ({ data: { id: USER, active: true, role: 'escolar' }, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: visible ? { id: ID, drive_file_id: 'archivo_ficticio', mime: 'image/png', bytes: PNG.length } : null, error: null }) }) }) }),
  }
  const admin = {
    rpc: async (_name, args) => { if (!falla) registro = { id: args.p_id, user_id: args.p_user, actor_id: args.p_actor, drive_file_id: args.p_file, ...args }; return { error: falla ? { message: 'falla' } : null } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: registro, error: null }) }) }) }),
  }
  const source = readFileSync(new URL('../supabase/functions/reportes-error/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { tokenDrive } from '../_shared/firmas-drive.ts'", 'const tokenDrive = globalThis.tokenDrive')
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'admin' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : admin,
    tokenDrive: async () => { tokens++; return 'ficticio' },
    fetch: async (url, opts = {}) => {
      if (opts.method === 'DELETE') { deletes++; return new Response(null, { status: 204 }) }
      if (url.includes('upload/drive')) { uploads++; return Response.json({ id: 'archivo_ficticio' }) }
      if (url.includes('alt=media')) return new Response(PNG)
      if (url.includes('capabilities(canAddChildren)')) return Response.json({ mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: carpeta } })
      return Response.json({ parents: ['1Imi-ooGaTXEXscXuNHlxdytnGIxEOwFs'], mimeType: 'image/png', size: String(PNG.length), appProperties: { dataescuela_reporte: ID } })
    },
    Request, Response, URL, File, FormData, Blob, Uint8Array, TextEncoder, crypto, console,
  })
  return {
    llamar: (body) => handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer ficticio', ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body) })),
    datos: () => ({ uploads, deletes, tokens, registro }),
  }
}
function formulario({ bytes = PNG, mime = 'image/png', url = 'https://app.example/#/prueba', descripcion = 'Falla' } = {}) {
  const f = new FormData()
  f.set('action', 'upload'); f.set('id', ID); f.set('modulo', 'Home'); f.set('url', url); f.set('descripcion', descripcion)
  f.set('archivo', new File([bytes], 'captura', { type: mime }))
  return f
}

test('registra una captura y conserva actor y usuario efectivo; un reintento no duplica', async () => {
  const s = servicio()
  assert.equal((await s.llamar(formulario())).status, 200)
  assert.equal((await s.llamar(formulario())).status, 200)
  const { registro, uploads } = s.datos()
  assert.equal(uploads, 1)
  assert.equal(registro.p_actor, ACTOR)
  assert.equal(registro.p_user, USER)
  assert.equal(registro.p_descripcion, 'Falla')
})

test('rechaza imagen, URL y sesión inválidas antes de acceder a Drive', async () => {
  const s = servicio()
  for (const f of [formulario({ bytes: 'falso' }), formulario({ mime: 'image/svg+xml' }), formulario({ url: 'https://otro.example/' }), formulario({ descripcion: ' ' })]) {
    assert.equal((await s.llamar(f)).status, 400)
  }
  assert.equal(s.datos().tokens, 0)
  assert.equal((await servicio({ sesion: false }).llamar(formulario())).status, 401)
})

test('solo descarga imágenes visibles y limpia Drive si falla el registro', async () => {
  const no = servicio({ visible: false })
  assert.equal((await no.llamar({ action: 'download', id: ID })).status, 404)
  assert.equal(no.datos().tokens, 0)
  const si = servicio()
  const respuesta = await si.llamar({ action: 'download', id: ID })
  assert.equal(respuesta.status, 200)
  assert.equal(respuesta.headers.get('X-Image-Type'), 'image/png')
  assert.deepEqual(new Uint8Array(await respuesta.arrayBuffer()), PNG)
  const falla = servicio({ falla: true })
  assert.equal((await falla.llamar(formulario())).status, 503)
  assert.equal(falla.datos().deletes, 1)
  const carpeta = servicio({ carpeta: false })
  assert.equal((await carpeta.llamar(formulario())).status, 503)
  assert.equal(carpeta.datos().uploads, 0)
})
