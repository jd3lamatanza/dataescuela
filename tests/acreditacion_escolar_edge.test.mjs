import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function servicio(permitido) {
  let handler
  let documentos = 0
  const llamadas = []
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'usuario' } }, error: null }) },
    rpc: async (name, args) => { llamadas.push({ name, args }); return { data: permitido, error: null } },
  }
  const source = readFileSync(new URL('../supabase/functions/acreditacion-escolar/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { prepararConstancia } from '../_shared/acreditacion-documento.ts'", 'const prepararConstancia = globalThis.prepararConstancia')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : {},
    prepararConstancia: async () => { documentos++; return { contenido: new Uint8Array([37, 80, 68, 70]) } },
    Uint8Array, Request, Response, URL, console,
  })
  const descargar = (authorization = 'Bearer ficticio') => handler(new Request('https://example.test', {
    method: 'POST', headers: { authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona: 123, evento: 'fedcba98-1234-4abc-8123-123456789abc' }),
  }))
  return { descargar, llamadas, get documentos() { return documentos } }
}

test('solo genera el PDF después de comprobar el acceso a la persona y evento', async () => {
  const s = servicio(true)
  const r = await s.descargar()
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/pdf')
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), '%PDF')
  assert.equal(s.llamadas[0].name, 'acreditacion_escolar_puede_ver')
  assert.equal(s.llamadas[0].args.p_persona, 123)
  assert.equal(s.documentos, 1)
})

test('rechaza acceso ajeno o sin sesión antes de generar la constancia', async () => {
  const s = servicio(false)
  assert.equal((await s.descargar()).status, 403)
  assert.equal((await s.descargar('')).status, 401)
  assert.equal(s.documentos, 0)
})
