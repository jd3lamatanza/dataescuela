import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avanceBoletin, leerBoletin } from '../src/lib/estadisticaBoletin.ts'

const cab = 'Clave del establecimiento;CUE;Nombre del establecimiento;Completo;Parcial;Sin carga'
const csv = (filas, fecha = '06-11-2026') => `\ufeff\n"Estudiantes con Boletín Digital incompleto al ${fecha} - 2do trimestre - LA MATANZA-Primario"\n\n"F"\n"x"\n\n${cab}\n${filas}\n\nNota`

test('importa boletines y trimestre', async () => {
  const d = await leerBoletin(csv('0069PP0001;1;Uno;424;0;2\n0069PP0002;2;Dos;;1;'))
  assert.equal(d.fecha, '2026-11-06')
  assert.equal(d.trimestre, '2do trimestre')
  assert.deepEqual(d.filas, [{ clave: '0069PP0001', completo: 424, parcial: 0, sin_carga: 2 }, { clave: '0069PP0002', completo: null, parcial: 1, sin_carga: null }])
})

test('rechaza datos inválidos', async () => {
  const f = '0069PP0001;1;Uno;1;2;3'
  await assert.rejects(leerBoletin(csv(f, '31-02-2026')), /fecha/)
  await assert.rejects(leerBoletin(csv(f).replace('Parcial', 'Otra')), /columnas/)
  await assert.rejects(leerBoletin(csv('0069PP0001;1;Uno;-1;2;3')), /inválido/)
  await assert.rejects(leerBoletin(csv(`${f}\n${f}`)), /repetida/)
})

test('avance es completo sobre el total', () => {
  assert.equal(avanceBoletin({ clave: 'x', completo: 50, parcial: 25, sin_carga: 25 }), 50)
  assert.equal(avanceBoletin({ clave: 'x', completo: 0, parcial: 0, sin_carga: 0 }), null)
})
