import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'npm:pdf-lib@1.17.1'

export type EventoConstancia = { nombre: string; lugar: string; fecha: string; hora_inicio: string; hora_fin: string }
export type PersonaConstancia = { nombre: string; cargo: string; escuela: string; adicionales?: { cargo: string; escuela: string }[] }
export type FirmaConstancia = { mime: string; base64: string }

function lineas(texto: string, font: PDFFont, size: number, width: number) {
  const result: string[] = []
  let actual = ''
  for (const word of texto.split(/\s+/)) {
    const next = actual ? `${actual} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= width) { actual = next; continue }
    if (actual) result.push(actual)
    actual = ''
    for (const char of word) {
      if (font.widthOfTextAtSize(actual + char, size) > width) { result.push(actual); actual = '' }
      actual += char
    }
  }
  if (actual) result.push(actual)
  return result
}

export async function generarConstancia(evento: EventoConstancia, persona: PersonaConstancia, firmas: FirmaConstancia[]) {
  const doc = await PDFDocument.create()
  let page = doc.addPage([419.53, 595.28])
  const regular = await doc.embedFont(StandardFonts.Helvetica), negrita = await doc.embedFont(StandardFonts.HelveticaBold)
  const { width, height } = page.getSize()
  const centrar = (text: string, y: number, font: PDFFont, size: number) => page.drawText(text, { x: (width - font.widthOfTextAtSize(text, size)) / 2, y, font, size })
  const encabezado = () => {
    page.drawRectangle({ x: 19, y: 19, width: width - 38, height: height - 38, borderColor: rgb(0, 0, 0), borderWidth: 0.7 })
    centrar('DGCyE de la Provincia de Buenos Aires', 535, negrita, 12)
    centrar('Jefatura Distrital 3 - La Matanza', 518, regular, 11)
    centrar('Sistema de Acreditación DataEscuela', 502, regular, 10)
    centrar('Constancia General', 456, negrita, 17)
  }
  encabezado()
  const fecha = evento.fecha.split('-')
  const hoy = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(new Date())
  const parte = (tipo: string) => hoy.find((p) => p.type === tipo)?.value ?? ''
  const cargos = [{ cargo: persona.cargo, escuela: persona.escuela }, ...(persona.adicionales ?? [])]
    .map((e) => `con cargo ${e.cargo} en ${e.escuela}`).join('; ')
  const textos = [
    `Se deja constancia que ${persona.nombre} ${cargos} ha participado de ${evento.nombre} realizada el día ${fecha[2]}/${fecha[1]}/${fecha[0]} en el horario de ${evento.hora_inicio.slice(0, 5)} a ${evento.hora_fin.slice(0, 5)} en ${evento.lugar} a los efectos de ser presentada ante quien corresponda.`,
    `Se extiende la presente a los ${parte('day')} del mes de ${parte('month')} de ${parte('year')}.`,
  ]
  let size = 11
  let bloques = textos.map((texto) => lineas(texto, regular, size, width - 90))
  while (bloques.reduce((n, bloque) => n + bloque.length, 0) * (size + 7) + 40 > 240 && size > 7) {
    size -= 0.5
    bloques = textos.map((texto) => lineas(texto, regular, size, width - 90))
  }
  const multipagina = bloques.reduce((n, bloque) => n + bloque.length, 0) * (size + 7) + 40 > 240
  let y = 410
  for (const [indice, bloque] of bloques.entries()) {
    for (const linea of bloque) {
      if (multipagina && y < 165) { page = doc.addPage([width, height]); encabezado(); y = 410 }
      page.drawText(linea, { x: 45, y, font: regular, size }); y -= size + 7
    }
    if (indice < bloques.length - 1) y -= 20
  }
  if (firmas.length > 6) throw new Error('Se admiten hasta seis imágenes de firmas.')
  const espacio = (width - 100) / Math.max(firmas.length, 1)
  const parteSuperior = y - 8
  const alturaDisponible = Math.min(140, parteSuperior - 35)
  for (let i = 0; i < firmas.length; i++) {
    const bytes = Uint8Array.from(atob(firmas[i].base64.replace(/\s/g, '')), (c) => c.charCodeAt(0))
    const image = firmas[i].mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    const scale = Math.min((espacio - 8) / image.width, alturaDisponible / image.height)
    page.drawImage(image, { x: 50 + i * espacio + (espacio - image.width * scale) / 2, y: parteSuperior - image.height * scale, width: image.width * scale, height: image.height * scale })
  }
  return await doc.save()
}
