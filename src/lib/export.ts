import { zipSync, strToU8 } from 'fflate'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'

export interface Table {
  title: string
  subtitle: string
  headers: string[]
  /** Anchos relativos de columna */
  widths: number[]
  rows: string[][]
}

export interface PdfOptions {
  brand?: { name: string; logo: Uint8Array }
  indicators?: (number | null)[][]
}

// Quita caracteres de control que invalidan el XML
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
const esc = (s: string) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const colName = (i: number) => String.fromCharCode(65 + i)

const STYLES_TEXT =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'

function pack(sheet: string, stylesXml: string, sheetXml: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    'xl/styles.xml': strToU8(stylesXml),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  }
  return zipSync(files)
}

/** Genera un .xlsx mínimo (todo como texto, sin fórmulas). */
export function buildXlsx(t: Table, sheet = 'Egresantes', numeric: number[] = []): Uint8Array {
  const cell = (c: number, r: number, v: string, style = 0) =>
    r > 1 && numeric.includes(c) && /^\d+$/.test(v) ? `<c r="${colName(c)}${r}"><v>${v}</v></c>` : `<c r="${colName(c)}${r}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`
  const rows = [t.headers, ...t.rows]
    .map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => cell(ci, ri + 1, v, ri === 0 ? 1 : 0)).join('')}</row>`)
    .join('')
  const cols = t.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(10, Math.round(w * 1.6))}" customWidth="1"/>`).join('')
  return pack(sheet, STYLES_TEXT, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`)
}

// Helvetica (WinAnsi) solo admite Latin-1: lo demás se reemplaza.
const latin = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')

function wrap(text: string, font: PDFFont, size: number, width: number, maxLines: number): string[] {
  const words = latin(text).split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  const fit = (w: string) => {
    // Palabras más largas que la celda se cortan
    while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
      let n = w.length - 1
      while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--
      if (line) { lines.push(line); line = '' }
      lines.push(w.slice(0, n))
      w = w.slice(n)
    }
    return w
  }
  for (let w of words) {
    w = fit(w)
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) <= width) line = next
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines)
    cut[maxLines - 1] = cut[maxLines - 1].replace(/.{0,3}$/, '...')
    return cut
  }
  return lines.length ? lines : ['']
}

/** Genera un PDF A4 horizontal con la tabla, repitiendo el encabezado en cada página. */
export async function buildPdf(t: Table, options: PdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = options.brand ? await doc.embedPng(options.brand.logo) : null
  const W = 841.89, H = 595.28, M = 28, size = 8, lh = 10.5, pad = 4
  const total = t.widths.reduce((a, b) => a + b, 0)
  const cw = t.widths.map((w) => ((W - M * 2) * w) / total)
  const pages: ReturnType<typeof doc.addPage>[] = []
  let page = doc.addPage([W, H])
  pages.push(page)
  let y = H - M

  const header = () => {
    const h = lh + pad * 2
    page.drawRectangle({ x: M, y: y - h, width: W - M * 2, height: h, color: rgb(0.93, 0.96, 0.99) })
    let x = M
    t.headers.forEach((v, i) => {
      page.drawText(latin(v), { x: x + pad, y: y - pad - 8, size, font: bold, color: rgb(0.1, 0.2, 0.4) })
      x += cw[i]
    })
    y -= h
  }

  if (logo && options.brand) {
    page.drawImage(logo, { x: M, y: y - 32, width: 32, height: 32 })
    page.drawText(latin(options.brand.name), { x: M + 40, y: y - 21, size: 13, font: bold, color: rgb(0.06, 0.15, 0.35) })
    y -= 42
  }
  page.drawText(latin(t.title), { x: M, y: y - 14, size: 15, font: bold, color: rgb(0.06, 0.15, 0.35) })
  y -= 30
  const subtitleLines = options.brand ? wrap(t.subtitle, font, 9, W - M * 2, 50) : [latin(t.subtitle)]
  subtitleLines.forEach((line, i) => page.drawText(line, { x: M, y: y - 2 - i * 11, size: 9, font, color: rgb(0.35, 0.4, 0.5) }))
  y -= 18 + (subtitleLines.length - 1) * 11
  header()

  for (const [rowIndex, row] of t.rows.entries()) {
    const indicators = options.indicators?.[rowIndex]
    const cells = row.map((v, i) => wrap(v, font, size, cw[i] - pad * 2 - (indicators?.[i] != null ? 11 : 0), 3))
    const h = Math.max(...cells.map((l) => l.length)) * lh + pad * 2 - 2
    if (y - h < M + 14) {
      page = doc.addPage([W, H])
      pages.push(page)
      y = H - M
      header()
    }
    let x = M
    cells.forEach((lines, i) => {
      const value = indicators?.[i]
      const color = value == null ? rgb(0.1, 0.12, 0.18)
        : value > 0 ? rgb(0.016, 0.47, 0.337) : value < 0 ? rgb(0.725, 0.11, 0.11) : rgb(0.392, 0.455, 0.545)
      if (value != null) {
        const cx = x + pad + 4, cy = y - pad - 4
        if (value === 0) {
          for (const dy of [-1.5, 1.5]) page.drawLine({ start: { x: cx - 3, y: cy + dy }, end: { x: cx + 3, y: cy + dy }, thickness: 1.2, color })
        } else {
          const direction = value > 0 ? 1 : -1
          page.drawLine({ start: { x: cx, y: cy - 4 }, end: { x: cx, y: cy + 4 }, thickness: 1.2, color })
          for (const dx of [-3, 3]) page.drawLine({ start: { x: cx, y: cy + direction * 4 }, end: { x: cx + dx, y: cy + direction }, thickness: 1.2, color })
        }
      }
      lines.forEach((l, li) => page.drawText(l, { x: x + pad + (value != null ? 11 : 0), y: y - pad - 8 - li * lh, size, font, color }))
      x += cw[i]
    })
    y -= h
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: rgb(0.85, 0.88, 0.92) })
  }

  pages.forEach((p, i) =>
    p.drawText(`Página ${i + 1} de ${pages.length}`, { x: W - M - 70, y: 14, size: 8, font, color: rgb(0.5, 0.55, 0.6) }),
  )
  return doc.save()
}

// ---- Cuadro cruzado: cursos en filas, turnos en columnas (Secciones / Matrícula / Asistencia) ----

export interface Grid {
  title: string
  first: string
  totalLabel: string
  turnos: string[]
  metricas: string[]
  rows: { label: string; cells: (number[] | null)[]; total: number[]; kind: 'row' | 'total' | 'grand' }[]
}

const sumaMetricas = (xs: number[][], n: number) => xs.reduce((a, x) => a.map((v, i) => v + (x[i] ?? 0)), Array(n).fill(0) as number[])

/** Arma un cuadro por plan y, si hay varios planes, un cuadro de totales generales al final. */
export function buildGrids(filas: { plan: string; curso: string; turno: string; hora: string | null; secciones: number; matricula: number; inclusion?: number; asistencia: number }[], especial = false): Grid[] {
  const metricas = especial ? ['Secc.', 'Matr.', 'Incl.', 'Asist.'] : ['Secc.', 'Matr.', 'Asist.']
  const valores = (f: typeof filas[number]) => especial ? [f.secciones, f.matricula, f.inclusion ?? 0, f.asistencia] : [f.secciones, f.matricula, f.asistencia]
  const orden = (xs: typeof filas) =>
    [...new Map(xs.slice().sort((a, b) => String(a.hora ?? '99').localeCompare(String(b.hora ?? '99')) || a.turno.localeCompare(b.turno)).map((f) => [f.turno, f.turno])).keys()]
  const planes = [...new Set(filas.map((f) => f.plan))]
  const grids: Grid[] = []
  const porPlan: { plan: string; cells: (number[] | null)[]; total: number[] }[] = []
  const turnosAll = orden(filas)
  for (const plan of planes) {
    const rs = filas.filter((f) => f.plan === plan)
    const turnos = orden(rs)
    const cursos = [...new Set(rs.map((f) => f.curso))]
    const celda = (cu: string | null, t: string) => {
      const xs = rs.filter((f) => (cu === null || f.curso === cu) && f.turno === t).map(valores)
      return xs.length ? sumaMetricas(xs, metricas.length) : null
    }
    const rows: Grid['rows'] = cursos.map((cu) => ({
      label: cu,
      cells: turnos.map((t) => celda(cu, t)),
      total: sumaMetricas(rs.filter((f) => f.curso === cu).map(valores), metricas.length),
      kind: 'row',
    }))
    const total = sumaMetricas(rs.map(valores), metricas.length)
    rows.push({ label: 'Total del plan', cells: turnos.map((t) => celda(null, t)), total, kind: 'total' })
    grids.push({ title: plan, first: 'Curso', totalLabel: 'Total curso', turnos, metricas, rows })
    porPlan.push({ plan, cells: turnosAll.map((t) => celda(null, t)), total })
  }
  if (planes.length > 1) {
    const rows: Grid['rows'] = porPlan.map((p) => ({ label: p.plan, cells: p.cells, total: p.total, kind: 'row' as const }))
    rows.push({
      label: 'TOTAL GENERAL',
      cells: turnosAll.map((_, i) => {
        const xs = porPlan.map((p) => p.cells[i]).filter((x): x is number[] => !!x)
        return xs.length ? sumaMetricas(xs, metricas.length) : null
      }),
      total: sumaMetricas(porPlan.map((p) => p.total), metricas.length),
      kind: 'grand',
    })
    grids.push({ title: 'Totales generales', first: 'Plan de estudio', totalLabel: 'Total plan', turnos: turnosAll, metricas, rows })
  }
  return grids
}

const colL = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const MATRIZ_STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCEBFA"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F5"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB8C0CC"/></left><right style="thin"><color rgb="FFB8C0CC"/></right><top style="thin"><color rgb="FFB8C0CC"/></top><bottom style="thin"><color rgb="FFB8C0CC"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs></styleSheet>'

/** .xlsx con los cuadros cruzados: turnos agrupados en 3 columnas (Secc. / Matr. / Asist.) con celdas combinadas. */
export function buildMatrizXlsx(title: string, subtitle: string, grids: Grid[], sheet: string): Uint8Array {
  const rows: string[] = []
  const merges: string[] = []
  let r = 0
  const str = (ci: number, v: string, st: number) => `<c r="${colL(ci)}${r}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
  const num = (ci: number, v: number, st: number) => `<c r="${colL(ci)}${r}" s="${st}"><v>${v}</v></c>`
  const push = (cells: string[]) => rows.push(`<row r="${r}">${cells.join('')}</row>`)
  const celdasMetricas = (ci: number, v: number[] | null, kind: string, tot: boolean, medidas: string[]) => {
    const bold = kind !== 'row' || tot
    return medidas.map((_, j) => (v ? num(ci + j, v[j], bold ? 6 : 4) : str(ci + j, '—', bold ? 6 : 8)))
  }

  r++; push([str(0, title, 7)])
  r++; push([str(0, subtitle, 0)])
  r++
  let ncols = 1
  for (const g of grids) {
    ncols = Math.max(ncols, 1 + (g.turnos.length + 1) * g.metricas.length)
    r++; push([str(0, g.title, 1)])
    const h1 = ++r
    const cells = [str(0, g.first, 2)]
    ;[...g.turnos, g.totalLabel].forEach((t, i) => {
      const c0 = 1 + i * g.metricas.length
      cells.push(str(c0, t, 2), ...g.metricas.slice(1).map((_, j) => str(c0 + j + 1, '', 2)))
      merges.push(`${colL(c0)}${h1}:${colL(c0 + g.metricas.length - 1)}${h1}`)
    })
    push(cells)
    r++
    push([str(0, '', 2), ...[...g.turnos, ''].flatMap((_, i) => g.metricas.map((x, j) => str(1 + i * g.metricas.length + j, x, 2)))])
    merges.push(`A${h1}:A${r}`)
    for (const row of g.rows) {
      r++
      const bold = row.kind !== 'row'
      push([
        str(0, row.label, bold ? 5 : 3),
        ...row.cells.flatMap((v, i) => celdasMetricas(1 + i * g.metricas.length, v, row.kind, false, g.metricas)),
        ...celdasMetricas(1 + g.turnos.length * g.metricas.length, row.total, row.kind, true, g.metricas),
      ])
    }
    r++
  }
  const cols = Array.from({ length: ncols }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 28 : 9}" customWidth="1"/>`).join('')
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells></worksheet>`
  return pack(sheet, MATRIZ_STYLES, sheetXml)
}

/** PDF A4 horizontal con los mismos cuadros cruzados. */
export async function buildMatrizPdf(title: string, subtitle: string, grids: Grid[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 841.89, H = 595.28, M = 28, LW = 130, RH = 16
  const ink = rgb(0.1, 0.12, 0.18)
  const pages: ReturnType<typeof doc.addPage>[] = []
  let page = doc.addPage([W, H])
  pages.push(page)
  let y = H - M

  const box = (x: number, w: number, text: string, o: { b?: boolean; fill?: ReturnType<typeof rgb>; align?: 'l' | 'c' | 'r'; h?: number } = {}) => {
    const h = o.h ?? RH
    page.drawRectangle({ x, y: y - h, width: w, height: h, color: o.fill, borderColor: rgb(0.72, 0.75, 0.8), borderWidth: 0.4 })
    const f = o.b ? bold : font
    const t = latin(text)
    const tw = f.widthOfTextAtSize(t, 8)
    const tx = o.align === 'r' ? x + w - 4 - tw : o.align === 'c' ? x + (w - tw) / 2 : x + 4
    page.drawText(t, { x: tx, y: y - h / 2 - 2.8, size: 8, font: f, color: ink })
  }
  const blue = rgb(0.86, 0.92, 0.98), gray = rgb(0.93, 0.94, 0.96)

  page.drawText(latin(title), { x: M, y: y - 14, size: 15, font: bold, color: rgb(0.06, 0.15, 0.35) })
  y -= 30
  page.drawText(latin(subtitle), { x: M, y: y - 2, size: 9, font, color: rgb(0.35, 0.4, 0.5) })
  y -= 22

  for (const g of grids) {
    const ng = g.turnos.length + 1
    const cw = (W - M * 2 - LW) / (ng * g.metricas.length)
    const need = 20 + RH * 2 + RH * 2
    if (y - need < M + 14) { page = doc.addPage([W, H]); pages.push(page); y = H - M }
    page.drawText(latin(g.title), { x: M, y: y - 12, size: 11, font: bold, color: rgb(0.06, 0.15, 0.35) })
    y -= 20

    const header = () => {
      box(M, LW, g.first, { b: true, fill: blue, h: RH * 2 })
      ;[...g.turnos, g.totalLabel].forEach((t, i) => box(M + LW + i * cw * g.metricas.length, cw * g.metricas.length, t, { b: true, fill: blue, align: 'c' }))
      y -= RH
      ;[...g.turnos, ''].forEach((_, i) => g.metricas.forEach((x, j) => box(M + LW + (i * g.metricas.length + j) * cw, cw, x, { b: true, fill: blue, align: 'c' })))
      y -= RH
    }
    header()
    for (const row of g.rows) {
      if (y - RH < M + 14) {
        page = doc.addPage([W, H])
        pages.push(page)
        y = H - M
        header()
      }
      const strong = row.kind !== 'row'
      const fill = strong ? gray : undefined
      box(M, LW, row.label, { b: strong, fill })
      const vals = [...row.cells, row.total]
      vals.forEach((v, i) => {
        const isTot = i === vals.length - 1
        for (let j = 0; j < g.metricas.length; j++) box(M + LW + (i * g.metricas.length + j) * cw, cw, v ? String(v[j]) : '-', { b: strong || isTot, fill: strong || isTot ? gray : undefined, align: v ? 'r' : 'c' })
      })
      y -= RH
    }
    y -= 18
  }

  pages.forEach((p, i) => p.drawText(`Página ${i + 1} de ${pages.length}`, { x: W - M - 70, y: 14, size: 8, font, color: rgb(0.5, 0.55, 0.6) }))
  return doc.save()
}

// ---- Reportes jerárquicos: filas = escuelas, columnas = [ciclo >] grupo > subgrupo > Sec/Mat/Asist ----
/** `sup` es un nivel opcional de encabezado por encima del grupo (p. ej. el ciclo) */
export interface RepGrupo { label: string; subs: string[]; sup?: string }
export interface RepTabla {
  titulo: string
  /** Tablas con el mismo grupo se muestran juntas en pantalla */
  grupo?: string
  metricas?: string[]
  primera: string
  grupos: RepGrupo[]
  filas: { label: string; vals: number[] }[]
  /** Fila final de subtotales */
  total: number[]
}
const repAnchos = (t: RepTabla) => t.grupos.map((g) => Math.max(g.subs.length, 1) * (t.metricas?.length ?? 3))
/** Hay nivel de subgrupos (turnos o cursos) entre el grupo y Sec/Mat/Asist */
const repConSubs = (t: RepTabla) => t.grupos.some((g) => g.subs.length > 0)
/** Agrupa grupos consecutivos con el mismo `sup`: [etiqueta, columnas] */
const repSups = (t: RepTabla) => {
  const out: [string, number][] = []
  const n = t.metricas?.length ?? 3
  t.grupos.forEach((g, i) => {
    const w = Math.max(g.subs.length, 1) * n
    if (i && g.sup === t.grupos[i - 1].sup) out[out.length - 1][1] += w
    else out.push([g.sup ?? '', w])
  })
  return out
}

/** .xlsx con una hoja por reporte: encabezado jerárquico con celdas combinadas */
export function buildReporteXlsx(title: string, subtitle: string, tablas: RepTabla[], sheet: string): Uint8Array {
  const rows: string[] = []
  const merges: string[] = []
  let r = 0
  const str = (ci: number, v: string, st: number) => `<c r="${colL(ci)}${r}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`
  const num = (ci: number, v: number, st: number) => `<c r="${colL(ci)}${r}" s="${st}"><v>${v}</v></c>`
  const push = (cells: string[]) => rows.push(`<row r="${r}">${cells.join('')}</row>`)
  const fill = (c: number, w: number, label: string) => [str(c, label, 2), ...Array.from({ length: w - 1 }, (_, i) => str(c + 1 + i, '', 2))]
  r++; push([str(0, title, 7)])
  r++; push([str(0, subtitle, 0)])
  r++
  let ncols = 1
  for (const t of tablas) {
    ncols = Math.max(ncols, 1 + t.total.length)
    const conSup = t.grupos.some((g) => g.sup !== undefined)
    r++; push([str(0, t.titulo, 1)])
    const h0 = ++r
    let first = true
    const lead = () => { const v = first ? str(0, t.primera, 2) : str(0, '', 2); first = false; return v }
    if (conSup) {
      const cells = [lead()]
      let c = 1
      for (const [label, w] of repSups(t)) { cells.push(...fill(c, w, label)); merges.push(`${colL(c)}${r}:${colL(c + w - 1)}${r}`); c += w }
      push(cells); r++
    }
    const cells = [lead()]
    let c = 1
    for (const [g, w] of t.grupos.map((g, i) => [g, repAnchos(t)[i]] as const)) { cells.push(...fill(c, w, g.label)); merges.push(`${colL(c)}${r}:${colL(c + w - 1)}${r}`); c += w }
    push(cells); r++
    if (repConSubs(t)) {
      const subs = [lead()]
      c = 1
      const n = t.metricas?.length ?? 3
      for (const g of t.grupos) for (const sb of g.subs) { subs.push(...fill(c, n, sb)); merges.push(`${colL(c)}${r}:${colL(c + n - 1)}${r}`); c += n }
      push(subs); r++
    }
    const metricas = t.metricas ?? ['Sec', 'Mat', 'Asist']
    push([lead(), ...t.total.map((_, i) => str(1 + i, metricas[i % metricas.length], 2))])
    merges.push(`A${h0}:A${r}`)
    for (const f of t.filas) { r++; push([str(0, f.label, 3), ...f.vals.map((v, i) => num(1 + i, v, 4))]) }
    r++; push([str(0, 'Subtotales', 5), ...t.total.map((v, i) => num(1 + i, v, 6))])
    r++
  }
  const cols = Array.from({ length: ncols }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 22 : 7}" customWidth="1"/>`).join('')
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells></worksheet>`
  return pack(sheet, MATRIZ_STYLES, sheetXml)
}

/** PDF horizontal (A3 o más ancho si hay muchas columnas); el encabezado se repite en cada página */
export async function buildReportePdf(title: string, subtitle: string, tablas: RepTabla[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const maxCols = Math.max(...tablas.map((t) => t.total.length), 1)
  const M = 28, LW = 64, RH = 13, FS = 6.2, MIN_CW = 15
  const W = Math.max(1190.55, M * 2 + LW + maxCols * MIN_CW), H = 841.89
  const ink = rgb(0.1, 0.12, 0.18)
  const blue = rgb(0.86, 0.92, 0.98), gray = rgb(0.93, 0.94, 0.96)
  const pages: ReturnType<typeof doc.addPage>[] = []
  let page = doc.addPage([W, H])
  pages.push(page)
  let y = H - M

  const box = (x: number, w: number, text: string, o: { b?: boolean; fill?: ReturnType<typeof rgb>; align?: 'l' | 'c' | 'r'; h?: number } = {}) => {
    const h = o.h ?? RH
    page.drawRectangle({ x, y: y - h, width: w, height: h, color: o.fill, borderColor: rgb(0.72, 0.75, 0.8), borderWidth: 0.4 })
    const f = o.b ? bold : font
    const t = latin(text)
    const tw = f.widthOfTextAtSize(t, FS)
    const tx = o.align === 'r' ? x + w - 2.5 - tw : o.align === 'c' ? x + (w - tw) / 2 : x + 3
    page.drawText(t, { x: tx, y: y - h / 2 - FS / 2.6, size: FS, font: f, color: ink })
  }
  const nueva = () => { page = doc.addPage([W, H]); pages.push(page); y = H - M }

  page.drawText(latin(title), { x: M, y: y - 14, size: 15, font: bold, color: rgb(0.06, 0.15, 0.35) })
  y -= 30
  page.drawText(latin(subtitle), { x: M, y: y - 2, size: 9, font, color: rgb(0.35, 0.4, 0.5) })
  y -= 22

  for (const t of tablas) {
    const ncols = t.total.length
    const cw = (W - M * 2 - LW) / ncols
    const conSup = t.grupos.some((g) => g.sup !== undefined)
    const conSubs = repConSubs(t)
    const niveles = (conSup ? 1 : 0) + (conSubs ? 3 : 2)
    if (y - RH * (niveles + 2) < M + 14) nueva()
    page.drawText(latin(t.titulo), { x: M, y: y - 12, size: 11, font: bold, color: rgb(0.06, 0.15, 0.35) })
    y -= 20

    const header = () => {
      box(M, LW, t.primera, { b: true, fill: blue, h: RH * niveles })
      if (conSup) {
        let c = 0
        for (const [label, w] of repSups(t)) { box(M + LW + c * cw, w * cw, label, { b: true, fill: blue, align: 'c' }); c += w }
        y -= RH
      }
      let c = 0
      t.grupos.forEach((g, i) => {
        const w = repAnchos(t)[i]
        box(M + LW + c * cw, w * cw, wrap(g.label, bold, FS, w * cw - 6, 1)[0], { b: true, fill: blue, align: 'c' })
        c += w
      })
      y -= RH
      if (conSubs) {
        c = 0
        const n = t.metricas?.length ?? 3
        for (const g of t.grupos) for (const sb of g.subs) { box(M + LW + c * cw, cw * n, wrap(sb, bold, FS, cw * n - 4, 1)[0], { b: true, fill: blue, align: 'c' }); c += n }
        y -= RH
      }
      const metricas = t.metricas ?? ['Sec', 'Mat', 'Asist']
      for (let i = 0; i < ncols; i++) box(M + LW + i * cw, cw, metricas[i % metricas.length], { b: true, fill: blue, align: 'c' })
      y -= RH
    }
    header()
    const fila = (label: string, vals: number[], strong: boolean) => {
      if (y - RH < M + 14) { nueva(); header() }
      box(M, LW, label, { b: strong, fill: strong ? gray : undefined })
      vals.forEach((v, i) => box(M + LW + i * cw, cw, String(v), { b: strong, fill: strong ? gray : undefined, align: 'r' }))
      y -= RH
    }
    for (const f of t.filas) fila(f.label, f.vals, false)
    fila('Subtotales', t.total, true)
    y -= 18
  }

  pages.forEach((p, i) => p.drawText(`Página ${i + 1} de ${pages.length}`, { x: W - M - 70, y: 14, size: 8, font, color: rgb(0.5, 0.55, 0.6) }))
  return doc.save()
}
