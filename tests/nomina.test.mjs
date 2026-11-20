import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseNomina } from '../src/lib/nomina.ts'

const XLSX = createRequire(import.meta.url)('xlsx')
function libro(curso) {
  const filas = [
    ['D10', 'JORNADA SIMPLE Turno: TARDE'],
    ...(curso ? [['D12', curso]] : []),
    ['D14', 'D - Tipo de sección: SIMPLE'],
    ['G16', 'Estado inscripción'], ['H16', 'Nombre estudiante'], ['I16', 'Documento estudiante'],
    ['G17', 'REGULAR'], ['H17', 'Alumna Ejemplo'], ['I17', '12.345.678'],
    ['G18', 'BAJA'], ['H18', 'Alumno Ejemplo'], ['I18', '23456789'],
    ['D20', 'E - Tipo de sección: SIMPLE'],
    ['G22', 'Estado inscripción'], ['H22', 'Nombre estudiante'], ['I22', 'Documento estudiante'],
    ['G23', 'REGULAR'], ['H23', 'Otra Alumna'], ['I23', '34567890'],
  ]
  const ws = XLSX.utils.aoa_to_sheet([])
  for (const [celda, valor] of filas) XLSX.utils.sheet_add_aoa(ws, [[valor]], { origin: celda })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Matricula 2026')
  return Uint8Array.from(XLSX.write(wb, { type: 'buffer', bookType: 'xls' })).buffer
}

test('Inicial lee nombre y DNI y usa solo la letra de cada sección', async () => {
  for (const codigo of ['JI', 'JV', 'JU']) {
    const nomina = await parseNomina(libro('TERCERA SECCION'), codigo)
    assert.deepEqual(nomina.rows, [
      { dni: '12345678', nombre: 'Alumna Ejemplo', curso: 'D' },
      { dni: '34567890', nombre: 'Otra Alumna', curso: 'E' },
    ])
    assert.equal(nomina.bajas, 1)
  }
  assert.equal((await parseNomina(libro(null), 'JI')).rows[0].curso, 'D')
})

test('Primaria conserva curso y sección y sigue exigiendo curso', async () => {
  const nomina = await parseNomina(libro('6'), 'PP')
  assert.deepEqual(nomina.rows.map((r) => r.curso), ['6D', '6E'])
  await assert.rejects(parseNomina(libro(null), 'PP'), /Falta el curso/)
})
