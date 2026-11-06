import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerFichasInscripcion, porcentajeFicha } from '../src/lib/estadisticaFichas.ts'

const cabecera = ['Clave del establecimiento', 'CUE', 'Nombre del establecimiento', 'Matrícula total',
  'Posee DNI Argentino, NO tiene el DNI FÍSICO y está en trámite', 'Posee DNI Argentino, NO tiene el DNI físico y no está en trámite',
  'No posee DNI Argentino', 'Identidad de género', 'Lugar de nacimiento', 'Información de salud', 'Inclusión', 'Educación complementaria'].map((c) => `"${c}"`).join(';')
const csv = (filas, fecha = '06-11-2026') => `\ufeff""\n"Estudiantes con datos incompletos en ficha de inscripción al ${fecha} - LA MATANZA-Inicial"\n""\n"Filtros aplicados:"\n${cabecera}\n${filas}\n\nNota`

test('importa fichas con faltantes y totales', async () => {
  const doc = await leerFichasInscripcion(csv('"0069JI0901";"1";"Uno; X";"186";"0";"0";"1";"175";"174";"1";"114";"183"\n"0069JI0902";"2";"Dos";"0";"";"0";"0";"0";"0";"0";"0";"0"'))
  assert.equal(doc.fecha, '2026-11-06')
  assert.deepEqual(doc.filas[0], { clave: '0069JI0901', matricula: 186, dni_tramite: 0, dni_sin_tramite: 0, sin_dni: 1, genero: 175, nacimiento: 174, salud: 1, inclusion: 114, complementaria: 183 })
  assert.equal(doc.filas[1].dni_tramite, null)
})

test('rechaza fecha, columnas, números y claves repetidas inválidos', async () => {
  const fila = '"0069JI0901";"1";"X";"1";"0";"0";"0";"0";"0";"0";"0";"0"'
  await assert.rejects(leerFichasInscripcion(csv(fila, '31-02-2026')), /fecha/)
  await assert.rejects(leerFichasInscripcion(csv(fila).replace('Inclusión', 'Otra')), /columnas/)
  await assert.rejects(leerFichasInscripcion(csv(fila.replace('"1";"0"', '"-1";"0"'))), /inválido/)
  await assert.rejects(leerFichasInscripcion(csv(`${fila}\n${fila}`)), /repetida/)
})

test('porcentaje no divide por cero', () => {
  assert.equal(porcentajeFicha(5, 20), 25)
  assert.equal(porcentajeFicha(5, 0), null)
  assert.equal(porcentajeFicha(null, 10), null)
})
