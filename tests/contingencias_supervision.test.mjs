import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consultarContingencias, leerContingencias, registrosContingencias, tablaContingencias } from '../src/lib/contingencias.ts'

const filtros = { busqueda: 'escuela', tipo: 'Duelo', suspension: 'total', desde: '2026-03-01', hasta: '2026-03-31' }
const fila = { id: 8, cue: '123', clave: 'EP 999', escuela: 'Escuela ejemplo', fecha: '2026-03-05', fecha_estimada: false,
  tipos: ['Duelo'], suspension: 'total', observaciones: 'Observación', created_at: '2026-03-06T00:00:00Z', turnos: ['Mañana', 'Tarde'] }

test('calendariza la fecha de contingencia con detalle y enlace directo', () => {
  const [r] = registrosContingencias([fila])
  assert.equal(r.fecha, '2026-03-05')
  assert.equal(r.fuente, 'contingencia')
  assert.equal(r.enlace, '/contingencias?contingencia=8')
  assert.match(r.descripcion, /Mañana, Tarde/)
  assert.match(registrosContingencias([{ ...fila, fecha_estimada: true }])[0].descripcion, /Fecha de carga/)
})

test('exporta todos los campos y explica las fechas estimadas', () => {
  const t = tablaContingencias([{ ...fila, fecha_estimada: true }], filtros, 'Organización')
  assert.equal(t.headers.length, 8)
  assert.deepEqual(t.rows[0], ['05/03/2026 (fecha de carga)', 'Escuela ejemplo', 'EP 999', '123', 'Duelo', 'Con Suspensión Total', 'Mañana, Tarde', 'Observación'])
  assert.match(t.subtitle, /Duelo/)
})

test('la exportación pagina todos los resultados y transmite exactamente los filtros', async () => {
  const llamadas = []
  const cliente = { rpc: async (nombre, p) => {
    llamadas.push([nombre, p])
    return { data: { total: 1101, filas: Array.from({ length: Math.min(500, 1101 - p.p_offset) }, (_, i) => ({ ...fila, id: p.p_offset + i })) }, error: null }
  } }
  const filas = await leerContingencias(cliente, filtros)
  assert.equal(filas.length, 1101)
  assert.deepEqual(llamadas.map(([, p]) => p.p_offset), [0, 500, 1000])
  assert.equal(llamadas[0][1].p_tipo, filtros.tipo)
  assert.equal(llamadas[0][1].p_desde, filtros.desde)
  await assert.rejects(() => consultarContingencias({ rpc: async () => ({ data: null, error: { message: 'Sin conexión' } }) }, filtros, 20, 0), /Sin conexión/)
})
