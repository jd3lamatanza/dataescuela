import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { generarConstancia } from '../supabase/functions/_shared/constancia.ts'

Deno.test('genera una constancia A5 con imágenes y datos extensos', async () => {
  const imagen = await Deno.readFile('public/pba-logo.png')
  const base64 = btoa(Array.from(imagen, (n) => String.fromCharCode(n)).join(''))
  const pdf = await generarConstancia(
    { nombre: 'Encuentro '.repeat(20), lugar: 'Escuela '.repeat(25), fecha: '2026-11-16', hora_inicio: '10:00:00', hora_fin: '12:00:00' },
    { nombre: 'Apellido '.repeat(22), email: 'prueba@abc.gob.ar' },
    [{ mime: 'image/png', base64 }, { mime: 'image/png', base64 }],
  )
  const documento = await PDFDocument.load(pdf)
  const paginas = documento.getPages()
  if (paginas.length !== 1) throw new Error('La constancia debe tener una hoja')
  const { width, height } = paginas[0].getSize()
  if (width !== 419.53 || height !== 595.28) throw new Error(`Tamaño A5 incorrecto: ${width} x ${height}`)
})
