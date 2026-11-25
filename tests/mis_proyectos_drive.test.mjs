import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { TIPOS_PROYECTO, MAX_PROYECTO, esPdf } from '../supabase/functions/_shared/proyectos.ts'

const ID = '00000000-0000-4000-8000-000000000001'
function servicio({ rol = 'escolar', visible = true, registroFalla = false, archivoEnCarpeta = true, cueProyecto = 'cue-ficticio' } = {}) {
  let handler
  const registros = []
  let eliminados = 0
  let subidos = 0
  let authTokens = 0
  let carpeta = null
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'ficticio' } }, error: null }) },
    rpc: async () => ({ data: { role: rol, cue: 'cue-ficticio' }, error: null }),
    from: (tabla) => ({ select: () => ({ eq: () => tabla === 'escuelas'
      ? Promise.resolve({ data: [{ clave: 'EP 999' }, { clave: 'EP 999' }], error: null })
      : { maybeSingle: async () => ({ data: visible ? { id: ID, cue: cueProyecto, drive_file_id: 'archivo_ficticio' } : null, error: null }) } }) }),
  }
  const admin = {
    rpc: async (name, args) => {
      if (name === 'proyecto_carpeta_reservar') return { data: carpeta ? { estado: 'lista', id: carpeta } : { estado: 'reservada' }, error: null }
      if (name === 'proyecto_carpeta_confirmar') { carpeta = args.p_carpeta; return { data: true, error: null } }
      return { data: null, error: null }
    },
    from: (tabla) => {
      if (tabla === 'escuelas') return { select: () => ({ eq: async () => ({ data: [{ cue: 'cue-ficticio' }], error: null }) }) }
      if (tabla === 'proyecto_carpetas') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { drive_folder_id: 'carpeta_ficticia' }, error: null }) }) }) }
      return {
        insert: async (r) => { if (!registroFalla) registros.push(r); return { error: registroFalla ? { message: 'error' } : null } },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }
    },
  }
  const source = readFileSync(new URL('../supabase/functions/proyectos-drive/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { tokenDrive } from '../_shared/firmas-drive.ts'", 'const tokenDrive = globalThis.tokenDrive')
    .replace("import { esPdf, MAX_PROYECTO, TIPOS_PROYECTO } from '../_shared/proyectos.ts'", 'const { esPdf, MAX_PROYECTO, TIPOS_PROYECTO } = globalThis.proyectos')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'admin' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : admin,
    tokenDrive: async () => { authTokens++; return 'token-ficticio' },
    proyectos: { esPdf, MAX_PROYECTO, TIPOS_PROYECTO },
    fetch: async (url, opts = {}) => {
      if (opts.method === 'DELETE') { eliminados++; return new Response(null, { status: 204 }) }
      if (url.includes('upload/drive')) { subidos++; return Response.json({ id: `archivo_ficticio_${subidos}` }) }
      if (url.includes('q=')) return Response.json({ files: [] })
      if (opts.method === 'POST') return Response.json({ id: 'carpeta_ficticia' })
      if (url.includes('alt=media')) return new Response('%PDF-ejemplo')
      if (url.includes('archivo_ficticio')) return Response.json({ parents: [archivoEnCarpeta ? 'carpeta_ficticia' : 'otra_carpeta'], mimeType: 'application/pdf', size: '12', trashed: false })
      return Response.json({ name: 'EP 999', mimeType: 'application/vnd.google-apps.folder', parents: ['1fUtJDmkQIzSZW1ia5SLhNMZTKc4kvfxO'], trashed: false })
    },
    Request, Response, URL, File, FormData, Blob, Uint8Array, TextEncoder, crypto, console,
  })
  const llamar = (body) => handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer ficticio', ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body) }))
  return { llamar, registros, eliminados: () => eliminados, subidos: () => subidos, authTokens: () => authTokens }
}

function formulario({ tipo = 'Proyecto Institucional', nombre = 'archivo.pdf', bytes = '%PDF-ejemplo', otro = '' } = {}) {
  const f = new FormData()
  f.set('action', 'upload'); f.set('tipo', tipo); f.set('otro_tipo', otro)
  f.set('archivo', new File([bytes], nombre, { type: 'application/pdf' }))
  return f
}

