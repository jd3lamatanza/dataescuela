import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diferencia, diferenciaPba, leerMatriculaPba } from '../src/lib/estadisticaPba.ts'

const cabecera = '"Clave del establecimiento";"CUE";"Nombre del establecimiento";"Matrícula activa 2026";"Matrícula inscripta 2025";"Matrícula relevamiento inicial 2026"'
const csv = (filas, fecha = '05-11-2026') => `\ufeff""\n"Matrícula activa al ${fecha} - LA MATANZA-Inicial"\n""\n${cabecera}\n${filas}\n\nNota de confidencialidad`

test('importa CSV con ceros, faltantes y claves con ceros iniciales', async () => {
  const doc = await leerMatriculaPba(csv('"0069JI0901";"060701600";"Escuela; Uno";"186";"205";"195"\n"0069JI0902";"060198200";"Dos";"0";"";"0"'))
  assert.equal(doc.fecha, '2026-11-05')
  assert.deepEqual(doc.filas, [
    { clave: '0069JI0901', activa: 186, anterior: 205, inicial: 195 },
    { clave: '0069JI0902', activa: 0, anterior: null, inicial: 0 },
  ])
})

test('rechaza fecha, cabecera, números y claves repetidas inválidos', async () => {
  await assert.rejects(leerMatriculaPba(csv('"0069JI0901";"1";"X";"1";"2";"3"', '31-02-2026')), /fecha/)
  await assert.rejects(leerMatriculaPba(csv('"0069JI0901";"1";"X";"1";"2";"3"').replace('Matrícula inscripta', 'Otra columna')), /columnas/)
  await assert.rejects(leerMatriculaPba(csv('"0069JI0901";"1";"X";"-1";"2";"3"')), /inválida/)
  await assert.rejects(leerMatriculaPba(csv('"0069JI0901";"1";"X";"1";"2";"3"\n"0069JI0901";"1";"X";"1";"2";"3"')), /repetida/)
})

test('diferencias usan la referencia y nunca dividen por cero', () => {
  assert.deepEqual(diferencia(120, 100), { valor: 20, porcentaje: 20 })
  assert.deepEqual(diferencia(80, 100), { valor: -20, porcentaje: -20 })
  assert.deepEqual(diferencia(20, 0), { valor: 20, porcentaje: null })
  assert.deepEqual(diferencia(null, 10), { valor: null, porcentaje: null })
  assert.match(diferenciaPba(20, 0), /sin porcentaje/)
})
