import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PDFArray, PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib'
import { buildPdf } from '../src/lib/export.ts'

async function contenido(page, doc) {
  const contents = page.node.Contents()
  const streams = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, i) => doc.context.lookup(contents.get(i)))
    : [doc.context.lookup(contents)]
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n')
}

test('PDF con logo, indicadores de variación y paginación', async () => {
  const logo = new Uint8Array(await readFile(new URL('../public/icon-192.png', import.meta.url)))
  const rows = Array.from({ length: 60 }, (_, i) => [`Escuela ${i}`, i % 3 === 0 ? '+10' : i % 3 === 1 ? '-10' : '0'])
  const bytes = await buildPdf({ title: 'Matrícula PBA', subtitle: 'Inspector: Prueba', headers: ['Escuela', 'Diferencia'], widths: [30, 20], rows },
    { brand: { name: 'DataEscuela v2', logo }, indicators: rows.map((_, i) => [null, i % 3 === 0 ? 10 : i % 3 === 1 ? -10 : 0]) })
  const doc = await PDFDocument.load(bytes)
  assert.ok(doc.getPageCount() > 1)
  const first = doc.getPages()[0]
  const resources = first.node.Resources()
  assert.ok(resources.lookup(PDFName.of('XObject')), 'incluye el logo')
  const text = await contenido(first, doc)
  assert.match(text, /0\.016 0\.47 0\.337 RG/)
  assert.match(text, /0\.725 0\.11 0\.11 RG/)
  assert.match(text, /0\.392 0\.455 0\.545 RG/)
  assert.match(text, /<4461746145736375656C61207632>/)
  assert.match(await contenido(doc.getPages()[1], doc), /<45736375656C61>/)
})

test('PDF común funciona sin opciones ni indicadores', async () => {
  const pdf = await buildPdf({ title: 'Listado', subtitle: 'Prueba', headers: ['Nombre'], widths: [20], rows: [['Dato']] })
  const doc = await PDFDocument.load(pdf)
  assert.equal(doc.getPageCount(), 1)
  assert.match(await contenido(doc.getPages()[0], doc), /<4461746F>/)
})
