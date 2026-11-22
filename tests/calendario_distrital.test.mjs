import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fechaPosesion, leerPaginas, mostrarEventoCalendario, mostrarRegistroCalendario, registrosDistritales, sinEventosDeSalidas } from '../src/lib/calendarioDistrital.ts'

const datos = {
  acreditaciones: [{ id: 'a', nombre: 'Capacitación', fecha: '2026-03-05', lugar: 'Sede', descripcion: 'Reunión', hora_inicio: '09:00:00', hora_fin: '11:00:00', estado: 'activo' }],
  salidas: [
    { id: 1, fecha: '2026-03-05', titulo: 'Museo', destino: 'Museo', escuela: 'Escuela ejemplo', clave: 'EP 999', evento_id: 8, estado: { nombre: 'Aprobada' } },
    { id: 2, fecha: '2026-03-05', titulo: 'Teatro', destino: 'Teatro', escuela: 'Escuela ejemplo', clave: null, evento_id: null, estado: { nombre: 'Rechazada' } },
  ],
  labores: [{ id: 3, fecha: '2026-03-06', motivo: 'Visita', autor: 'Inspector ejemplo', lugar: { nombre: 'Escuela' }, evento: { nombre: 'Visita a Escuela' } }],
  disposiciones: [{ id: 4, fecha_designacion: '2026-02-28', fecha_desde: '2026-03-05', docente_nombre: 'Docente ejemplo', escuela_cubrir_clave: 'EP 999', escuela_cubrir_nombre: 'Escuela ejemplo', tipo: 'Adecuación', estado: 'Finalizada' }],
  periodos: [{ id: 5, ciclo: 2026, mes: 3, fecha_apertura: '2026-03-05', fecha_cierre: '2026-03-31', carga: false }],
  directivos: [{ id: 1, apellido_nombre: 'Directivo ejemplo', toma_posesion: '2026-03-05', activo: true, escuela: { clave: 'EP 999', nombre: 'Escuela ejemplo' } }],
  orientacion: [{ id: 2, apellido_nombre: 'Orientador ejemplo', toma_posesion: '05/03/2026', activo: false, escuela: null }],
  inspectores: [{ id: 3, nombre: 'Inspector ejemplo', fecha_toma_posesion: '06/03/2026', activo: true }],
}

test('incluye cada fuente y fecha administrativa dentro del rango con su estado y origen', () => {
  const rows = registrosDistritales(datos, '2026-03-01', '2026-03-31')
  assert.equal(rows.length, 10)
  assert.equal(rows.find((r) => r.id === 'salida-2').estado, 'Rechazada')
  assert.equal(rows.find((r) => r.id === 'disposicion-4-Inicio').fecha, '2026-03-05')
  assert.equal(rows.some((r) => r.id === 'disposicion-4-Designación'), false)
  assert.equal(rows.find((r) => r.id === 'matricula-5-Cierre').estado, 'Finalizado')
  assert.equal(rows.find((r) => r.id === 'labor-3').enlace, '/labores-distrito?labor=3')
  assert.equal(rows.filter((r) => r.fuente === 'posesion').length, 3)
})

test('no duplica salidas vinculadas y conserva eventos no relacionados', () => {
  assert.deepEqual(sinEventosDeSalidas([{ id: 8 }, { id: 9 }], [8]), [{ id: 9 }])
})

test('los filtros ocultan cada fuente y también los eventos de salidas no vinculados', () => {
  const salida = { id: 4, nombre: 'Salida Educativa' }
  const reunion = { id: 5, nombre: 'Reunión' }
  const ocultos = ['fuente-salida', 'evento-5']
  assert.equal(mostrarEventoCalendario(salida, ocultos, true), false)
  assert.equal(mostrarRegistroCalendario('salida', ocultos), false)
  assert.equal(mostrarEventoCalendario(reunion, ocultos, true), false)
  assert.equal(mostrarRegistroCalendario('contingencia', ocultos), true)
  assert.equal(mostrarEventoCalendario(salida, ocultos, false), true)
  assert.equal(mostrarEventoCalendario(salida, [], true), true)
})

test('interpreta fechas de posesión y rechaza fechas imposibles', () => {
  assert.equal(fechaPosesion(' 05/03/2026 '), '2026-03-05')
  assert.equal(fechaPosesion('2026-03-05'), '2026-03-05')
  assert.equal(fechaPosesion('31/02/2026'), null)
  assert.equal(fechaPosesion('no válida'), null)
})

test('lee más de mil registros y propaga fallos de páginas', async () => {
  const todas = Array.from({ length: 1101 }, (_, i) => i)
  const llamadas = []
  assert.deepEqual(await leerPaginas(async (a, b) => { llamadas.push([a, b]); return { data: todas.slice(a, b + 1), error: null } }), todas)
  assert.deepEqual(llamadas, [[0, 499], [500, 999], [1000, 1499]])
  await assert.rejects(() => leerPaginas(async () => ({ data: null, error: { message: 'Sin conexión' } })), /Sin conexión/)
})
