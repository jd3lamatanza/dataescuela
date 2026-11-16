export const LOCALIDADES_MAPA = ['González Catán', '20 de Junio', 'Virrey del Pino'] as const

export function rectangulosSolapados(a: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, b: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export interface EscuelaMapa {
  id: number
  clave: string | null
  nombre: string | null
  tipo: string | null
  numero: number | null
  nivel: string | null
  modalidad: string | null
  localidad: string | null
  calle: string | null
  nu_calle: number | null
  te: string | null
  latitud: number | null
  longitud: number | null
}

export function coordenadasValidas(escuela: EscuelaMapa): escuela is EscuelaMapa & { latitud: number; longitud: number } {
  return typeof escuela.latitud === 'number' && Number.isFinite(escuela.latitud) && escuela.latitud >= -90 && escuela.latitud <= 90
    && typeof escuela.longitud === 'number' && Number.isFinite(escuela.longitud) && escuela.longitud >= -180 && escuela.longitud <= 180
}

export function filtrarMapa(escuelas: EscuelaMapa[], localidades: readonly string[], nivel: string, modalidad: string, busqueda: string) {
  const termino = busqueda.trim().toLocaleLowerCase('es-AR')
  return escuelas.filter((e) => e.localidad != null && localidades.includes(e.localidad)
    && (!nivel || e.nivel === nivel) && (!modalidad || e.modalidad === modalidad)
    && (!termino || [e.clave, e.nombre, e.tipo, e.numero, e.calle].some((x) => String(x ?? '').toLocaleLowerCase('es-AR').includes(termino))))
}

export function colorNivel(nivel: string | null) {
  const n = (nivel ?? '').toLocaleLowerCase('es-AR')
  if (n.includes('inicial')) return '#16a34a'
  if (n.includes('primario')) return '#ea580c'
  if (n.includes('secundario') || n.includes('ciclo medio')) return '#9333ea'
  if (n.includes('superior')) return '#dc2626'
  if (n.includes('especial')) return '#0891b2'
  return '#2563eb'
}
