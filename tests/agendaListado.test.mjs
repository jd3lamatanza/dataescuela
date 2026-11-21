import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { tablaAgenda } from '../src/lib/agendaListado.ts'
import { buildXlsx } from '../src/lib/export.ts'

test('la exportación conserva horas y lugares faltantes para ambos roles', () => {
  const rows = [
    { id: 1, fecha: '2026-11-21', hora: '08:30:00', nombre: 'Reunión', lugar: null, descripcion: 'Detalle', autor: 'Inspector', user_id: 'a', agenda_historica: true },
    { id: 2, fecha: '2026-11-22', hora: null, nombre: 'Visita', lugar: 'Escuela', descripcion: null, autor: 'Inspector', user_id: 'a', agenda_historica: false },
  ]
  for (const distrito of [true, false]) {
    const tabla = tablaAgenda(rows, 'noviembre de 2026', '', distrito)
    const libro = XLSX.read(buildXlsx(tabla, 'Agenda'), { type: 'array' })
    const datos = XLSX.utils.sheet_to_json(libro.Sheets.Agenda, { header: 1, defval: '' })
    assert.deepEqual(datos[0].slice(0, 4), ['Fecha', 'Hora', 'Título', 'Lugar'])
    assert.deepEqual(datos[1].slice(0, 4), ['21/11/2026', '08:30', 'Reunión', ''])
    assert.deepEqual(datos[2].slice(0, 4), ['22/11/2026', '', 'Visita', 'Escuela'])
    assert.equal(datos[1].includes('Inspector'), distrito)
  }
})
