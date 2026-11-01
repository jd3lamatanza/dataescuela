import { buildGrids, buildMatrizPdf, buildMatrizXlsx, buildPdf, buildReportePdf, buildReporteXlsx, buildXlsx, type RepTabla, type Table } from './export'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function descargar(data: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const descargarXlsx = (t: Table, name: string, sheet = 'Datos') => descargar(buildXlsx(t, sheet), `${name}.xlsx`, XLSX_MIME)
export const descargarPdf = async (t: Table, name: string) => descargar(await buildPdf(t), `${name}.pdf`, 'application/pdf')
export async function descargarTabla(tipo: 'xlsx' | 'pdf', tabla: Table, name: string, sheet = 'Consolidación') {
  if (tipo === 'xlsx') descargar(buildXlsx(tabla, sheet, [1, 2, 3, 4]), `${name}.xlsx`, XLSX_MIME)
  else descargar(await buildPdf(tabla), `${name}.pdf`, 'application/pdf')
}

export type FilaMatriz = Parameters<typeof buildGrids>[0][number]
export async function descargarMatriz(tipo: 'xlsx' | 'pdf', title: string, subtitle: string, filas: FilaMatriz[], name: string, especial = false) {
  const g = buildGrids(filas, especial)
  if (tipo === 'xlsx') descargar(buildMatrizXlsx(title, subtitle, g, title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ')), `${name}.xlsx`, XLSX_MIME)
  else descargar(await buildMatrizPdf(title, subtitle, g), `${name}.pdf`, 'application/pdf')
}

export async function descargarReporte(tipo: 'xlsx' | 'pdf', title: string, subtitle: string, tablas: RepTabla[], name: string) {
  if (tipo === 'xlsx') descargar(buildReporteXlsx(title, subtitle, tablas, title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ')), `${name}.xlsx`, XLSX_MIME)
  else descargar(await buildReportePdf(title, subtitle, tablas), `${name}.pdf`, 'application/pdf')
}
