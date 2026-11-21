import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { PDFArray, PDFDocument, decodePDFRawStream } from 'pdf-lib'
import * as XLSX from 'xlsx'
import { consultaSalidas, leerSalidasFiltradas, limpiarBusquedaSalidas, tablaSalidas } from '../src/lib/salidasListado.ts'
import { buildListadoXlsx } from '../src/lib/escuelasListado.ts'
import { buildPdf } from '../src/lib/export.ts'

const estados = [{ id: 2, nombre: 'Aprobada' }, { id: 3, nombre: 'En Proceso' }]
const salida = (i) => ({
  id: i, user_id: 'usuario', cue: '00012345', clave: 'ABC001', escuela: 'Escuela 1',
  titulo: `Museo ${i}`, fecha: '2026-11-21', destino: 'La Plata', estado_id: 2,
  observaciones: null, enviar_mail: false, mail_enviado_at: null, created_at: '2026-11-01T12:00:00Z',
})

test('paginación y exportación consultan todos los resultados con los mismos filtros y orden', async () => {
  const rows = Array.from({ length: 1102 }, (_, i) => salida(1102 - i))
  const pedidos = []
  const cliente = createClient('https://ejemplo.invalid', 'clave-ficticia', {
    global: { fetch: async (url) => {
      const params = new URL(url).searchParams
      pedidos.push(params)
      assert.equal(params.get('estado_id'), 'eq.2')
      assert.match(params.get('or'), /titulo\.ilike\.%Museo%/)
      assert.match(params.get('or'), /cue\.ilike\.%Museo%/)
      assert.equal(params.get('order'), 'fecha.desc,id.desc')
      const offset = Number(params.get('offset') ?? 0)
      const limit = Number(params.get('limit'))
      return new Response(JSON.stringify(rows.slice(offset, offset + limit)), {
        headers: { 'Content-Type': 'application/json', 'Content-Range': `${offset}-${Math.min(offset + limit, rows.length) - 1}/${rows.length}` },
      })
    } },
  })
  const filtros = { busqueda: 'Museo', estado: '2' }
  const pagina = await consultaSalidas(cliente, filtros).range(20, 39)
  assert.ifError(pagina.error)
  assert.equal(pagina.count, 1102)
  assert.deepEqual(pagina.data.map((s) => s.id), rows.slice(20, 40).map((s) => s.id))
  const exportadas = await leerSalidasFiltradas(cliente, filtros)
  assert.deepEqual(exportadas.map((s) => s.id), rows.map((s) => s.id))
  assert.deepEqual(pedidos.slice(1).map((p) => [p.get('offset'), p.get('limit')]), [['0', '500'], ['500', '500'], ['1000', '500']])
})

test('un error al recuperar otra página interrumpe la exportación', async () => {
  let llamadas = 0
  const cliente = createClient('https://ejemplo.invalid', 'clave-ficticia', {
    global: { fetch: async () => {
      llamadas++
      return llamadas === 1
        ? new Response(JSON.stringify(Array.from({ length: 500 }, (_, i) => salida(i))), { headers: { 'Content-Type': 'application/json', 'Content-Range': '0-499/600' } })
        : new Response(JSON.stringify({ message: 'Fallo de prueba' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  await assert.rejects(leerSalidasFiltradas(cliente, { busqueda: '', estado: '' }), (e) => e.message === 'Fallo de prueba')
})

test('las exportaciones conservan datos, filtros y filas fuera de la primera página', async () => {
  const filas = Array.from({ length: 40 }, (_, i) => ({ ...salida(i), titulo: i === 0 ? '=Museo' : `Museo ${i}` }))
  const tabla = tablaSalidas(filas, estados, { busqueda: 'Museo', estado: '2' }, 'Distrito')
  assert.match(tabla.subtitle, /Estado: Aprobada/)
  assert.match(tabla.subtitle, /Búsqueda: Museo/)
  const libro = XLSX.read(await buildListadoXlsx(tabla, 'DataEscuela', 'Salidas'), { type: 'array' })
  const hoja = libro.Sheets.Salidas
  const datos = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' })
  assert.deepEqual(datos[4], ['Fecha', 'Título', 'Destino', 'Escuela', 'Clave', 'CUE', 'Estado'])
  assert.equal(datos.length, 45)
  assert.equal(datos[5][1], '=Museo')
  assert.equal(hoja.B6.f, undefined)
  assert.equal(datos[5][5], '00012345')
  assert.equal(datos.at(-1)[1], 'Museo 39')
  const logo = new Uint8Array(await readFile(new URL('../public/icon-192.png', import.meta.url)))
  const pdf = await PDFDocument.load(await buildPdf(tabla, { brand: { name: 'DataEscuela', logo }, maxCellLines: 30 }))
  assert.ok(pdf.getPageCount() > 1)
  const paginaFinal = pdf.getPages().at(-1).node.Contents()
  const streams = paginaFinal instanceof PDFArray ? Array.from({ length: paginaFinal.size() }, (_, i) => pdf.context.lookup(paginaFinal.get(i))) : [pdf.context.lookup(paginaFinal)]
  assert.match(streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n'), /<4D7573656F203339>/)
})

test('los caracteres reservados no rompen el filtro de búsqueda', () => {
  assert.equal(limpiarBusquedaSalidas('  Museo,(*) "Sur"\\  '), 'Museo      Sur')
})
