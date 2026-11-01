import { buildPdf, buildXlsx, type Table } from './export'

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
