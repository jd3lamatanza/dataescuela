import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function servicio(rol = 'distrital') {
  let handler
  const llamadas = []
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor-ficticio' } }, error: null }) },
    rpc: async () => ({ data: rol, error: null }),
  }
  const admin = { rpc: async (name, args) => {
    llamadas.push({ name, args })
    return name === 'acreditacion_firmas_datos'
      ? { data: [{ id: 1, nombre: 'Firma', mime: 'image/png', base64: null, drive_file_id: 'ficticio' }], error: null }
      : { data: null, error: null }
  } }
  const source = readFileSync(new URL('../supabase/functions/acreditacion-firmas/index.ts', import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace("import { borrarFirma, comprobarCarpeta, descargarFirma, subirFirma, tokenDrive, validarImagen } from '../_shared/firmas-drive.ts'", 'const { borrarFirma, comprobarCarpeta, descargarFirma, subirFirma, tokenDrive, validarImagen } = globalThis.drive')
    .replace("import { comprobarFirmas, validarFirmas } from '../_shared/firmas-seleccion.ts'", 'const { comprobarFirmas, validarFirmas } = globalThis.seleccion')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[name] }, serve: (fn) => { handler = fn } },
    createClient: (_url, key) => key === 'anon' ? user : admin,
    drive: { tokenDrive: async () => 'token', descargarFirma: async () => 'imagen-fija', validarImagen: () => new Uint8Array([1]) },
    seleccion: { validarFirmas: (ids) => ids, comprobarFirmas: () => {} },
    Uint8Array, Request, Response, URL, console,
  })
  const enviar = (body) => handler(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer ficticio', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { enviar, llamadas }
}

test('al crear un evento copia las firmas seleccionadas y registra al actor autorizado', async () => {
  const s = servicio()
  const r = await s.enviar({ action: 'guardar_evento', evento: { id: null, nombre: 'Evento ficticio' }, firmas: [1] })
  assert.equal(r.status, 200)
  assert.equal(s.llamadas[0].name, 'acreditacion_firmas_datos')
  assert.equal(s.llamadas[1].name, 'acreditacion_guardar_evento_firmado')
  assert.equal(s.llamadas[1].args.p_usuario, 'actor-ficticio')
  assert.equal(s.llamadas[1].args.p_firmas[0].base64, 'imagen-fija')
})

test('una escuela no puede fijar firmas de eventos', async () => {
  const s = servicio('escolar')
  const r = await s.enviar({ action: 'configurar_evento', id: 'evento', firmas: [1] })
  assert.equal(r.status, 403)
  assert.equal(s.llamadas.length, 0)
})
