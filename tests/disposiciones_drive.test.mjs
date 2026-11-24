import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'

function servicio({ editar = false, archivo = null } = {}) {
  let handler
  let descargas = 0
  let eliminaciones = 0
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'ficticio' } }, error: null }) },
    rpc: async () => ({ data: editar, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: archivo, error: null }) }) }) }),
  }
  const admin = {
    from: () => ({ delete: () => ({ eq: async () => { eliminaciones++; return { error: null } } }) }),
  }
  const source = readFileSync(new URL('../supabase/functions/disposiciones-drive/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { tokenDrive } from '../_shared/firmas-drive.ts'", 'const tokenDrive = globalThis.tokenDrive')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'admin' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : admin,
    tokenDrive: async () => 'token-ficticio',
    fetch: async () => { descargas++; return new Response('archivo ficticio') },
    Request, Response, URL, console,
  })
  const llamar = (body) => handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer ficticio', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { llamar, descargas: () => descargas, eliminaciones: () => eliminaciones }
}

test('solo se descarga una probanza visible por RLS', async () => {
  const visible = servicio({ archivo: { id: 1, drive_file_id: 'ficticio', mime: 'application/pdf' } })
  const respuesta = await visible.llamar({ action: 'download', archivo_id: 1 })
  assert.equal(respuesta.status, 200)
  assert.equal(await respuesta.text(), 'archivo ficticio')
  assert.equal(visible.descargas(), 1)
  const oculta = servicio()
  assert.equal((await oculta.llamar({ action: 'download', archivo_id: 2 })).status, 404)
  assert.equal(oculta.descargas(), 0)
})

test('sin permiso no se pueden cargar o quitar archivos', async () => {
  const lector = servicio({ archivo: { id: 1, drive_file_id: 'ficticio', mime: 'application/pdf' } })
  for (const action of ['init', 'register', 'remove']) {
    assert.equal((await lector.llamar({ action, archivo_id: 1, disposicion_id: 1 })).status, 403)
  }
  assert.equal(lector.eliminaciones(), 0)
  const editor = servicio({ editar: true, archivo: { id: 1, drive_file_id: 'ficticio', mime: 'application/pdf' } })
  assert.equal((await editor.llamar({ action: 'remove', archivo_id: 1 })).status, 200)
  assert.equal(editor.eliminaciones(), 1)
})

function servicioFinal({ distrito = false, acceso = false, visible = false, pdf = true } = {}) {
  let handler, finalizados = 0
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor-ficticio' } }, error: null }) },
    rpc: async (name) => ({ data: name === 'disposiciones_permitido' ? distrito : acceso, error: null }),
    from: (table) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: table === 'disposicion_final' ? (visible ? { drive_file_id: 'final_ficticio' } : null) : { id: 1 }, error: null,
    }) }) }) }),
  }
  const admin = { rpc: async (name) => { if (name === 'disposicion_finalizar_drive') finalizados++; return { error: null } } }
  const source = readFileSync(new URL('../supabase/functions/disposiciones-drive/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { tokenDrive } from '../_shared/firmas-drive.ts'", 'const tokenDrive = globalThis.tokenDrive')
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'admin' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : admin,
    tokenDrive: async () => 'ficticio',
    fetch: async (url) => url.includes('alt=media')
      ? new Response(pdf ? '%PDF-1.4 documento ficticio' : 'archivo inválido')
      : Response.json({ name: 'dispo_final_1_abc_final.pdf', mimeType: 'application/pdf', size: '20', parents: ['13F4pjReLUC-FYBq3DcnxaKgnFpPnlQv5'], trashed: false }),
    Request, Response, URL, console,
  })
  return {
    llamar: (body) => handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer ficticio', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
    finalizados: () => finalizados,
  }
}

test('finalización requiere Jefatura y comprueba la firma real del PDF', async () => {
  const body = { action: 'final-register', disposicion_id: 1, file_id: 'archivo_ficticio', name: 'final.pdf' }
  const inspector = servicioFinal({ acceso: true })
  assert.equal((await inspector.llamar(body)).status, 403)
  assert.equal(inspector.finalizados(), 0)
  const invalido = servicioFinal({ distrito: true, pdf: false })
  assert.equal((await invalido.llamar(body)).status, 400)
  assert.equal(invalido.finalizados(), 0)
  const valido = servicioFinal({ distrito: true })
  assert.equal((await valido.llamar(body)).status, 200)
  assert.equal(valido.finalizados(), 1)
})

test('la descarga final respeta la visibilidad de la escuela', async () => {
  const oculto = servicioFinal()
  assert.equal((await oculto.llamar({ action: 'final-download', disposicion_id: 1 })).status, 404)
  const visible = servicioFinal({ visible: true })
  assert.equal((await visible.llamar({ action: 'final-download', disposicion_id: 1 })).status, 200)
})

test('inspector asignado puede iniciar seguimiento aunque haya tres probanzas iniciales', async () => {
  let handler
  let acceso = true
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'inspector' } }, error: null }) },
    rpc: async () => ({ data: acceso, error: null }),
    from: (table) => ({ select: () => ({ eq: () => table === 'disposiciones'
      ? { maybeSingle: async () => ({ data: { id: 1 }, error: null }) }
      : { eq: async () => ({ count: 3, error: null }) } }) }),
  }
  const source = readFileSync(new URL('../supabase/functions/disposiciones-drive/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { tokenDrive } from '../_shared/firmas-drive.ts'", 'const tokenDrive = globalThis.tokenDrive')
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'admin' })[name] }, serve: (fn) => { handler = fn } },
    createClient: () => user, tokenDrive: async () => 'ficticio',
    fetch: async () => new Response(null, { status: 200, headers: { Location: 'https://upload.example' } }),
    Request, Response, URL, console, crypto: webcrypto,
  })
  const llamar = (seguimiento) => handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer ficticio', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'init', disposicion_id: 1, name: 'respuesta.pdf', mime: 'application/pdf', size: 20, seguimiento }) }))
  assert.equal((await llamar(true)).status, 200)
  assert.equal((await llamar(false)).status, 400)
  acceso = false
  assert.equal((await llamar(true)).status, 403)
})
