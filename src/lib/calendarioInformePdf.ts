import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import { agruparPorTipo, fechasDelMes, ordenarInforme, protegerCuil, type EntradaInforme } from './calendarioInforme'

export type FormatoInforme = 'resumido' | 'analitico'

const paleta: Record<string, { tinta: ReturnType<typeof rgb>; fondo: ReturnType<typeof rgb> }> = {
  green: { tinta: rgb(0.09, 0.40, 0.20), fondo: rgb(0.90, 0.97, 0.91) },
  blue: { tinta: rgb(0.12, 0.25, 0.69), fondo: rgb(0.91, 0.94, 1) },
  orange: { tinta: rgb(0.60, 0.22, 0.05), fondo: rgb(1, 0.94, 0.88) },
  red: { tinta: rgb(0.60, 0.11, 0.11), fondo: rgb(1, 0.92, 0.92) },
  cyan: { tinta: rgb(0.08, 0.37, 0.44), fondo: rgb(0.89, 0.97, 0.98) },
  violet: { tinta: rgb(0.35, 0.13, 0.67), fondo: rgb(0.95, 0.92, 1) },
  amber: { tinta: rgb(0.57, 0.25, 0.06), fondo: rgb(1, 0.96, 0.85) },
  slate: { tinta: rgb(0.20, 0.25, 0.33), fondo: rgb(0.94, 0.96, 0.98) },
}

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
  const texto = (contenido: string, opciones: { negrita?: boolean; size?: number; sangria?: number; espacio?: number; fondo?: ReturnType<typeof rgb>; barra?: ReturnType<typeof rgb>; color?: ReturnType<typeof rgb> } = {}) => {
    const font = opciones.negrita ? negrita : normal
    const size = opciones.size ?? 9.5
    const sangria = opciones.sangria ?? 0
    for (const linea of envolver(contenido, font, size, ancho - 2 * margen - sangria)) {
      if (y < margen + interlineado) agregarPagina()
      if (opciones.fondo) pagina.drawRectangle({ x: margen, y: y - 3, width: ancho - 2 * margen, height: interlineado, color: opciones.fondo })
      if (opciones.barra) pagina.drawRectangle({ x: margen + 10, y: y - 3, width: 3, height: interlineado, color: opciones.barra })
      if (linea) pagina.drawText(linea, { x: margen + sangria, y, size, font, color: opciones.color ?? rgb(0.1, 0.15, 0.22) })
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
    texto(fechaLarga(fecha), { negrita: true, size: 11, sangria: 8, fondo: paleta.slate.fondo, espacio: 2 })
    if (!dia.length) texto('Sin eventos.', { sangria: 10, espacio: 5 })
    for (const grupo of agruparPorTipo(dia)) {
      const estilo = paleta[grupo[0].estilo.color] ?? paleta.slate
      if (y < margen + 4 * interlineado) agregarPagina()
      texto(`${grupo[0].tipo} · ${grupo.length} ${grupo.length === 1 ? 'evento' : 'eventos'}`,
        { negrita: true, sangria: 8, fondo: estilo.fondo, color: estilo.tinta, espacio: 3 })
      for (const e of grupo) {
        texto(e.titulo, { negrita: true, sangria: 20, barra: estilo.tinta })
        for (const c of formato === 'analitico' ? e.detalles : e.resumen) {
          texto(`${c.etiqueta}: ${c.valor}`, { sangria: 20, barra: estilo.tinta })
        }
        y -= 5
      }
    }
  }
  paginas.forEach((p, i) => p.drawText(`Página ${i + 1} de ${paginas.length}`, { x: ancho - margen - 70, y: 20, size: 8, font: normal, color: rgb(0.4, 0.45, 0.5) }))
  return pdf.save()
}
