import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { buildPptx } from '../src/lib/pptx.ts'

test('genera un PPTX con todas las filas y columnas repartidas en diapositivas', async () => {
  const headers = Array.from({ length: 10 }, (_, i) => `Encabezado ${i}`)
  const rows = Array.from({ length: 19 }, (_, i) => headers.map((_, j) => `Fila ${i} columna ${j}`))
  const bytes = await buildPptx({ title: 'Indicadores', subtitle: 'Escuelas filtradas', headers, widths: headers.map(() => 10), rows })
  const zip = unzipSync(bytes)
  assert.ok(zip['[Content_Types].xml'])
  assert.ok(zip['ppt/presentation.xml'])
  const slides = Object.entries(zip).filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).map(([, value]) => strFromU8(value))
  assert.equal(slides.length, 9)
  for (const header of headers) assert.ok(slides.some((s) => s.includes(header)), header)
  for (const fila of rows) for (const celda of fila) assert.ok(slides.some((s) => s.includes(celda)), celda)
  assert.ok(slides.every((s) => s.includes('Indicadores') && s.includes('Escuelas filtradas')))
})

test('genera presentación vacía con encabezados', async () => {
  const zip = unzipSync(await buildPptx({ title: 'Vacío', subtitle: '', headers: ['Escuela'], widths: [10], rows: [] }))
  assert.ok(strFromU8(zip['ppt/slides/slide1.xml']).includes('Escuela'))
})
