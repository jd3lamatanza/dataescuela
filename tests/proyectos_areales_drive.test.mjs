import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { MAX_PROYECTO, esPdf } from '../supabase/functions/_shared/proyectos.ts'

const OWNER = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const PROJECT = '00000000-0000-4000-8000-000000000003'
function servicio({ rol = 'areal', owner = OWNER, visible = true, folderOwner = OWNER, fileOwner = OWNER, registroFalla = false } = {}) {
  let handler
  const registros = [], carpetas = [], busquedas = []
  let eliminados = 0, tokens = 0, uploads = 0, carpeta = null
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-ficticio' } }, error: null }) },
    rpc: async (name) => name === 'mi_perfil' ? { data: { role: rol, id: owner }, error: null } : { data: 'Inspector Ejemplo', error: null },
    from: (tabla) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: tabla === 'proyectos_areales_tipos' ? { id: 1 } : visible ? { id: PROJECT, user_id: fileOwner, drive_file_id: 'archivo_ficticio' } : null,
      error: null,
    }) }) }) }),
  }
  const admin = {
    rpc: async (name, args) => {
      if (name === 'proyecto_areal_carpeta_reservar') return { data: carpeta ? { estado: 'lista', id: carpeta } : { estado: 'reservada' }, error: null }
      if (name === 'proyecto_areal_carpeta_confirmar') { carpeta = args.p_carpeta; return { data: true, error: null } }
      return { data: null, error: null }
    },
    from: (tabla) => tabla === 'proyectos_areales_carpetas'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { drive_folder_id: 'carpeta_ficticia' }, error: null }) }) }) }
      : {
        insert: async (r) => { if (!registroFalla) registros.push(r); return { error: registroFalla ? { message: 'error' } : null } },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      },
  }
  const source = readFileSync(new URL('../supabase/functions/proyectos-areales-drive/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { tokenDrive } from '../_shared/firmas-drive.ts'", 'const tokenDrive = globalThis.tokenDrive')
    .replace("import { esPdf, MAX_PROYECTO } from '../_shared/proyectos.ts'", 'const { esPdf, MAX_PROYECTO } = globalThis.proyectos')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'admin' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : admin,
    tokenDrive: async () => { tokens++; return 'token-ficticio' },
    proyectos: { esPdf, MAX_PROYECTO },
    fetch: async (url, opts = {}) => {
      if (opts.method === 'DELETE') { eliminados++; return new Response(null, { status: 204 }) }
      if (url.includes('upload/drive')) { uploads++; return Response.json({ id: `archivo_ficticio_${uploads}` }) }
      if (url.includes('q=')) { busquedas.push(decodeURIComponent(url)); return Response.json({ files: [] }) }
      if (opts.method === 'POST') { carpetas.push(JSON.parse(opts.body)); return Response.json({ id: 'carpeta_ficticia' }) }
      if (url.includes('alt=media')) return new Response('%PDF-ejemplo')
      if (url.includes('archivo_ficticio')) return Response.json({ parents: ['carpeta_ficticia'], mimeType: 'application/pdf', size: '12', trashed: false })
      return Response.json({ name: 'Inspector Ejemplo', appProperties: { dataescuela_inspector: folderOwner }, mimeType: 'application/vnd.google-apps.folder', parents: ['1CF4-0MzsO9Byc1zrtc3ScpTeBOIojr5j'], trashed: false })
    },
    Request, Response, URL, File, FormData, Blob, Uint8Array, TextEncoder, crypto, console,
  })
  const llamar = (body) => handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer ficticio', ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body) }))
  return { llamar, registros, carpetas, busquedas, eliminados: () => eliminados, tokens: () => tokens, uploads: () => uploads }
}
function formulario({ tipo = '1', nombre = 'archivo.pdf', bytes = '%PDF-ejemplo', otro = '' } = {}) {
  const f = new FormData()
  f.set('action', 'upload'); f.set('tipo', tipo); f.set('otro_tipo', otro)
  f.set('archivo', new File([bytes], nombre, { type: 'application/pdf' }))
  return f
}

test('carga varios proyectos y otro tipo en la carpeta identificada por la cuenta efectiva', async () => {
  const s = servicio()
  assert.equal((await s.llamar(formulario())).status, 200)
  assert.equal((await s.llamar(formulario())).status, 200)
  assert.equal((await s.llamar(formulario({ tipo: 'otro', otro: 'Personalizado' }))).status, 200)
  assert.equal(s.registros.length, 3)
  assert.equal(s.registros[2].otro_tipo, 'Personalizado')
  assert.equal(s.registros[0].user_id, OWNER)
  assert.equal(s.carpetas[0].name, 'Inspector Ejemplo')
  assert.equal(s.carpetas[0].appProperties.dataescuela_inspector, OWNER)
  assert.ok(s.busquedas[0].includes(OWNER))
  const homonimo = servicio({ owner: OTHER, folderOwner: OTHER })
  assert.equal((await homonimo.llamar(formulario())).status, 200)
  assert.equal(homonimo.carpetas[0].name, s.carpetas[0].name)
  assert.notEqual(homonimo.carpetas[0].appProperties.dataescuela_inspector, OWNER)
})

test('valida PDF y tipos antes de acceder a Drive', async () => {
  const s = servicio()
  for (const f of [formulario({ bytes: 'no PDF' }), formulario({ nombre: 'archivo.txt' }),
    formulario({ bytes: new Uint8Array(MAX_PROYECTO + 1) }), formulario({ tipo: 'otro' }), formulario({ tipo: 'invalido' })]) {
    assert.equal((await s.llamar(f)).status, 400)
  }
  assert.equal(s.tokens(), 0)
  const bytes = new Uint8Array(MAX_PROYECTO); bytes.set([37, 80, 68, 70, 45])
  assert.equal((await s.llamar(formulario({ bytes }))).status, 200)
})

test('distrital solo consulta; areal no elimina proyectos ajenos ni usa carpetas de otro inspector', async () => {
  const distrital = servicio({ rol: 'distrital' })
  assert.equal((await distrital.llamar(formulario())).status, 403)
  assert.equal((await distrital.llamar({ action: 'remove', id: PROJECT })).status, 403)
  assert.equal((await distrital.llamar({ action: 'download', id: PROJECT })).status, 200)
  const ajeno = servicio({ visible: false })
  assert.equal((await ajeno.llamar({ action: 'download', id: PROJECT })).status, 404)
  assert.equal(ajeno.tokens(), 0)
  const otro = servicio({ fileOwner: OTHER })
  assert.equal((await otro.llamar({ action: 'remove', id: PROJECT })).status, 403)
  const carpetaAjena = servicio({ folderOwner: OTHER })
  assert.equal((await carpetaAjena.llamar(formulario())).status, 503)
  assert.equal(carpetaAjena.uploads(), 0)
  const escolar = servicio({ rol: 'escolar' })
  assert.equal((await escolar.llamar({ action: 'download', id: PROJECT })).status, 403)
})

test('borra el archivo recién subido si no puede registrar el proyecto', async () => {
  const s = servicio({ registroFalla: true })
  assert.equal((await s.llamar(formulario())).status, 503)
  assert.equal(s.uploads(), 1)
  assert.equal(s.eliminados(), 1)
})
