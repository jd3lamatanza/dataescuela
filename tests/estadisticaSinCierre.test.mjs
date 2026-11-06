import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerSinCierre } from '../src/lib/estadisticaSinCierre.ts'

const cab = 'Clave del establecimiento;CUE;Nombre del establecimiento;Matrícula sin cierre en los últimos dos ciclos lectivos'
const csv = (filas, fecha = '06-11-2026') => `\ufeff\n"Estudiantes con inscripción activa en años anteriores al ${fecha} - LA MATANZA-Secundario"\n\n"F"\n"x"\n\n${cab}\n${filas}\n\nNota`

test('importa matrícula sin cierre', async () => {
  const d = await leerSinCierre(csv('0069MS0001;1;Uno;12\n0069MS0003;2;Tres;0\n0069MS0004;3;Cuatro;'))
  assert.equal(d.fecha, '2026-11-06')
  assert.deepEqual(d.filas, [{ clave: '0069MS0001', sin_cierre: 12 }, { clave: '0069MS0003', sin_cierre: 0 }, { clave: '0069MS0004', sin_cierre: null }])
})

test('rechaza fecha, columnas, números y repetidas', async () => {
  const f = '0069MS0001;1;Uno;5'
  await assert.rejects(leerSinCierre(csv(f, '31-02-2026')), /fecha/)
  await assert.rejects(leerSinCierre(csv(f).replace('sin cierre', 'otra')), /columnas/)
  await assert.rejects(leerSinCierre(csv('0069MS0001;1;Uno;-1')), /inválido/)
  await assert.rejects(leerSinCierre(csv(`${f}\n${f}`)), /repetida/)
})
