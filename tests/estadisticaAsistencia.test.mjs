import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerAsistencia, porcentajeAsistencia } from '../src/lib/estadisticaAsistencia.ts'

const cab = 'Distrito;Sector de gestión;Nivel educativo;Nombre escuela;Clave provincial;CUEANEXO;Año de estudio;Matrícula;Con menos de 10 inasistencias (%);Con menos de 10 inasistencias (cant.);Con 10 a 19 inasistencias (%);Con 10 a 19 inasistencias (cant.);Con 20 a 27 inasistencias (%);Con 20 a 27 inasistencias (cant.);Con 28 a 44 inasistencias (%);Con 28 a 44 inasistencias (cant.);Con 45 y más inasistencias (%);Con 45 y más inasistencias (cant.);Sin información (%);Sin información (cant.)'
const csv = (filas, fecha = '06-11-2026') => `\ufeff\n"Distribución de estudiantes por condición de inasistencias ${fecha} - LA MATANZA-Primario"\n\n"Ciclo Lectivo: 2026"\n"x"\n\n${cab}\n${filas}\n\nNota`
const fila = (clave, anio, m = 40) => `LM;ESTATAL;Nivel Primario;Esc;${clave};1;${anio};${m};0,1;1;0,2;8;0,3;12;0,3;15;0,07;3;0,02;1`

test('importa asistencia por año', async () => {
  const d = await leerAsistencia(csv(`${fila('0069PP0001', '1er año')}\n${fila('0069PP0001', '2do año', 63)}`))
  assert.equal(d.fecha, '2026-11-06')
  assert.equal(d.ciclo, 2026)
  assert.deepEqual(d.filas[0], { clave: '0069PP0001', anio: '1er año', matricula: 40, menos_10: 1, de_10_19: 8, de_20_27: 12, de_28_44: 15, mas_45: 3, sin_info: 1 })
  assert.equal(d.filas[1].matricula, 63)
})

test('rechaza datos inválidos', async () => {
  const f = fila('0069PP0001', '1er año')
  await assert.rejects(leerAsistencia(csv(f, '31-02-2026')), /fecha/)
  await assert.rejects(leerAsistencia(csv(f).replace('Matrícula;', 'Otra;')), /columnas/)
  await assert.rejects(leerAsistencia(csv(fila('XX', '1er año'))), /Clave/)
  await assert.rejects(leerAsistencia(csv(`${f}\n${f}`)), /repetido/)
})

test('porcentaje no divide por cero', () => {
  assert.equal(porcentajeAsistencia(5, 20), 25)
  assert.equal(porcentajeAsistencia(5, 0), null)
})
