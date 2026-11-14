import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PDFArray, PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib'
import * as XLSX from 'xlsx'
import { buildEscuelasXlsx, direccionEscuela, tablaEscuelas } from '../src/lib/escuelasListado.ts'
import { buildPdf } from '../src/lib/export.ts'

const escuela = { id: 1, clave: 'ABC001', cue: '0001234', codigo: 'EP', numero: 1, nivel: 'Primario', modalidad: 'Común', localidad: 'Ramos Mejía', calle: 'San Martín', nu_calle: 123, te: '011 1234-5678' }

test('el listado incluye los datos y filtros y conserva campos sin completar', () => {
  assert.equal(direccionEscuela(escuela), 'San Martín 123')
  assert.equal(direccionEscuela({ calle: null, nu_calle: null }), '')
  assert.equal(direccionEscuela({ calle: null, nu_calle: 0 }), '0')
  const tabla = tablaEscuelas([escuela, { ...escuela, id: 2, calle: null, nu_calle: null, te: null }], { localidad: 'Ramos Mejía', nivel: 'Primario', busqueda: 'ABC' }, 'Jefatura Distrital 3')
  assert.match(tabla.subtitle, /Localidad: Ramos Mejía/)
  assert.match(tabla.subtitle, /2 escuela/)
  assert.deepEqual(tabla.rows[0].slice(-2), ['San Martín 123', '011 1234-5678'])
  assert.deepEqual(tabla.rows[1].slice(-2), ['', ''])
})

test('Excel incluye encabezados, filtros y todas las escuelas como texto', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ ...escuela, id: i + 1, clave: i === 0 ? '=no-ejecutar' : `CL${i}` }))
  const tabla = tablaEscuelas(rows, { localidad: 'Ramos Mejía', nivel: '', busqueda: '' }, 'Jefatura Distrital 3')
  const libro = XLSX.read(await buildEscuelasXlsx(tabla, 'DataEscuela v2'), { type: 'array' })
  const hoja = libro.Sheets.Escuelas
  const datos = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' })
  assert.equal(datos[0][0], 'DataEscuela v2')
  assert.equal(datos[1][0], 'Listado de escuelas')
  assert.match(datos[2][0], /Ramos Mejía/)
  assert.deepEqual(datos[4], tabla.headers)
  assert.equal(datos.length, 65)
  assert.equal(datos[5][0], '=no-ejecutar')
  assert.equal(hoja.A6.f, undefined)
  assert.equal(datos[5][1], '0001234')
  assert.deepEqual(datos[5].slice(-2), ['San Martín 123', '011 1234-5678'])
})

test('PDF incluye marca, datos de contacto y encabezados en páginas posteriores', async () => {
  const tabla = tablaEscuelas(Array.from({ length: 80 }, (_, i) => ({ ...escuela, id: i + 1 })), { localidad: 'Ramos Mejía', nivel: '', busqueda: '' }, 'Jefatura Distrital 3')
  const logo = new Uint8Array(await readFile(new URL('../public/icon-192.png', import.meta.url)))
  const doc = await PDFDocument.load(await buildPdf(tabla, { brand: { name: 'DataEscuela v2', logo }, maxCellLines: 12 }))
  assert.ok(doc.getPageCount() > 1)
  const texto = (page) => {
    const contents = page.node.Contents()
    const streams = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, i) => doc.context.lookup(contents.get(i))) : [doc.context.lookup(contents)]
    return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n')
  }
  assert.ok(doc.getPages()[0].node.Resources().lookup(PDFName.of('XObject')))
  assert.match(texto(doc.getPages()[0]), /<4461746145736375656C61207632>/)
  assert.match(texto(doc.getPages()[0]), /<30313120313233342D35363738>/)
  assert.match(texto(doc.getPages()[1]), /<44697265636369F36E>/)
})
