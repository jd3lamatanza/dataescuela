import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { PDFDocument } from 'pdf-lib'
import { createClient } from '@supabase/supabase-js'
import { leerPreinscripcionesCuenta, tablaPreinscripcionesCuenta } from '../src/lib/eavInscripcionesCuenta.ts'
import { buildListadoXlsx } from '../src/lib/escuelasListado.ts'
import { buildPdf } from '../src/lib/export.ts'

const fila = (i) => ({
  id: i, temporada: 2027, dni: String(80000000 + i), nombre: `Estudiante ${i}`, nacimiento: '2018-01-02', genero: 'Mujer',
  escuela_actual_id: i % 2 ? 5 : null, escuela_actual_otra: i % 2 ? null : 'Escuela de otro distrito', domicilio: 'Calle 1',
  responsable: 'Responsable', vinculo: 'Otro', telefono: '1155550000', email: 'a@example.invalid',
  creado_en: '2026-11-01T12:00:00Z', inscrito_en: i % 2 ? '2026-11-02T12:00:00Z' : null, legajo_completo: i % 2 ? false : null,
})
const contexto = { escuela: 'Escuela de prueba', busqueda: 'Est', organizacion: 'JD3', escuelasActuales: new Map([[5, 'EP 5 Cinco']]) }

test('versión resumida y completa tienen las columnas esperadas', () => {
  const filas = [fila(1), fila(2)]
  const r = tablaPreinscripcionesCuenta(filas, 'resumida', contexto)
  assert.deepEqual(r.headers, ['Estudiante', 'DNI', 'Nacimiento', 'Responsable', 'Teléfono', 'Estado', 'Legajo'])
  assert.deepEqual(r.rows[0].slice(5), ['Inscripto', 'Incompleto'])
  assert.deepEqual(r.rows[1].slice(5), ['Preinscripto', 'Pendiente'])
  const c = tablaPreinscripcionesCuenta(filas, 'completa', contexto)
  assert.equal(c.rows[0].length, c.headers.length)
  assert.equal(c.widths.length, c.headers.length)
  assert.equal(c.rows[0][5], 'EP 5 Cinco')
  assert.equal(c.rows[1][5], 'Escuela de otro distrito')
  assert.match(c.subtitle, /Escuela de prueba · Búsqueda: Est · 2 estudiante\(s\)/)
})

test('exporta xlsx y pdf válidos de ambas versiones', async () => {
  for (const version of ['resumida', 'completa']) {
    const tabla = tablaPreinscripcionesCuenta([fila(1), fila(2)], version, contexto)
    const libro = XLSX.read(await buildListadoXlsx(tabla, 'DataEscuela', 'Inscripciones'), { type: 'array' })
    const hoja = XLSX.utils.sheet_to_json(libro.Sheets.Inscripciones, { header: 1 })
    assert.deepEqual(hoja[4], tabla.headers)
    assert.equal(hoja.length, 7)
    const pdf = await PDFDocument.load(await buildPdf(tabla, { maxCellLines: 30 }))
    assert.ok(pdf.getPageCount() >= 1)
  }
})

test('lee todas las páginas de la escuela con la búsqueda', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => fila(i + 1))
  const cliente = createClient('https://ejemplo.invalid', 'clave', { global: { fetch: async (url) => {
    const p = new URL(url).searchParams
    assert.equal(p.get('escuela_eav_id'), 'eq.7')
    assert.match(p.get('or'), /nombre\.ilike\.%Est%/)
    const o = Number(p.get('offset') ?? 0), l = Number(p.get('limit'))
    return new Response(JSON.stringify(rows.slice(o, o + l)), { headers: { 'content-type': 'application/json' } })
  } } })
  assert.equal((await leerPreinscripcionesCuenta(cliente, 7, ' Est ')).length, 501)
})
