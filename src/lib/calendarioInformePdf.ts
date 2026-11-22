import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { fechasDelMes, ordenarInforme, protegerCuil, type EntradaInforme } from './calendarioInforme'

export type FormatoInforme = 'resumido' | 'analitico'

export function fechaLarga(fecha: string): string {
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${fecha}T00:00:00Z`))
}

function imprimible(texto: string, font: PDFFont): string {
  const caracteres = new Set(font.getCharacterSet())
  return [...protegerCuil(texto)].map((c) => {
    const cp = c.codePointAt(0)!
    if (c === '\n' || c === '\t') return c
    return caracteres.has(cp) ? c : `[U+${cp.toString(16).toUpperCase().padStart(4, '0')}]`
  }).join('')
}

function envolver(texto: string, font: PDFFont, size: number, ancho: number): string[] {
  const lineas: string[] = []
  for (const parrafo of imprimible(texto.replace(/\r\n?/g, '\n'), font).replace(/\t/g, ' ').split('\n')) {
    let linea = ''
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      let resto = palabra
      const posible = linea ? `${linea} ${resto}` : resto
      if (font.widthOfTextAtSize(posible, size) <= ancho) { linea = posible; continue }
      if (linea) { lineas.push(linea); linea = '' }
      while (resto && font.widthOfTextAtSize(resto, size) > ancho) {
        let fin = 1
        while (fin < resto.length && font.widthOfTextAtSize(resto.slice(0, fin + 1), size) <= ancho) fin++
        lineas.push(resto.slice(0, fin))
        resto = resto.slice(fin)
      }
      linea = resto
    }
    lineas.push(linea)
  }
  return lineas
}

export async function buildCalendarioPdf(ano: number, mes: number, entradas: readonly EntradaInforme[], formato: FormatoInforme): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ancho = 595.28, alto = 841.89, margen = 40, interlineado = 13
  const paginas: ReturnType<typeof pdf.addPage>[] = []
  let pagina = pdf.addPage([ancho, alto])
  paginas.push(pagina)
  let y = alto - margen
  const agregarPagina = () => { pagina = pdf.addPage([ancho, alto]); paginas.push(pagina); y = alto - margen }
  const texto = (contenido: string, opciones: { negrita?: boolean; size?: number; sangria?: number; espacio?: number } = {}) => {
    const font = opciones.negrita ? negrita : normal
    const size = opciones.size ?? 9.5
    const sangria = opciones.sangria ?? 0
    for (const linea of envolver(contenido, font, size, ancho - 2 * margen - sangria)) {
      if (y < margen + interlineado) agregarPagina()
      if (linea) pagina.drawText(linea, { x: margen + sangria, y, size, font, color: rgb(0.1, 0.15, 0.22) })
      y -= interlineado
    }
    y -= opciones.espacio ?? 0
  }
  const mesNombre = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(ano, mes, 1)))
  texto('DataEscuela · Calendario distrital', { negrita: true, size: 15, espacio: 6 })
  texto(`${mesNombre} · Informe ${formato === 'analitico' ? 'analítico' : 'resumido'}`, { negrita: true, size: 11 })
  texto('Incluye los tipos activados en el calendario. Los adjuntos se consultan en su módulo; se omiten los CUIL.', { espacio: 9 })
  const ordenadas = ordenarInforme(entradas)
  for (const fecha of fechasDelMes(ano, mes)) {
    const dia = ordenadas.filter((e) => e.fecha === fecha)
    if (y < margen + 3 * interlineado) agregarPagina()
    texto(fechaLarga(fecha), { negrita: true, size: 11, espacio: 2 })
    if (!dia.length) texto('Sin eventos.', { sangria: 10, espacio: 5 })
    for (const e of dia) {
      texto(`${e.tipo} · ${e.titulo}`, { negrita: true, sangria: 10 })
      for (const c of formato === 'analitico' ? e.detalles : e.resumen) {
        texto(`${c.etiqueta}: ${c.valor}`, { sangria: 20 })
      }
      y -= 5
    }
  }
  paginas.forEach((p, i) => p.drawText(`Página ${i + 1} de ${paginas.length}`, { x: ancho - margen - 70, y: 20, size: 8, font: normal, color: rgb(0.4, 0.45, 0.5) }))
  return pdf.save()
}
