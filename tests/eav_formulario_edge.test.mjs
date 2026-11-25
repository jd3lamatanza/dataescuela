import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'

function servicio({ activo = true, resultado = 'ok', errorEstado = null } = {}) {
  let handler
  const llamadas = []
  const db = {
    rpc: async (name) => {
      llamadas.push(name)
      if (name === 'eav_formulario_estado') return { data: activo, error: errorEstado }
      if (name === 'eav_preinscripcion_permitir') return { data: true, error: null }
      return { data: resultado, error: null }
    },
    from: (name) => {
      llamadas.push(name)
      const q = { select: () => q, order: () => q, range: async () => ({ data: [{ id: 1 }], error: null }) }
      return q
    },
  }
  const source = readFileSync(new URL('../supabase/functions/eav-preinscripcion/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'ficticio' })[name] }, serve: (fn) => { handler = fn } },
    createClient: () => db, crypto: webcrypto, TextEncoder, Uint8Array, Request, Response, URL, console,
  })
  const solicitar = (body) => handler(new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { solicitar, llamadas }
}

test('el formulario cerrado no entrega escuelas y el activo mantiene la respuesta', async () => {
  const cerrado = servicio({ activo: false })
  const respuesta = await cerrado.solicitar({ action: 'escuelas' })
  assert.deepEqual(await respuesta.json(), { activo: false })
  assert.deepEqual(cerrado.llamadas, ['eav_formulario_estado'])
  const activo = servicio()
  assert.deepEqual(await (await activo.solicitar({ action: 'escuelas' })).json(), { activo: true, escuelas: [{ id: 1 }] })
})

test('el cierre durante el llenado rechaza el envío con mensaje claro', async () => {
  const s = servicio({ resultado: 'cerrado' })
  const r = await s.solicitar({ action: 'enviar', form: {} })
  assert.equal(r.status, 409)
  assert.match((await r.json()).error, /cerrada/)
  assert.ok(s.llamadas.includes('eav_preinscribir'))
})

test('el fallo o estado inválido no habilitan el formulario', async () => {
  for (const opciones of [{ errorEstado: new Error('error ficticio') }, { activo: null }]) {
    const s = servicio(opciones)
    const r = await s.solicitar({ action: 'escuelas' })
    assert.equal(r.status, 503)
    assert.ok(!s.llamadas.includes('escuelas'))
  }
})
