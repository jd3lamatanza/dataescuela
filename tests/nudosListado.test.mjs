import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contarSinNudo, filtrarNudos, paginarGrupos, tablaNudos } from '../src/lib/nudosListado.ts'

const nudos = [
  { id: 1, nombre: 'Sin Nudo', activo: true },
  { id: 2, nombre: 'Nudo Sur', activo: true },
  { id: 3, nombre: 'Nudo Norte', activo: true },
]
const escuela = (id, nudo_id, clave, nombre, localidad) => ({ id, nudo_id, clave, nombre, localidad, tipo: 'EP', numero: id })
const escuelas = [
  escuela(1, 1, 'EP02', 'Alba', 'Catán'),
  escuela(2, null, 'EP01', 'Sol', 'Virrey'),
  escuela(3, 2, 'EP03', 'Zeta', 'Catán'),
  escuela(4, 2, 'EP04', 'Alba', 'Virrey'),
]
const base = { busqueda: '', nudo: '', localidad: '', orden: 'clave', descendente: false }

test('cuenta tanto la referencia vacía como el nudo provisional', () => {
  assert.equal(contarSinNudo(nudos, escuelas), 2)
  const grupos = filtrarNudos(nudos, escuelas, { ...base, nudo: 'sin-asignar' })
  assert.deepEqual(grupos.flatMap((g) => g.escuelas.map((e) => e.id)).sort(), [1, 2])
})

test('filtra por nudo, localidad y búsqueda sin acentos y ordena dentro de cada nudo', () => {
  const filtrados = filtrarNudos(nudos, escuelas, { ...base, nudo: '2', localidad: 'Catán', busqueda: 'catan' })
  assert.deepEqual(filtrados.flatMap((g) => g.escuelas.map((e) => e.id)), [3])
  const ordenados = filtrarNudos(nudos, escuelas, { ...base, nudo: '2', orden: 'nombre', descendente: true })
  assert.deepEqual(ordenados[0].escuelas.map((e) => e.nombre), ['Zeta', 'Alba'])
  assert.equal(filtrarNudos(nudos, escuelas, { ...base, busqueda: 'inexistente' }).length, 0)
  assert.equal(filtrarNudos(nudos, escuelas, { ...base, busqueda: 'nudo norte' })[0].escuelas.length, 0)
})

test('la exportación incluye todos los resultados filtrados y nudos vacíos', () => {
  const muchos = Array.from({ length: 520 }, (_, i) => escuela(i + 10, 2, `EP${i}`, 'Sol', 'Catán'))
  const grupos = filtrarNudos(nudos, muchos, { ...base, nudo: '2' })
  const tabla = tablaNudos(grupos, { ...base, nudo: '2' }, 'Distrito')
  assert.equal(tabla.rows.length, 520)
  assert.deepEqual(tabla.headers, ['Nudo', 'Clave', 'Escuela', 'Localidad'])
  assert.ok(tabla.subtitle.includes('Nudo Sur'))
  const vacio = tablaNudos(filtrarNudos(nudos, [], { ...base, nudo: '3' }), { ...base, nudo: '3' }, 'Distrito')
  assert.deepEqual(vacio.rows, [['Nudo Norte', '', 'Sin escuelas asociadas', '']])
})

test('los circuitos cuentan la opción provisional y exportan sus propios nombres', () => {
  const circuitos = [{ id: 1, nombre: 'Sin Circuito', activo: true }, { id: 2, nombre: 'Circuito 36', activo: true }]
  assert.equal(contarSinNudo(circuitos, escuelas, 'circuito'), 2)
  const filtros = { ...base, nudo: 'sin-asignar' }
  const grupos = filtrarNudos(circuitos, escuelas, filtros, 'circuito')
  assert.deepEqual(grupos.flatMap((g) => g.escuelas.map((e) => e.id)).sort(), [1, 2])
  const tabla = tablaNudos(grupos, filtros, 'Distrito', 'circuito')
  assert.equal(tabla.title, 'Escuelas por circuito')
  assert.equal(tabla.headers[0], 'Circuito')
})

test('ocultar sin circuito excluye escuelas sin referencia y con circuito provisional de lista y exportación', () => {
  const circuitos = [{ id: 1, nombre: 'Sin Circuito', activo: true }, { id: 2, nombre: 'Circuito 36', activo: true }]
  const filtros = { ...base, ocultarSinAsignar: true }
  const grupos = filtrarNudos(circuitos, escuelas, filtros, 'circuito')
  assert.deepEqual(grupos.flatMap((g) => g.escuelas.map((e) => e.id)), [3, 4])
  const tabla = tablaNudos(grupos, filtros, 'Distrito', 'circuito')
  assert.equal(tabla.rows.length, 2)
  assert.ok(tabla.subtitle.includes('Sin circuito asignado: ocultos'))
})

test('pagina escuelas dentro de un circuito y conserva circuitos vacíos; exporta todos los resultados', () => {
  const muchos = Array.from({ length: 32 }, (_, i) => escuela(i + 10, 2, `EP${i}`, 'Sol', 'Catán'))
  const grupos = filtrarNudos(nudos, muchos, base)
  const primera = paginarGrupos(grupos, 1, 15)
  const segunda = paginarGrupos(grupos, 2, 15)
  const ultima = paginarGrupos(grupos, 3, 15)
  assert.equal(primera.total, 34)
  assert.equal(segunda.total, 34)
  assert.equal(ultima.visibles.reduce((n, g) => n + Math.max(1, g.escuelas.length), 0), 4)
  assert.equal(tablaNudos(grupos, base, 'Distrito').rows.length, 34)
  const ids = [primera, segunda, ultima].flatMap((p) => p.visibles.flatMap((g) => g.escuelas.map((e) => e.id)))
  assert.equal(ids.length, 32)
  assert.equal(new Set(ids).size, 32)
})
