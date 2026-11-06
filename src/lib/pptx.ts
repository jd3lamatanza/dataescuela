import type { Table } from './export'

export async function buildPptx(tabla: Table): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'DataEscuela'
  pptx.subject = tabla.subtitle
  pptx.title = tabla.title

  const columnas: number[][] = []
  for (let inicio = 1; inicio < tabla.headers.length; inicio += 4) {
    columnas.push([0, ...tabla.headers.slice(inicio, inicio + 4).map((_, i) => inicio + i)])
  }
  if (!columnas.length) columnas.push([0])
  const paginas = Math.max(1, Math.ceil(tabla.rows.length / 8))
  for (const [grupo, indices] of columnas.entries()) {
    for (let pagina = 0; pagina < paginas; pagina++) {
      const slide = pptx.addSlide()
      slide.background = { color: 'FFFFFF' }
      slide.addText('DataEscuela', { x: 0.4, y: 0.17, w: 2, h: 0.25, fontSize: 10, color: '0891B2', bold: true })
      slide.addText(tabla.title, { x: 0.4, y: 0.48, w: 12.5, h: 0.4, fontSize: 22, bold: true, color: '0F172A', fit: 'shrink' })
      slide.addText(tabla.subtitle, { x: 0.4, y: 0.94, w: 12.5, h: 0.35, fontSize: 10, color: '475569', fit: 'shrink' })
      const ancho = 12.5 / indices.length
      const renderFila = (celdas: string[], y: number, header: boolean) => indices.forEach((indice, columna) => {
        slide.addText(celdas[indice] ?? '', {
          x: 0.4 + ancho * columna, y, w: ancho, h: header ? 0.54 : 0.61,
          fontSize: header ? 11 : 10, bold: header, color: header ? '0F3B55' : '1E293B',
          fill: { color: header ? 'E0F2FE' : pagina % 2 ? 'F8FAFC' : 'FFFFFF' },
          line: { color: 'E2E8F0', width: 0.5 }, margin: 0.06, valign: 'middle', fit: 'shrink',
        })
      })
      renderFila(tabla.headers, 1.4, true)
      tabla.rows.slice(pagina * 8, pagina * 8 + 8).forEach((fila, i) => renderFila(fila, 1.94 + i * 0.61, false))
      slide.addText(`Columnas ${grupo + 1}/${columnas.length} · página ${pagina + 1}/${paginas}`, { x: 0.4, y: 7.12, w: 12.5, h: 0.18, fontSize: 9, color: '64748B', align: 'right' })
    }
  }
  const bytes = await pptx.write({ outputType: 'arraybuffer', compression: true })
  if (!(bytes instanceof ArrayBuffer)) throw new Error('No se pudo generar la presentación.')
  return new Uint8Array(bytes)
}
