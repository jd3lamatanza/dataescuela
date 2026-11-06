import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerDesempeno, nombreTrimestre } from '../src/lib/estadisticaDesempeno.ts'

const cab = 'Distrito;Sector de gestión;Nivel educativo;Nombre escuela;Clave provincial;CUEANEXO;Año de estudio;Matrícula;TODAS las materias aprobadas (%);TODAS las materias aprobadas (cant.);1 o 2 materias NO aprobadas (%);1 o 2 materias NO aprobadas (cant.);3 o 4 materias NO aprobadas (%);3 o 4 materias NO aprobadas (cant.);5 o más materias NO aprobadas (%);5 o más materias NO aprobadas (cant.);TODAS las materias NO aprobadas (%);TODAS las materias NO aprobadas (cant.);Sin información (%);Sin información (cant.)'
const csv = (filas, tri = '2do trimestre', fecha = '06-11-2026') => `\ufeff\n"Distribución de estudiantes por desempeño académico     ${tri} (primaria)     actual en el sistema al ${fecha}"\n\n"Ciclo lectivo: 2026";"Nivel: Nivel Primario"\n\n${cab}\n${filas}\n\nNota`
const fila = (clave, anio) => `LM;E;P;Esc;${clave};1;${anio};40;0,9;37;0;1;0;2;0;3;0;4;0,07;5`

test('importa desempeño con ciclo y trimestre', async () => {
  const d = await leerDesempeno(csv(fila('0069PP0001', '1er año')))
  assert.equal(d.fecha, '2026-11-06'); assert.equal(d.ciclo, 2026); assert.equal(d.trimestre, 2)
  assert.deepEqual(d.filas[0], { clave: '0069PP0001', anio: '1er año', matricula: 40, aprobadas: 37, de_1_2: 1, de_3_4: 2, mas_5: 3, ninguna: 4, sin_info: 5 })
  assert.equal((await leerDesempeno(csv(fila('0069PP0001', '1er año'), '1er trimestre'))).trimestre, 1)
  assert.equal((await leerDesempeno(csv(fila('0069PP0001', '1er año'), '3er trimestre'))).trimestre, 3)
  assert.equal(nombreTrimestre(2), '2do trimestre')
})

test('rechaza datos inválidos', async () => {
  const f = fila('0069PP0001', '1er año')
  await assert.rejects(leerDesempeno(csv(f, '2do trimestre', '31-02-2026')), /fecha/)
  await assert.rejects(leerDesempeno(csv(f, 'trimestre raro')), /trimestre/)
  await assert.rejects(leerDesempeno(csv(f).replace('Matrícula;', 'Otra;')), /columnas/)
  await assert.rejects(leerDesempeno(csv(fila('XX', '1er año'))), /Clave/)
  await assert.rejects(leerDesempeno(csv(`${f}\n${f}`)), /repetido/)
})
