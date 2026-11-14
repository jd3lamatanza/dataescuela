import type { Table } from './export'

export interface EscuelaListado {
  id: number
  clave: string | null
  cue: string
  codigo: string | null
  numero: number | null
  nivel: string | null
  modalidad: string | null
  localidad: string | null
  calle: string | null
  nu_calle: number | null
  te: string | null
}

export const direccionEscuela = (e: Pick<EscuelaListado, 'calle' | 'nu_calle'>) =>
  [e.calle?.trim(), e.nu_calle == null ? '' : String(e.nu_calle)].filter(Boolean).join(' ')

export function tablaEscuelas(rows: EscuelaListado[], filtros: { localidad: string; nivel: string; busqueda: string }, organizacion: string): Table {
  const detalles = [
    filtros.localidad && `Localidad: ${filtros.localidad}`,
    filtros.nivel && `Nivel: ${filtros.nivel}`,
    filtros.busqueda && `Búsqueda: ${filtros.busqueda}`,
    `${rows.length} escuela(s)`,
  ].filter(Boolean).join(' · ')
  return {
    title: 'Listado de escuelas',
    subtitle: `${organizacion} · ${detalles}`,
    headers: ['Clave', 'CUE', 'Código', 'Número', 'Nivel', 'Modalidad', 'Localidad', 'Dirección', 'Teléfono'],
    widths: [15, 15, 10, 8, 15, 17, 15, 28, 17],
    rows: rows.map((e) => [e.clave, e.cue, e.codigo, e.numero, e.nivel, e.modalidad, e.localidad, direccionEscuela(e), e.te].map((v) => v == null ? '' : String(v))),
  }
}

export async function buildEscuelasXlsx(tabla: Table, marca: string): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const hoja = XLSX.utils.aoa_to_sheet([[marca], [tabla.title], [tabla.subtitle], [], tabla.headers, ...tabla.rows])
  hoja['!cols'] = tabla.widths.map((w) => ({ wch: Math.max(10, w) }))
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Escuelas')
  return new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }))
}
