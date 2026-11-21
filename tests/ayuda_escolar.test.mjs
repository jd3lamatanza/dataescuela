import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buscarGuias } from '../src/lib/ayudaEscolar.ts'
import { canAccess, canAccessUser, MODULES, ROLES } from '../src/modules.ts'
import { agruparMenuDistrital } from '../src/ui/sidebarDistrital.ts'

const migration = readFileSync(new URL('../supabase/migrations/0064_ayuda_escolar.sql', import.meta.url), 'utf8')
const seed = JSON.parse(migration.match(/\$ayuda\$([\s\S]*?)\$ayuda\$/)[1])

test('se conservan todas las guías actuales y el editor requiere permiso avanzado en Sistema', () => {
  const ayuda = MODULES.find((m) => m.id === 'ayuda-escolar')
  const editor = MODULES.find((m) => m.id === 'ayuda-distrital')
  for (const rol of ROLES) {
    assert.equal(canAccess(ayuda, rol), rol === 'escolar')
    assert.equal(canAccess(editor, rol), rol === 'distrital')
  }
  assert.equal(canAccessUser(editor, { role: 'distrital', permiso_avanzado: false }), false)
  assert.equal(canAccessUser(editor, { role: 'distrital', permiso_avanzado: true }), true)
  assert.ok(agruparMenuDistrital([editor]).find((g) => g.id === 'sistema')?.modulos.includes(editor))
  const modulos = MODULES.filter((m) => canAccess(m, 'escolar') && m.id !== 'ayuda-escolar').map((m) => m.id).sort()
  assert.deepEqual(seed.map((g) => g.modulo).sort(), modulos)
  assert.ok(seed.every((g) => g.captura_drive && g.secciones.length))
})

test('la búsqueda utiliza los textos editados y admite búsquedas sin tildes', () => {
  assert.ok(buscarGuias(seed, 'importar nomina').some((g) => g.modulo === 'articulacion'))
  const editada = [{ ...seed[0], titulo: 'Consulta especial', descripcion: 'Información nueva' }]
  assert.equal(buscarGuias(editada, 'informacion nueva').length, 1)
  assert.equal(buscarGuias(editada, 'termino inexistente').length, 0)
})

