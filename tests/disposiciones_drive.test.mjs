import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
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

test('solo Distrital puede iniciar, registrar o quitar archivos', async () => {
  const lector = servicio({ archivo: { id: 1, drive_file_id: 'ficticio', mime: 'application/pdf' } })
  for (const action of ['init', 'register', 'remove']) {
    assert.equal((await lector.llamar({ action, archivo_id: 1, disposicion_id: 1 })).status, 403)
  }
  assert.equal(lector.eliminaciones(), 0)
  const editor = servicio({ editar: true, archivo: { id: 1, drive_file_id: 'ficticio', mime: 'application/pdf' } })
  assert.equal((await editor.llamar({ action: 'remove', archivo_id: 1 })).status, 200)
  assert.equal(editor.eliminaciones(), 1)
})
