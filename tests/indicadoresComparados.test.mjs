import { test } from 'node:test'
import assert from 'node:assert/strict'
import { completamiento, correlacion, deficitMatricula, porcentaje, porcentajeAgregado, prioridadConjunta } from '../src/lib/indicadoresComparados.ts'
import { CATEGORIAS_FICHA } from '../src/lib/estadisticaFichas.ts'

test('el déficit es una aproximación no negativa y requiere base positiva', () => {
  assert.equal(deficitMatricula(80, 100), 20)
  assert.equal(deficitMatricula(120, 100), 0)
  assert.equal(deficitMatricula(null, 100), null)
  assert.equal(deficitMatricula(0, 0), null)
  assert.equal(porcentaje(3, 0), null)
  assert.equal(porcentaje(null, 10), null)
})

test('completamiento promedia las categorías sin contar personas únicas', () => {
  const ficha = { clave: 'x', matricula: 100, ...Object.fromEntries(CATEGORIAS_FICHA.map((c) => [c.key, 20])) }
  assert.equal(completamiento(ficha, CATEGORIAS_FICHA), 80)
  assert.equal(completamiento({ ...ficha, salud: null }, CATEGORIAS_FICHA), null)
  assert.equal(completamiento({ ...ficha, salud: 101 }, CATEGORIAS_FICHA), null)
  assert.equal(completamiento({ ...ficha, matricula: 0 }, CATEGORIAS_FICHA), null)
  assert.equal(completamiento(undefined, CATEGORIAS_FICHA), null)
})

test('porcentajes agregados ponderan por matrícula y rechazan datos incompletos', () => {
  const datos = [{ matricula: 100, a: 10, b: 10 }, { matricula: 10, a: 0, b: 2 }]
  assert.equal(porcentajeAgregado(datos, ['a', 'b'], 'matricula'), 20)
  assert.equal(porcentajeAgregado([{ matricula: 100, a: null, b: 10 }], ['a', 'b'], 'matricula'), null)
  assert.equal(porcentajeAgregado([], ['a'], 'matricula'), null)
})

test('correlación usa pares completos y evita correlaciones indefinidas', () => {
  assert.equal(correlacion([[1, 2], [2, 4], [3, 6]]), 1)
  assert.equal(correlacion([[1, 6], [2, 4], [3, 2]]), -1)
  assert.equal(correlacion([[1, 2], [2, 3]]), null)
  assert.equal(correlacion([[1, 1], [1, 2], [1, 3]]), null)
})

test('prioridad conjunta usa ambos rangos, empates y datos completos', () => {
  assert.deepEqual(prioridadConjunta([[10, 10], [10, 5], [5, 5], [null, 8]]), [0.25, 1, 1.75, null])
  assert.deepEqual(prioridadConjunta([[20, 10], [80, 5]], true), [0, 1])
})