function cargarFuncion(nombre, entorno) {
  let handler
  const source = readFileSync(new URL(`../supabase/functions/${nombre}/index.ts`, import.meta.url), 'utf8')
    .replace("import { createClient } from 'npm:@supabase/supabase-js@2'", 'const createClient = globalThis.createClient')
    .replace(/import \{ ([^}]+) \} from '\.\.\/_shared\/firmas-drive\.ts'/, 'const { $1 } = globalThis.drive')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  runInNewContext(js, {
    Deno: { env: { get: (name) => ({ APP_PUBLIC_URL: 'https://app.example', SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon' })[name] }, serve: (fn) => { handler = fn } },
    createClient: () => entorno.user, drive: entorno.drive, fetch: entorno.fetch, crypto, Uint8Array, Blob, Request, Response, URL, TextEncoder, console,
  })
  return (body) => handler(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer prueba', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
}

function lectura({ rol = 'escolar', real = rol, avanzado = false, carpeta = true, png = true } = {}) {
  const bytes = Uint8Array.from(png ? [137, 80, 78, 71, 13, 10, 26, 10] : [1, 2, 3])
  const llamadas = []
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
    rpc: async (name) => ({ data: name === 'mi_perfil' ? { role: rol } : name === 'real_role' ? real : avanzado, error: null }),
    from: () => ({ select: () => ({ eq: (_key, id) => ({ maybeSingle: async () => ({ data: seed.find((g) => g.id === id) ?? null, error: null }) }) }) }),
  }
  const enviar = cargarFuncion('ayuda-captura', {
    user, drive: { tokenDrive: async () => 'ficticio' },
    fetch: async (url) => {
      llamadas.push(url)
      return url.includes('alt=media') ? new Response(bytes) : Response.json({ mimeType: 'image/png', parents: [carpeta ? '1HChSKnfT-wXedYF98-t08i5vFwCdx5m3' : 'otra'], trashed: false, size: String(bytes.length) })
    },
  })
  return { enviar, llamadas }
}

test('las capturas permiten Escolar, simulación y Distrital avanzado; rechazan otros roles', async () => {
  for (const s of [lectura(), lectura({ rol: 'escolar', real: 'distrital' }), lectura({ rol: 'distrital', avanzado: true })]) {
    const r = await s.enviar({ captura: 'inicio' })
    assert.equal(r.status, 200)
    assert.equal(r.headers.get('Content-Type'), 'application/octet-stream')
  }
  for (const s of [lectura({ rol: 'areal' }), lectura({ rol: 'distrital' }), lectura({ rol: 'escolar', real: 'areal' })]) {
    assert.equal((await s.enviar({ captura: 'inicio' })).status, 403)
    assert.equal(s.llamadas.length, 0)
  }
})

test('las capturas deben existir en la carpeta y contener PNG válido', async () => {
  const desconocida = lectura()
  assert.equal((await desconocida.enviar({ captura: '__proto__' })).status, 404)
  assert.equal(desconocida.llamadas.length, 0)
  assert.equal((await lectura({ carpeta: false }).enviar({ captura: 'inicio' })).status, 503)
  assert.equal((await lectura({ png: false }).enviar({ captura: 'inicio' })).status, 503)
})

function gestion({ permitido = true, conflicto = false } = {}) {
  const rows = new Map(seed.map((g) => [g.id, { ...g, version: 1 }]))
  const borradas = [], subidas = []
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
    rpc: async () => ({ data: permitido, error: null }),
    from: () => {
      let action, payload, id, version
      const builder = {
        select() { if (!action) action = 'select'; return this },
        insert(v) { action = 'insert'; payload = v; return this },
        update(v) { action = 'update'; payload = v; return this },
        delete() { action = 'delete'; return this },
        eq(key, value) { if (key === 'id') id = value; else if (key === 'version') version = value; return this },
        async single() { const data = { ...payload, id: 'nueva', version: 1 }; rows.set(data.id, data); return { data, error: null } },
        async maybeSingle() {
          const current = rows.get(id)
          if (action === 'select') return { data: current ?? null, error: null }
          if (!current || current.version !== version || conflicto) return { data: null, error: null }
          if (action === 'delete') { rows.delete(id); return { data: { id }, error: null } }
          const data = { ...current, ...payload }; rows.set(id, data); return { data, error: null }
        },
      }
      return builder
    },
  }
  const enviar = cargarFuncion('ayuda-gestionar', {
    user,
    drive: { tokenDrive: async () => 'token', validarImagen: (mime, data) => {
      if (mime !== 'image/png' || data !== 'png-valido') throw Error('imagen inválida')
      return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    }, borrarFirma: async (_token, id) => { borradas.push(id) } },
    fetch: async () => { subidas.push(true); return Response.json({ id: 'captura_nueva_123' }) },
  })
  return { enviar, rows, subidas, borradas }
}

test('el editor restringe escritura y permite crear, editar y eliminar', async () => {
  const guia = { modulo: 'inicio', titulo: 'Nueva guía', descripcion: 'Descripción', secciones: [{ titulo: 'Pasos', pasos: ['Primer paso'] }] }
  assert.equal((await gestion({ permitido: false }).enviar({ accion: 'guardar', guia })).status, 403)
  const s = gestion()
  const creado = await s.enviar({ accion: 'guardar', guia, imagen: { mime: 'image/png', base64: 'png-valido' } })
  assert.equal(creado.status, 200)
  const nueva = (await creado.json()).guia
  assert.equal(nueva.captura_drive, 'captura_nueva_123')
  const editado = await s.enviar({ accion: 'guardar', guia: { ...nueva, titulo: 'Editada' }, quitar_captura: true })
  assert.equal(editado.status, 200)
  const actual = (await editado.json()).guia
  assert.equal(actual.titulo, 'Editada')
  assert.equal(actual.captura_drive, null)
  assert.equal(actual.version, 2)
  assert.equal((await s.enviar({ accion: 'eliminar', guia: { id: actual.id, version: 2 } })).status, 200)
  assert.equal(s.rows.has(actual.id), false)
  assert.deepEqual(s.borradas, [])
})

test('valida contenido, captura y conflictos sin sobrescribir cambios ajenos', async () => {
  const s = gestion()
  const guia = { ...seed[0], version: 1 }
  assert.equal((await s.enviar({ accion: 'guardar', guia: { ...guia, secciones: [] } })).status, 400)
  assert.equal((await s.enviar({ accion: 'guardar', guia, imagen: { mime: 'image/png', base64: 'no' } })).status, 400)
  assert.equal((await s.enviar({ accion: 'guardar', guia: { ...guia, version: 2 }, imagen: { mime: 'image/png', base64: 'png-valido' } })).status, 409)
  assert.equal(s.subidas.length, 0)
  const carrera = gestion({ conflicto: true })
  assert.equal((await carrera.enviar({ accion: 'guardar', guia, imagen: { mime: 'image/png', base64: 'png-valido' } })).status, 409)
  assert.deepEqual(carrera.borradas, ['captura_nueva_123'])
})
