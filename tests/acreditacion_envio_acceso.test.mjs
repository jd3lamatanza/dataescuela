import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function servicio(rol) {
  let handler
  let documentos = 0
  const user = { auth: { getUser: async () => ({ data: { user: { id: 'ficticio' } }, error: null }) }, rpc: async () => ({ data: rol, error: null }) }
  const source = readFileSync(new URL('../supabase/functions/acreditacion-constancia/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'", 'const SMTPClient = globalThis.SMTPClient')
    .replace("import { remitente, validarConfiguracion, type ConfiguracionEmail } from '../_shared/configuracion-email.ts'", 'const { remitente, validarConfiguracion } = globalThis.config')
    .replace("import { prepararConstancia } from '../_shared/acreditacion-documento.ts'", 'const prepararConstancia = globalThis.prepararConstancia')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', SMTP_USERNAME: 'fake', SMTP_PASSWORD: 'fake' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : {},
    prepararConstancia: async () => { documentos++; throw new Error('No debe generar un PDF') },
    SMTPClient: class {}, config: {}, Request, Response, URL, console,
  })
  return {
    enviar: () => handler(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer ficticio', 'Content-Type': 'application/json' }, body: JSON.stringify({ evento: 'fedcba98-1234-4abc-8123-123456789abc', persona: 1 }) })),
    get documentos() { return documentos },
  }
}

test('el rol areal no puede enviar constancias', async () => {
  const s = servicio('areal')
  const r = await s.enviar()
  assert.equal(r.status, 403)
  assert.equal(s.documentos, 0)
})
