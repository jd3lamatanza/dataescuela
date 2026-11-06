import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerSalidasSinIngreso, nivelDesdeNombre } from '../src/lib/estadisticaSalidas.ts'

const cab = 'Nombre;Apellido;DNI;Turno;Año de estudio;Sección;Clave del establecimiento;Nombre del establecimiento;Distrito;Estado de pase'
const csv = (filas, fecha = '06-11-2026') => `\ufeff\n"Estudiantes salidas y salidos con pase sin ingreso en otro establecimiento al ${fecha} - LA MATANZA-Primario"\n\n"Filtros aplicados:"\n"x"\n\n${cab}\n${filas}\n\nNota`

test('detecta el nivel en el nombre del archivo', () => {
  assert.equal(nivelDesdeNombre('LA MATANZA-Primario-salidas-os_sin_ingreso-06-11-2026.csv'), 'primario')
  assert.equal(nivelDesdeNombre('LA MATANZA-Inicial-salidas.csv'), 'inicial')
  assert.equal(nivelDesdeNombre('LA MATANZA-Secundario-x.csv'), 'secundario')
  assert.equal(nivelDesdeNombre('salidas.csv'), null)
  assert.equal(nivelDesdeNombre('inicial-primario.csv'), null)
})

test('importa estudiantes', async () => {
  const d = await leerSalidasSinIngreso(csv('ANA;PEREZ;IND_1;TARDE;1er año;A;0069PP0013;ESC 13;LA MATANZA;Pase rechazado'))
  assert.equal(d.fecha, '2026-11-06')
  assert.equal(d.nivelTitulo, 'primario')
  assert.deepEqual(d.filas, [{ clave: '0069PP0013', nombre: 'ANA', apellido: 'PEREZ', dni: 'IND_1', turno: 'TARDE', anio: '1er año', seccion: 'A', estado: 'Pase rechazado' }])
})

test('rechaza fecha, columnas y claves inválidas', async () => {
  const f = 'ANA;PEREZ;1;TARDE;1er año;A;0069PP0013;E;LM;Pendiente'
  await assert.rejects(leerSalidasSinIngreso(csv(f, '31-02-2026')), /fecha/)
  await assert.rejects(leerSalidasSinIngreso(csv(f).replace('Estado de pase', 'Otra')), /columnas/)
  await assert.rejects(leerSalidasSinIngreso(csv(f.replace('0069PP0013', 'XX'))), /Clave/)
})
