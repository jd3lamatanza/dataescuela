import type * as XLSXT from 'xlsx'

export interface NominaRow { dni: string; nombre: string; curso: string }
export interface Nomina {
  clave: string | null
  cue: string | null
  ciclo: number | null
  rows: NominaRow[]
  bajas: number
}

const MAX_BYTES = 2 * 1024 * 1024

// Lee el reporte nominal de estudiantes (una sola hoja, bloques por sección). Lanza Error con un mensaje apto para el usuario.
export async function parseNomina(buf: ArrayBuffer): Promise<Nomina> {
  const XLSX = await import("xlsx")
  if (buf.byteLength > MAX_BYTES) throw new Error('El archivo supera los 2 MB')
  let wb: XLSXT.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false })
  } catch {
    throw new Error('No se pudo leer el archivo. Debe ser el reporte nominal de estudiantes en formato .xls')
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws?.['!ref']) throw new Error('El archivo no tiene datos')
  const last = XLSX.utils.decode_range(ws['!ref']).e.r + 1
  if (last > 3000) throw new Error('El archivo es demasiado grande')
  const val = (col: string, row: number) => String(ws[col + row]?.v ?? '').replace(/\s+/g, ' ').trim()

  const head = val('B', 3)
  const clave = /Clave provincial:\s*([0-9A-Za-z]+)/i.exec(head)?.[1]?.toUpperCase() ?? null
  const cue = /CUE:\s*(\d+)/i.exec(head)?.[1] ?? null
  const year = /(20\d\d)/.exec(val('E', 6) + ' ' + wb.SheetNames[0])?.[1]

  const rows: NominaRow[] = []
  let bajas = 0
  let curso = ''
  let secciones = 0
  for (let r = 1; r <= last; r++) {
    const d = val('D', r)
    if (!d) continue
    if (/tipo de secci/i.test(d)) {
      const seccion = d[0].toUpperCase()
      if (!curso) throw new Error(`Falta el curso sobre la sección de la fila ${r} (celda combinada D:N)`)
      if (!/nombre/i.test(val('H', r + 2)) || !/documento/i.test(val('I', r + 2))) throw new Error(`Formato inesperado: no se encontró la nómina de la sección ${seccion} (fila ${r + 2})`)
      secciones++
      for (let i = r + 3; val('H', i); i++) {
        if (/baja/i.test(val('G', i))) { bajas++; continue }
        rows.push({ dni: val('I', i).replace(/\D/g, ''), nombre: val('H', i).slice(0, 120), curso: curso + seccion })
      }
    } else if (!/turno/i.test(d) && d.length <= 10) {
      curso = d
    }
  }
  if (!secciones) throw new Error('Formato inesperado: no se encontraron secciones en el archivo')
  return { clave, cue, ciclo: year ? Number(year) : null, rows, bajas }
}
