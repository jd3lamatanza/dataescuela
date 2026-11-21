import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'

function servicio() {
  let handler
  const llamadas = []
  const db = { rpc: async (name, args) => {
    llamadas.push({ name, args })
    return { data: name === 'eav_preinscripcion_permitir' ? true : 'ok', error: null }
  } }
  const source = readFileSync(new URL('../supabase/functions/acreditacion-publica/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'ficticio' })[name] }, serve: (fn) => { handler = fn } },
    createClient: () => db, crypto: webcrypto, TextEncoder, Uint8Array, Request, Response, URL, console,
  })
  const enviar = (form) => handler(new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'registrar', evento: 'fedcba98-1234-4abc-8123-123456789abc', form }) }))
  return { enviar, llamadas }
}

test('el formulario público envía todas las asociaciones a la función transaccional', async () => {
  const s = servicio()
  const escuelas = [
    { escuela_id: 1, escuela_externa: null, cargo: 'Docente' },
    { escuela_id: null, escuela_externa: 'Escuela externa', cargo: 'Directora' },
  ]
  const r = await s.enviar({ nombre: 'Persona ficticia', dni: '99999888', email: 'ejemplo@abc.gob.ar', escuelas })
  assert.equal(r.status, 201)
  assert.equal(s.llamadas[1].name, 'acreditacion_registrar_multi')
  assert.deepEqual(JSON.parse(JSON.stringify(s.llamadas[1].args.p_escuelas)), escuelas)
  assert.equal(s.llamadas[1].args.p_publico, true)
})

test('los formularios públicos anteriores siguen usando las funciones existentes', async () => {
  for (const externa of [true, false]) {
    const s = servicio()
    const r = await s.enviar({ nombre: 'Persona ficticia', dni: '99999888', email: 'ejemplo@abc.gob.ar', cargo: 'Docente', escuela: 1, escuelaExterna: 'Escuela externa', externa })
    assert.equal(r.status, 201)
    assert.equal(s.llamadas[1].name, externa ? 'acreditacion_registrar_externa' : 'acreditacion_registrar')
  }
})
