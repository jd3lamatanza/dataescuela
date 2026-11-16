import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'npm:pdf-lib@1.17.1'
import * as XLSX from 'npm:xlsx@0.18.5'
import { estadoConstancia, tablaAcreditados } from '../src/lib/acreditacionListado.ts'
import { buildListadoXlsx } from '../src/lib/escuelasListado.ts'
import { buildPdf } from '../src/lib/export.ts'
import type { Evento, Persona } from '../src/lib/acreditacionTipos.ts'

const evento: Evento = { id: 'abc', nombre: 'Encuentro docente', lugar: 'Escuela central', fecha: '2026-11-16', hora_inicio: '10:00:00', hora_fin: '12:00:00', descripcion: 'Jornada distrital', estado: 'finalizado' }
const persona: Persona = { id: 1, nombre: '=Ana Pérez', dni: '01234567', cargo: 'Directora', escuela_id: 1, escuela_externa: null, escuela: { id: 1, tipo: 'EP', numero: 10, nombre: 'Escuela del Sol', localidad: 'Catán', codigo: null, eav: null, clave: '0123EP0010' }, email: 'ana@abc.gob.ar', envio_estado: 'pendiente', constancia_enviada_en: null }
const comprobar = (condicion: boolean, mensaje: string) => { if (!condicion) throw new Error(mensaje) }

Deno.test('listado incluye datos del evento, filtros, escuela y estados precisos', () => {
  const enviados = { ...persona, envio_estado: 'enviado', constancia_enviada_en: '2026-11-16T12:00:00Z' }
  const incierto = { ...persona, envio_estado: 'incierto' }
  const enCurso = { ...persona, envio_estado: 'enviando' }
  const tabla = tablaAcreditados(evento, [persona, enviados, incierto, enCurso], 'Pérez', 'Jefatura Distrital 3')
  for (const dato of ['Encuentro docente', '16/11/2026', '10:00 a 12:00', 'Escuela central', 'Jornada distrital', 'Pérez', '4 acreditado']) comprobar(tabla.subtitle.includes(dato), `Falta ${dato}`)
  comprobar(tabla.rows[0][3] === '0123EP0010', 'Falta la clave provincial de la escuela')
  const externa = tablaAcreditados(evento, [{ ...persona, escuela_id: null, escuela: null, escuela_externa: 'Escuela externa' }], '', 'Distrito')
  comprobar(externa.rows[0][3] === 'Escuela externa', 'Falta la escuela externa')
  comprobar(tabla.rows[0][1] === '01234567', 'El DNI debe conservar sus ceros')
  comprobar(tabla.rows[1][5].startsWith('Enviada ·'), 'Falta fecha de envío')
  comprobar(estadoConstancia(incierto).texto === 'Envío sin confirmar', 'Falta estado incierto')
  comprobar(estadoConstancia(enCurso).texto === 'Envío en curso', 'Falta estado en curso')
})

Deno.test('Excel y PDF incluyen marca, metadatos y todas las filas', async () => {
  const tabla = tablaAcreditados(evento, Array.from({ length: 80 }, (_, i) => ({ ...persona, id: i + 1 })), '', 'Jefatura Distrital 3')
  const libro = XLSX.read(await buildListadoXlsx(tabla, 'DataEscuela v2', 'Acreditados'), { type: 'array' })
  const hoja = libro.Sheets.Acreditados
  const filas = XLSX.utils.sheet_to_json<string[]>(hoja, { header: 1, defval: '' })
  comprobar(filas.length === 85 && filas[0][0] === 'DataEscuela v2', 'Excel no incluye encabezado o todas las filas')
  comprobar(filas[2][0].includes('Encuentro docente') && filas[5][0] === '=Ana Pérez' && !hoja.A6.f && filas[5][1] === '01234567', 'Excel no conserva metadatos o texto seguro')
  const logo = await Deno.readFile('public/icon-192.png')
  const documento = await PDFDocument.load(await buildPdf(tabla, { brand: { name: 'DataEscuela v2', logo }, maxCellLines: 60 }))
  comprobar(documento.getPageCount() > 1, 'El PDF debe paginar el listado')
  const texto = documento.getPages().map((pagina) => {
    const array = documento.context.lookup(pagina.node.Contents(), PDFArray)
    return Array.from({ length: array.size() }, (_, i) => {
      const stream = documento.context.lookup(array.get(i))
      if (!(stream instanceof PDFRawStream)) throw new Error('Contenido PDF inválido')
      return new TextDecoder().decode(decodePDFRawStream(stream).decode())
    }).join('\n')
  })
  comprobar(texto[0].includes('<4461746145736375656C61207632>') && texto[0].includes('456E6375656E74726F20646F63656E7465'), 'Faltan marca o evento en PDF')
  comprobar(texto.slice(1).every((pagina) => pagina.includes('<444E49>')), 'Faltan encabezados de tabla en páginas siguientes')
  comprobar(texto.join('\n').split('<3031323334353637>').length - 1 === 80, 'El PDF no contiene todas las filas')
})
