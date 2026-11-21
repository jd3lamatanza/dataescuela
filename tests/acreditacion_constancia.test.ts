import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from 'npm:pdf-lib@1.17.1'
import { generarConstancia } from '../supabase/functions/_shared/constancia.ts'

async function imagen(nombre: string) {
  const bytes = await Deno.readFile(`public/${nombre}`)
  return { mime: 'image/png', base64: btoa(Array.from(bytes, (n) => String.fromCharCode(n)).join('')) }
}

function contenido(documento: PDFDocument, pagina = 0) {
  const referencias = documento.context.lookup(documento.getPages()[pagina].node.Contents(), PDFArray)
  const stream = documento.context.lookup(referencias.get(0))
  if (!(stream instanceof PDFRawStream)) throw new Error('El contenido del PDF no es un stream.')
  return new TextDecoder().decode(decodePDFRawStream(stream).decode())
}

Deno.test('genera una constancia A5 con imágenes y datos extensos', async () => {
  const firma = await imagen('pba-logo.png')
  const pdf = await generarConstancia(
    { nombre: 'Encuentro '.repeat(20), lugar: 'Escuela '.repeat(25), fecha: '2026-11-16', hora_inicio: '10:00:00', hora_fin: '12:00:00' },
    { nombre: 'Apellido '.repeat(22), cargo: 'Docente '.repeat(10), escuela: 'EP 10 Escuela del Sol' },
    [firma, firma],
  )
  const documento = await PDFDocument.load(pdf)
  const paginas = documento.getPages()
  if (paginas.length !== 1) throw new Error('La constancia debe tener una hoja')
  const { width, height } = paginas[0].getSize()
  if (width !== 419.53 || height !== 595.28) throw new Error(`Tamaño A5 incorrecto: ${width} x ${height}`)
  const posiciones = [...contenido(documento).matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) cm\n1 0 0 1 0 0 cm\n([\d.]+) 0 0 ([\d.]+) 0 0 cm\n1 0 0 1 0 0 cm\n\/Image/g)]
  if (posiciones.length !== 2 || posiciones.some((m) => Number(m[2]) < 35 || Number(m[1]) + Number(m[3]) > width - 19)) {
    throw new Error('Las imágenes deben permanecer dentro del marco de la constancia.')
  }
})

Deno.test('una constancia contiene las cuatro escuelas y sus cargos incluso con datos extensos', async () => {
  const firma = await imagen('icon-192.png')
  const pdf = await generarConstancia(
    { nombre: 'Encuentro '.repeat(19), lugar: 'Lugar '.repeat(32), fecha: '2026-11-16', hora_inicio: '10:00', hora_fin: '12:00' },
    { nombre: 'Persona '.repeat(24), cargo: 'CargoUno ' + 'cargo '.repeat(30), escuela: 'EscuelaUno ' + 'sede '.repeat(32),
      adicionales: [
        { cargo: 'CargoDos ' + 'cargo '.repeat(30), escuela: 'EscuelaDos ' + 'sede '.repeat(32) },
        { cargo: 'CargoTres ' + 'cargo '.repeat(30), escuela: 'EscuelaTres ' + 'sede '.repeat(32) },
        { cargo: 'CargoCuatro ' + 'cargo '.repeat(30), escuela: 'EscuelaCuatro ' + 'sede '.repeat(32) },
      ] },
    [firma],
  )
  const documento = await PDFDocument.load(pdf)
  if (documento.getPageCount() < 2) throw new Error('Los datos extensos deben continuar en otra página del mismo PDF')
  const operaciones = documento.getPages().map((_, i) => contenido(documento, i))
  const texto = operaciones.flatMap((pagina) => [...pagina.matchAll(/1 0 0 1 45 ([\d.]+) Tm\n<([0-9A-F]+)> Tj/g)]
    .map((m) => {
      if (Number(m[1]) < 150 || Number(m[1]) > 410) throw new Error('Texto fuera del área de contenido')
      return new TextDecoder('windows-1252').decode(Uint8Array.from(m[2].match(/../g)!, (n) => parseInt(n, 16)))
    })).join(' ')
  for (const dato of ['CargoUno', 'EscuelaUno', 'CargoDos', 'EscuelaDos', 'CargoTres', 'EscuelaTres', 'CargoCuatro', 'EscuelaCuatro']) {
    if (!texto.includes(dato)) throw new Error(`Falta ${dato}`)
  }
  if (!operaciones.at(-1)?.includes('/Image')) throw new Error('Falta la firma al final')
})

Deno.test('incluye cargo y escuela y ubica sellos grandes justo después del texto', async () => {
  const firma = await imagen('icon-192.png')
  const pdf = await generarConstancia(
    { nombre: 'Encuentro de docentes', lugar: 'Escuela central', fecha: '2026-11-16', hora_inicio: '10:00', hora_fin: '12:00' },
    { nombre: 'Ana Perez', cargo: 'Directora', escuela: 'EP 10 Escuela del Sol' },
    [firma, firma],
  )
  const operaciones = contenido(await PDFDocument.load(pdf))
  const textos = [...operaciones.matchAll(/1 0 0 1 45 ([\d.]+) Tm\n<([0-9A-F]+)> Tj/g)]
  const texto = textos.map((m) => new TextDecoder('windows-1252').decode(Uint8Array.from(m[2].match(/../g)!, (n) => parseInt(n, 16)))).join(' ')
  if (!texto.includes('Se deja constancia que Ana Perez con cargo Directora en EP 10 Escuela del Sol ha participado de Encuentro de docentes')) {
    throw new Error('La constancia no incluye el cargo y la escuela en el cuerpo.')
  }
  const posiciones = [...operaciones.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) cm\n1 0 0 1 0 0 cm\n([\d.]+) 0 0 ([\d.]+) 0 0 cm\n1 0 0 1 0 0 cm\n\/Image/g)]
  const ultimaLinea = Number(textos.at(-1)?.[1])
  if (posiciones.length !== 2 || posiciones.some((m) => {
    const ancho = Number(m[3]), alto = Number(m[4]), arriba = Number(m[2]) + alto
    return ancho < 120 || alto < 120 || ultimaLinea - arriba < 10 || ultimaLinea - arriba > 35
  })) throw new Error('Los sellos deben ser grandes y ubicarse inmediatamente después del texto.')
  if (Number(posiciones[0][1]) + Number(posiciones[0][3]) > Number(posiciones[1][1])) {
    throw new Error('Los sellos deben estar en una sola línea sin superponerse.')
  }
})
