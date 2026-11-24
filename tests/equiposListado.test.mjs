import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { PDFArray, PDFDocument, decodePDFRawStream } from 'pdf-lib'
import * as XLSX from 'xlsx'
import { filtrarEquipos, leerEquipos, tablaEquipos } from '../src/lib/equiposListado.ts'
import { buildListadoXlsx } from '../src/lib/escuelasListado.ts'
import { buildPdf } from '../src/lib/export.ts'

const fila = (i) => ({
  id: i, escuela_id: 1, apellido_nombre: `Persona ${i}`, cuil: '20000123456', dni: '00123456',
  cargo: { nombre: 'Director' }, revista: { nombre: 'Titular' }, toma_posesion: '2026-03-01',
  telefono: '011 1234', email: 'docente@abc.gob.ar', cargo_base: 'Docente',
  escuela: { clave: 'ABC001', cue: '00012345', codigo: 'EP', numero: 1, nivel: 'Primario', localidad: 'Ramos Mejía' },
})

test('recupera todas las páginas de cada equipo y conserva los errores', async () => {
  for (const [tipo, tabla] of [['directivo', 'equipo_directivo'], ['orientacion', 'equipo_orientacion'], ['esi', 'referentes_esi']]) {
    const registros = Array.from({ length: 1101 }, (_, i) => fila(i))
    const pedidos = []
    const cliente = createClient('https://ejemplo.invalid', 'ficticia', { global: { fetch: async (url) => {
      const u = new URL(url)
      pedidos.push(u)
      assert.equal(u.pathname, `/rest/v1/${tabla}`)
      assert.match(u.searchParams.get('select'), /escuela:escuelas!inner/)
      assert.equal(u.searchParams.get('order'), 'apellido_nombre.asc,id.asc')
      const offset = Number(u.searchParams.get('offset'))
      const limit = Number(u.searchParams.get('limit'))
      return Response.json(registros.slice(offset, offset + limit))
    } } })
    assert.equal((await leerEquipos(cliente, tipo)).length, 1101)
    assert.deepEqual(pedidos.map((u) => u.searchParams.get('offset')), ['0', '500', '1000'])
  }
  let llamadas = 0
  const cliente = createClient('https://ejemplo.invalid', 'ficticia', { global: { fetch: async () => ++llamadas === 1
    ? Response.json(Array.from({ length: 500 }, (_, i) => fila(i)))
    : Response.json({ message: 'Error de prueba' }, { status: 500 }) } })
  await assert.rejects(leerEquipos(cliente, 'directivo'), (e) => e.message === 'Error de prueba')
})

test('filtros y exportaciones incluyen solo los registros seleccionados y conservan identificadores', async () => {
  const filas = [fila(1), { ...fila(2), escuela: { ...fila(2).escuela, nivel: 'Secundario' } }, { ...fila(3), apellido_nombre: 'Otra persona' }]
  const filtros = { busqueda: 'persona 1', nivel: 'Primario', localidad: 'Ramos Mejía' }
  const filtradas = filtrarEquipos(filas, filtros)
  assert.deepEqual(filtradas.map((r) => r.id), [1])
  const tabla = tablaEquipos(filtradas, 'directivo', filtros, 'Distrito')
  assert.match(tabla.subtitle, /Nivel: Primario/)
  const libro = XLSX.read(await buildListadoXlsx(tabla, 'DataEscuela', 'Listado'), { type: 'array' })
  const datos = XLSX.utils.sheet_to_json(libro.Sheets.Listado, { header: 1, defval: '' })
  assert.equal(datos[5][2], '00012345')
  assert.equal(datos[5][4], '20000123456')
  assert.equal(datos[5][7], '01/03/2026')
  assert.match(datos[5][8], /docente@abc.gob.ar/)
  assert.equal(datos[5][9], 'Docente')
  const esi = tablaEquipos([{ ...fila(1), cargo: 'Docente', area: 'Biología', turno: 'Mañana', otra_escuela: true, otra_escuela_detalle: 'EP 2' }], 'esi', filtros, 'Distrito')
  assert.deepEqual(esi.rows[0].slice(4), ['00123456', 'Docente', 'Biología', 'Mañana', 'Sí · EP 2'])
  const orientacion = tablaEquipos([fila(1)], 'orientacion', filtros, 'Distrito')
  assert.equal(orientacion.headers.length, orientacion.rows[0].length)
  assert.ok(!orientacion.headers.includes('Cargo base'))

  const logo = new Uint8Array(await readFile(new URL('../public/icon-192.png', import.meta.url)))
  const pdf = await PDFDocument.load(await buildPdf(tabla, { brand: { name: 'DataEscuela', logo }, maxCellLines: 12 }))
  const contents = pdf.getPages()[0].node.Contents()
  const streams = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, i) => pdf.context.lookup(contents.get(i))) : [pdf.context.lookup(contents)]
  const texto = streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n')
  assert.match(texto, /<3030303132333435>/)
  assert.match(texto, /<506572736F6E612031>/)
})

test('cada nómina exporta también los registros de páginas posteriores en Excel y PDF', async () => {
  const logo = new Uint8Array(await readFile(new URL('../public/icon-192.png', import.meta.url)))
  for (const tipo of ['directivo', 'orientacion', 'esi']) {
    const filas = Array.from({ length: 60 }, (_, i) => ({ ...fila(i), cargo: tipo === 'esi' ? 'Docente' : { nombre: 'Director' } }))
    const tabla = tablaEquipos(filas, tipo, { busqueda: '', nivel: '', localidad: '' }, 'Distrito')
    const libro = XLSX.read(await buildListadoXlsx(tabla, 'DataEscuela', 'Listado'), { type: 'array' })
    const datos = XLSX.utils.sheet_to_json(libro.Sheets.Listado, { header: 1, defval: '' })
    assert.equal(datos.length, 65)
    assert.equal(datos.at(-1)[3], 'Persona 59')
    const pdf = await PDFDocument.load(await buildPdf(tabla, { brand: { name: 'DataEscuela', logo }, maxCellLines: 12 }))
    assert.ok(pdf.getPageCount() > 1)
    const contents = pdf.getPages().at(-1).node.Contents()
    const streams = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, i) => pdf.context.lookup(contents.get(i))) : [pdf.context.lookup(contents)]
    assert.match(streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n'), /<506572736F6E61203539>/)
  }
})
