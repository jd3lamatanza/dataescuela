import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function servicio({ editable = true, fallaPermiso = false } = {}) {
  let handler, pedidosDrive = 0
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'usuario' } } }) },
    rpc: async () => ({ data: editable, error: fallaPermiso ? { message: 'Error de prueba' } : null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 1, clave: 'EP1', cue: '123', drive_folder_id: 'carpeta' }, error: null }) }) }) }),
  }
  const source = readFileSync(new URL('../supabase/functions/salidas-drive/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'admin' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : {},
    fetch: async (url) => {
      pedidosDrive++
      if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'ficticio' })
      return new Response(null, { headers: { Location: 'https://upload.example/session' } })
    },
    Request, Response, URL, URLSearchParams, console,
  })
  return {
    llamar: (body) => handler(new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer ficticio', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
    pedidos: () => pedidosDrive,
  }
}

test('el envío de correo de clientes antiguos queda deshabilitado', async () => {
  const s = servicio()
  const r = await s.llamar({ action: 'send', salida_id: 1 })
  assert.equal(r.status, 410)
  assert.match((await r.json()).error, /ya no se envían por correo/)
  assert.equal(s.pedidos(), 0)
})

test('la carga exige permiso y muestra explícitamente los errores de autorización', async () => {
  const solicitud = { action: 'init', salida_id: 1, name: 'documento.pdf', size: 100 }
  const denegado = servicio({ editable: false })
  assert.equal((await denegado.llamar(solicitud)).status, 403)
  assert.equal(denegado.pedidos(), 0)
  const error = servicio({ fallaPermiso: true })
  assert.equal((await error.llamar(solicitud)).status, 503)
  assert.equal(error.pedidos(), 0)
  const permitido = servicio()
  assert.equal((await permitido.llamar(solicitud)).status, 200)
  assert.equal(permitido.pedidos(), 2)
})
