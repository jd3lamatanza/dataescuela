import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { PDFArray, PDFDocument, decodePDFRawStream } from 'pdf-lib'
import * as XLSX from 'xlsx'
import { consultaInscripcionesEav, leerEscuelasEav, leerInscripcionesEav, limpiarBusquedaInscripcionesEav, tablaInscripcionesEav } from '../src/lib/eavInscripcionesListado.ts'
import { buildListadoXlsx } from '../src/lib/escuelasListado.ts'
import { buildPdf } from '../src/lib/export.ts'

const escuela = { id: 7, clave: 'ABC001', cue: '00012345', tipo: 'EP', codigo: 'EP', numero: 1, nombre: 'Escuela de prueba', localidad: null }
const inscripcion = (i) => ({
  id: i, temporada: 2027, escuela_eav_id: 7, dni: String(80000000 + i), nombre: `Estudiante ${i}`,
  nacimiento: '2018-01-02', genero: 'Mujer', escuela_actual_id: null, escuela_actual_otra: 'Otra escuela',
  domicilio: 'Domicilio de prueba', responsable: 'Responsable prueba', vinculo: 'Otro', telefono: '01112345678',
  email: 'prueba@example.invalid', creado_en: '2026-11-01T12:00:00Z', inscrito_en: i % 2 ? '2026-11-02T12:00:00Z' : null,
  legajo_completo: i % 2 ? false : null, escuela_eav: escuela, escuela_actual: null,
})

test('lista y exportación consultan todas las páginas con los mismos filtros y orden', async () => {
  const rows = Array.from({ length: 1102 }, (_, i) => inscripcion(1102 - i))
  const pedidos = []
  const cliente = createClient('https://ejemplo.invalid', 'clave-ficticia', { global: { fetch: async (url) => {
    const params = new URL(url).searchParams
    pedidos.push(params)
    assert.equal(params.get('escuela_eav_id'), 'eq.7')
    assert.match(params.get('or'), /nombre\.ilike\.%Estudiante%/)
    assert.equal(params.get('order'), 'temporada.desc,creado_en.desc,id.desc')
    assert.match(params.get('select'), /escuela_actual:escuelas!eav_preinscripciones_escuela_actual_id_fkey/)
    const offset = Number(params.get('offset') ?? 0), limit = Number(params.get('limit'))
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), { headers: { 'Content-Type': 'application/json', 'Content-Range': `${offset}-${Math.min(offset + limit, rows.length) - 1}/${rows.length}` } })
  } } })
  const filtros = { escuela: '7', busqueda: 'Estudiante' }
  const pagina = await consultaInscripcionesEav(cliente, filtros).range(20, 39)
  assert.ifError(pagina.error)
  assert.equal(pagina.count, 1102)
  assert.deepEqual(pagina.data.map((p) => p.id), rows.slice(20, 40).map((p) => p.id))
  assert.deepEqual((await leerInscripcionesEav(cliente, filtros)).map((p) => p.id), rows.map((p) => p.id))
  assert.deepEqual(pedidos.slice(1).map((p) => [p.get('offset'), p.get('limit')]), [['0', '500'], ['500', '500'], ['1000', '500']])
})

test('errores posteriores impiden la exportación y la carga incompleta del filtro', async () => {
  let llamadas = 0
  const cliente = createClient('https://ejemplo.invalid', 'clave-ficticia', { global: { fetch: async () => {
    llamadas++
    return llamadas % 2
      ? new Response(JSON.stringify(Array.from({ length: 500 }, (_, i) => inscripcion(i))), { headers: { 'Content-Type': 'application/json', 'Content-Range': '0-499/600' } })
      : new Response(JSON.stringify({ message: 'Fallo de prueba' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  } } })
  await assert.rejects(leerInscripcionesEav(cliente, { escuela: '', busqueda: '' }), (e) => e.message === 'Fallo de prueba')
  await assert.rejects(leerEscuelasEav(cliente), (e) => e.message === 'Fallo de prueba')
})

test('Excel y PDF incluyen las filas filtradas y distinguen legajo pendiente e incompleto', async () => {
  const filas = Array.from({ length: 40 }, (_, i) => ({ ...inscripcion(i), nombre: i === 0 ? '=Estudiante' : `Estudiante ${i}` }))
  const tabla = tablaInscripcionesEav(filas, { escuela: '7', busqueda: 'Estudiante' }, escuela, 'Distrito')
  assert.match(tabla.subtitle, /Escuela de prueba/)
  assert.match(tabla.subtitle, /Búsqueda: Estudiante/)
  const libro = XLSX.read(await buildListadoXlsx(tabla, 'DataEscuela', 'Inscripciones'), { type: 'array' })
  const hoja = libro.Sheets.Inscripciones
  const datos = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' })
  assert.deepEqual(datos[4], ['Escuela de verano', 'Estudiante', 'DNI', 'Nacimiento', 'Temporada', 'Responsable', 'Teléfono', 'Estado', 'Legajo'])
  assert.equal(datos.length, 45)
  assert.equal(datos[5][1], '=Estudiante')
  assert.equal(hoja.B6.f, undefined)
  assert.equal(datos[5][7], 'Preinscripto')
  assert.equal(datos[5][8], 'Pendiente')
  assert.equal(datos[6][7], 'Inscripto')
  assert.equal(datos[6][8], 'Incompleto')
  assert.equal(datos.at(-1)[1], 'Estudiante 39')
  const logo = new Uint8Array(await readFile(new URL('../public/icon-192.png', import.meta.url)))
  const pdf = await PDFDocument.load(await buildPdf(tabla, { brand: { name: 'DataEscuela', logo }, maxCellLines: 30 }))
  assert.ok(pdf.getPageCount() > 1)
  const contenido = pdf.getPages().at(-1).node.Contents()
  const streams = contenido instanceof PDFArray ? Array.from({ length: contenido.size() }, (_, i) => pdf.context.lookup(contenido.get(i))) : [pdf.context.lookup(contenido)]
  assert.match(streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n'), /<457374756469616E7465203339>/)
})

test('los caracteres reservados no rompen el filtro de búsqueda', () => {
  assert.equal(limpiarBusquedaInscripcionesEav('  Nombre,(*) "Sur"\\  '), 'Nombre      Sur')
})