test('carga individual: admite varios del mismo tipo y un tipo personalizado', async () => {
  const s = servicio()
  assert.equal((await s.llamar(formulario())).status, 200)
  assert.equal((await s.llamar(formulario())).status, 200)
  assert.equal((await s.llamar(formulario({ tipo: 'Otro', otro: 'Proyecto propio' }))).status, 200)
  assert.equal(s.registros.length, 3)
  assert.equal(s.registros[2].otro_tipo, 'Proyecto propio')
  assert.equal(s.registros[0].cue, 'cue-ficticio')
})

test('rechaza PDF inválido, extensiones incorrectas, archivos grandes y tipos inválidos antes de Drive', async () => {
  const s = servicio()
  for (const f of [
    formulario({ bytes: 'no es PDF' }), formulario({ nombre: 'archivo.txt' }),
    formulario({ bytes: new Uint8Array(MAX_PROYECTO + 1) }),
    formulario({ tipo: 'Otro' }), formulario({ tipo: 'No existe' }),
  ]) assert.equal((await s.llamar(f)).status, 400)
  assert.equal(s.subidos(), 0)
  assert.equal(s.authTokens(), 0)
})

test('acepta un PDF de exactamente 5 MB', async () => {
  const s = servicio()
  const bytes = new Uint8Array(MAX_PROYECTO)
  bytes.set([37, 80, 68, 70, 45])
  assert.equal((await s.llamar(formulario({ bytes }))).status, 200)
  assert.equal(s.registros[0].bytes, MAX_PROYECTO)
})

test('supervisión descarga solo proyectos visibles y no puede modificarlos', async () => {
  for (const rol of ['areal', 'distrital']) {
    const s = servicio({ rol })
    assert.equal((await s.llamar(formulario())).status, 403)
    assert.equal((await s.llamar({ action: 'remove', id: ID })).status, 403)
    assert.equal(s.authTokens(), 0)
    assert.equal((await s.llamar({ action: 'download', id: ID })).status, 200)
    assert.equal(s.eliminados(), 0)
    const ajeno = servicio({ rol, visible: false })
    assert.equal((await ajeno.llamar({ action: 'download', id: ID })).status, 404)
    assert.equal(ajeno.authTokens(), 0)
  }
  const regional = servicio({ rol: 'regional' })
  assert.equal((await regional.llamar({ action: 'download', id: ID })).status, 403)
  assert.equal(regional.authTokens(), 0)
})

test('escuela solo puede descargar o eliminar proyectos visibles', async () => {
  const otroRol = servicio({ rol: 'areal' })
  assert.equal((await otroRol.llamar(formulario())).status, 403)
  assert.equal(otroRol.authTokens(), 0)
  const ajeno = servicio({ visible: false })
  assert.equal((await ajeno.llamar({ action: 'download', id: ID })).status, 404)
  assert.equal((await ajeno.llamar({ action: 'remove', id: ID })).status, 404)
  assert.equal(ajeno.eliminados(), 0)
  const movido = servicio({ archivoEnCarpeta: false })
  assert.equal((await movido.llamar({ action: 'remove', id: ID })).status, 503)
  assert.equal(movido.eliminados(), 0)
  const propio = servicio()
  assert.equal((await propio.llamar({ action: 'download', id: ID })).status, 200)
  assert.equal((await propio.llamar({ action: 'remove', id: ID })).status, 200)
  assert.equal(propio.eliminados(), 1)
})

test('EOE consulta solo proyectos de su CUE y no puede subir ni eliminar', async () => {
  const propio = servicio({ rol: 'eoe' })
  assert.equal((await propio.llamar(formulario())).status, 403)
  assert.equal((await propio.llamar({ action: 'remove', id: ID })).status, 403)
  assert.equal(propio.authTokens(), 0)
  assert.equal((await propio.llamar({ action: 'download', id: ID })).status, 200)
  assert.equal(propio.eliminados(), 0)
  for (const opciones of [{ visible: false }, { cueProyecto: 'otra-escuela' }]) {
    const ajeno = servicio({ rol: 'eoe', ...opciones })
    assert.equal((await ajeno.llamar({ action: 'download', id: ID })).status, 404)
    assert.equal(ajeno.authTokens(), 0)
  }
})

test('si falla el registro se elimina el archivo recién subido', async () => {
  const s = servicio({ registroFalla: true })
  assert.equal((await s.llamar(formulario())).status, 503)
  assert.equal(s.subidos(), 1)
  assert.equal(s.eliminados(), 1)
})
