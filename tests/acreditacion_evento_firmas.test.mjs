import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function servicio(rol = 'distrital', real = rol, opciones = {}) {
  let handler
  const llamadas = []
  const subidas = []
  const borradas = []
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor-ficticio' } }, error: null }) },
    rpc: async (name) => ({ data: name === 'mi_perfil' ? { id: real === rol ? 'actor-ficticio' : 'inspector-ficticio', name: opciones.nombre ?? 'Inspector Ficticio', role: rol } : real, error: null }),
  }
  const admin = { from: () => ({ insert: async (data) => { llamadas.push({ name: 'insertar', args: data }); return { error: opciones.duplicado ? { code: '23505', message: 'acreditacion_firma_areal_unica' } : null } } }), rpc: async (name, args) => {
    llamadas.push({ name, args })
    return name === 'acreditacion_firmas_usuario'
      ? { data: args.p_ids ? (args.p_ids.includes(1) ? [{ id: 1, nombre: 'Firma', mime: 'image/png', base64: null, drive_file_id: 'ficticio' }] : []) : (opciones.yaCargada ? [{ id: 1 }] : []), error: null }
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
    drive: { tokenDrive: async () => 'token', descargarFirma: async () => 'imagen-fija', validarImagen: () => new Uint8Array([1]), subirFirma: async (_token, nombre) => { subidas.push(nombre); return 'archivo-ficticio' }, borrarFirma: async (_token, id) => { borradas.push(id); if (opciones.errorLimpieza) throw new Error('Error ficticio') } },
    seleccion: { validarFirmas: (ids) => ids, comprobarFirmas: (ids, firmas) => { if (ids.length !== firmas.length) throw new Error('Firma no disponible') } },
    Uint8Array, Request, Response, URL, console,
  })
  const enviar = (body) => handler(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer ficticio', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  return { enviar, llamadas, subidas, borradas }
}

test('al crear un evento copia las firmas seleccionadas y registra al actor autorizado', async () => {
  const s = servicio()
  const r = await s.enviar({ action: 'guardar_evento', evento: { id: null, nombre: 'Evento ficticio' }, firmas: [1] })
  assert.equal(r.status, 200)
  assert.equal(s.llamadas[0].name, 'acreditacion_firmas_usuario')
  assert.equal(s.llamadas[1].name, 'acreditacion_guardar_evento_firmado')
  assert.equal(s.llamadas[1].args.p_usuario, 'actor-ficticio')
  assert.equal(s.llamadas[1].args.p_firmas[0].base64, 'imagen-fija')
})

test('un inspector solo puede seleccionar firmas de su biblioteca', async () => {
  const s = servicio('areal')
  const propia = await s.enviar({ action: 'guardar_evento', evento: { id: null, nombre: 'Evento ficticio' }, firmas: [1] })
  assert.equal(propia.status, 200)
  assert.equal(s.llamadas[0].args.p_usuario, 'actor-ficticio')
  const otra = await s.enviar({ action: 'guardar_evento', evento: { id: null, nombre: 'Evento ficticio' }, firmas: [2] })
  assert.notEqual(otra.status, 200)
  assert.equal(s.llamadas.filter((c) => c.name === 'acreditacion_guardar_evento_firmado').length, 1)
})

test('una escuela no puede fijar firmas de eventos', async () => {
  const s = servicio('escolar')
  const r = await s.enviar({ action: 'configurar_evento', id: 'evento', firmas: [1] })
  assert.equal(r.status, 403)
  assert.equal(s.llamadas.length, 0)
})

test('distrital en ingreso simulado usa la identidad del inspector al guardar su firma', async () => {
  const s = servicio('areal', 'distrital')
  const r = await s.enviar({ action: 'cargar', nombre: 'Nombre adulterado', mime: 'image/png', base64: 'ficticio' })
  assert.equal(r.status, 200)
  assert.equal(s.subidas[0], 'Inspector Ficticio')
  assert.equal(s.llamadas.find((c) => c.name === 'insertar').args.propietario_id, 'inspector-ficticio')
  assert.equal(s.llamadas.find((c) => c.name === 'insertar').args.nombre, 'Inspector Ficticio')
})

test('el evento creado durante una simulación pertenece al inspector y no al actor distrital', async () => {
  const s = servicio('areal', 'distrital')
  const r = await s.enviar({ action: 'guardar_evento', evento: { id: null, nombre: 'Evento ficticio' }, firmas: [1] })
  assert.equal(r.status, 200)
  assert.equal(s.llamadas[0].args.p_usuario, 'inspector-ficticio')
  assert.equal(s.llamadas[1].args.p_usuario, 'inspector-ficticio')
})

test('no se admiten otras combinaciones de roles', async () => {
  const s = servicio('areal', 'escolar')
  assert.equal((await s.enviar({ action: 'listar' })).status, 403)
  assert.equal(s.llamadas.length, 0)
})

test('no admite una segunda firma areal y limpia el archivo si hubo una carrera', async () => {
  const ya = servicio('areal', 'areal', { yaCargada: true })
  assert.equal((await ya.enviar({ action: 'cargar', mime: 'image/png', base64: 'ficticio' })).status, 409)
  assert.equal(ya.subidas.length, 0)
  const carrera = servicio('areal', 'areal', { duplicado: true })
  assert.equal((await carrera.enviar({ action: 'cargar', mime: 'image/png', base64: 'ficticio' })).status, 409)
  assert.deepEqual(carrera.borradas, ['archivo-ficticio'])
})

test('avisa si no se pudo limpiar una firma rechazada', async () => {
  const s = servicio('areal', 'areal', { duplicado: true, errorLimpieza: true })
  const r = await s.enviar({ action: 'cargar', mime: 'image/png', base64: 'ficticio' })
  assert.equal(r.status, 503)
  assert.match((await r.json()).error, /limpiar el archivo en Drive/)
})

test('rechaza un nombre de perfil areal inválido en vez de aceptar el nombre enviado', async () => {
  const s = servicio('areal', 'areal', { nombre: ' ' })
  const r = await s.enviar({ action: 'cargar', nombre: 'Nombre adulterado', mime: 'image/png', base64: 'ficticio' })
  assert.equal(r.status, 400)
  assert.equal(s.subidas.length, 0)
})

test('distrital conserva la carga de firmas con nombre elegido', async () => {
  const s = servicio()
  const r = await s.enviar({ action: 'cargar', nombre: 'Firma distrital', mime: 'image/png', base64: 'ficticio' })
  assert.equal(r.status, 200)
  assert.equal(s.subidas[0], 'Firma distrital')
  assert.equal(s.llamadas.find((c) => c.name === 'insertar').args.propietario_id, null)
})
