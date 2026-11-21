import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { GUIAS_ESCOLARES, buscarGuias } from '../src/lib/ayudaEscolar.ts'
import { canAccess, MODULES, ROLES } from '../src/modules.ts'

test('la ayuda cubre todos los módulos escolares y solo es accesible para Escolar', () => {
  const ayuda = MODULES.find((m) => m.id === 'ayuda-escolar')
  assert.ok(ayuda)
  for (const rol of ROLES) assert.equal(canAccess(ayuda, rol), rol === 'escolar')
  const modulos = MODULES.filter((m) => canAccess(m, 'escolar') && m.id !== 'ayuda-escolar').map((m) => m.id).sort()
  assert.deepEqual(GUIAS_ESCOLARES.map((g) => g.modulo).sort(), modulos)
  assert.ok(GUIAS_ESCOLARES.every((g) => g.captura && g.secciones.length && g.secciones.every((s) => s.pasos.length)))
})

test('la búsqueda encuentra acciones y admite búsquedas sin tildes', () => {
  assert.ok(buscarGuias('importar nomina').some((g) => g.modulo === 'articulacion'))
  assert.ok(buscarGuias('constancia pdf').some((g) => g.modulo === 'acreditacion'))
  assert.equal(buscarGuias('termino inexistente').length, 0)
})

function servicio({ rol = 'escolar', real = rol, usuario = true, carpeta = true, png = true } = {}) {
  let handler
  const llamadas = []
  const bytes = Uint8Array.from(png ? [137, 80, 78, 71, 13, 10, 26, 10] : [1, 2, 3])
  const user = {
    auth: { getUser: async () => ({ data: { user: usuario ? { id: 'actor' } : null }, error: null }) },
    rpc: async (name) => ({ data: name === 'mi_perfil' ? { role: rol } : real, error: null }),
  }
  const source = readFileSync(new URL('../supabase/functions/ayuda-captura/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { tokenDrive } from '../_shared/firmas-drive.ts'", 'const tokenDrive = globalThis.tokenDrive')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon' })[name] }, serve: (fn) => { handler = fn } },
    createClient: () => user, tokenDrive: async () => 'ficticio',
    fetch: async (url) => {
      llamadas.push(url)
      return url.includes('alt=media') ? new Response(bytes) : Response.json({ mimeType: 'image/png', parents: [carpeta ? '1HChSKnfT-wXedYF98-t08i5vFwCdx5m3' : 'otra'], trashed: false, size: String(bytes.length) })
    },
    Uint8Array, Request, Response, URL, console,
  })
  return {
    llamadas,
    enviar: (body, authorization = 'Bearer prueba') => handler(new Request('https://example.test', {
      method: 'POST', headers: { authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })),
  }
}

test('solo Escolar y la simulación distrital autorizada pueden obtener capturas', async () => {
  for (const s of [servicio(), servicio({ rol: 'escolar', real: 'distrital' })]) {
    const r = await s.enviar({ captura: 'inicio' })
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('Content-Type'), 'application/octet-stream')
    assert.equal((await r.arrayBuffer()).byteLength, 8)
  }
  for (const s of [servicio({ rol: 'areal' }), servicio({ rol: 'escolar', real: 'areal' }), servicio({ usuario: false })]) {
    const r = await s.enviar({ captura: 'inicio' })
    assert.ok([401, 403].includes(r.status))
    assert.equal(s.llamadas.length, 0)
  }
})

test('cada guía puede solicitar su captura', async () => {
  const s = servicio()
  for (const guia of GUIAS_ESCOLARES) assert.equal((await s.enviar({ captura: guia.captura })).status, 200, guia.id)
})

test('rechaza capturas no autorizadas, fuera de la carpeta o con contenido inválido', async () => {
  const desconocida = servicio()
  assert.equal((await desconocida.enviar({ captura: '__proto__' })).status, 404)
  assert.equal(desconocida.llamadas.length, 0)
  const ajena = servicio({ carpeta: false })
  assert.equal((await ajena.enviar({ captura: 'inicio' })).status, 503)
  assert.equal(ajena.llamadas.length, 1)
  assert.equal((await servicio({ png: false }).enviar({ captura: 'inicio' })).status, 503)
})
