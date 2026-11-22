import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const compilar = (ruta) => ts.transpileModule(readFileSync(new URL(ruta, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const dataUrl = (codigo) => `data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`
const calendarioUrl = dataUrl(compilar('../src/lib/calendarioDistrital.ts'))
const codigo = compilar('../src/lib/eventosEscolares.ts')
  .replace("import { supabase } from './supabase';", 'const supabase = globalThis.__supabaseEventosTest;')
  .replace("'./calendarioDistrital'", JSON.stringify(calendarioUrl))
const llamadas = []
globalThis.__supabaseEventosTest = { rpc(nombre, params) {
  let desde = 0, hasta = 0
  const query = {
    select() { return query }, order() { return query },
    range(a, b) { desde = a; hasta = b; return query },
    then(resolve) {
      llamadas.push({ nombre, params, desde, hasta })
      const datos = Array.from({ length: 501 }, (_, i) => ({ id: i + 1 })).slice(desde, hasta + 1)
      return Promise.resolve({ data: datos, error: null }).then(resolve)
    },
  }
  return query
} }
const { leerRealizaciones, registrosEventosEscolares, tablaSeguimiento } = await import(dataUrl(codigo))

test('página realizaciones sin truncar y transmite los filtros al servidor', async () => {
  const filas = await leerRealizaciones('2026-03-01', '2026-03-31', undefined, 7)
  assert.equal(filas.length, 501)
  assert.deepEqual(llamadas.map((c) => c.desde), [0, 500])
  assert.deepEqual(llamadas[0].params, { p_desde: '2026-03-01', p_hasta: '2026-03-31', p_id: null, p_evento: 7 })
})

test('calendario conserva horarios, escuelas articuladas y detalle analítico', () => {
  const [registro] = registrosEventosEscolares([{
    id: 12, evento: 'Jornada', fecha: '2026-03-07', escuela_clave: 'EP1', escuela_tipo: 'EP',
    escuela_numero: 1, escuela_nombre: 'Primaria', articulada_id: 2, articulada_clave: 'ES2',
    articulada_tipo: 'ES', articulada_numero: 2, articulada_nombre: 'Secundaria', lugar: 'Patio',
    hora_inicio: '09:30:00', hora_fin: '11:00:00', objetivos: 'Encuentro', observaciones: 'Invitados',
    created_at: '2026-03-01', updated_at: '2026-03-02',
  }])
  assert.equal(registro.fuente, 'evento-escolar')
  assert.equal(registro.fecha, '2026-03-07')
  assert.match(registro.descripcion, /09:30 a 11:00/)
  assert.match(registro.descripcion, /Articulado con ES2/)
  assert.equal(registro.enlace, '/eventos-escolares?realizacion=12')
  assert.ok(registro.detalles.some((c) => c.etiqueta === 'Objetivos' && c.valor === 'Encuentro'))
  assert.ok(registro.detalles.some((c) => c.etiqueta === 'Observaciones' && c.valor === 'Invitados'))
})

test('el seguimiento exportable distingue escuela cargada y pendiente', () => {
  const base = { clave: 'EP1', cue: '12345678', tipo: 'EP', numero: 1, nombre: 'Primaria', nivel: 'Primario', modalidad: null, localidad: 'Centro' }
  const tabla = tablaSeguimiento([{ ...base, id: 1, cargado: true }, { ...base, id: 2, cargado: false }], 'Jornada', 'Distrito')
  assert.match(tabla.subtitle, /Jornada/)
  assert.deepEqual(tabla.rows.map((r) => r.at(-1)), ['Cargado', 'Pendiente'])
})
