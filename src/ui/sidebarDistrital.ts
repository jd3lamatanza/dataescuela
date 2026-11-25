import type { AppModule, IconName } from '../modules'

export const ordenarMenu = <T extends { label: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }))

export const ordenarModulosSidebar = (modulos: readonly AppModule[]): AppModule[] => {
  const destacados = ['inicio', 'mensajes'].flatMap((id) => modulos.filter((modulo) => modulo.id === id))
  return [...destacados, ...ordenarMenu(modulos.filter((modulo) => modulo.id !== 'inicio' && modulo.id !== 'mensajes'))]
}

export type CategoriaDistrital = 'escuelas' | 'inspectores' | 'estadistica' | 'utilidades' | 'sistema'

export const CATEGORIAS_DISTRITALES: readonly { id: CategoriaDistrital; label: string; icon: IconName }[] = [
  { id: 'escuelas', label: 'Escuelas', icon: 'building' },
  { id: 'inspectores', label: 'Inspectores', icon: 'shield' },
  { id: 'estadistica', label: 'Estadística', icon: 'chart' },
  { id: 'utilidades', label: 'Utilidades', icon: 'clipboard' },
  { id: 'sistema', label: 'Sistema', icon: 'settings' },
]

const CATEGORIA_POR_MODULO: Record<string, CategoriaDistrital> = {
  distrito: 'escuelas',
  escuelas: 'escuelas',
  nudos: 'escuelas',
  'circuitos-electorales': 'escuelas',
  plantas: 'escuelas',
  matriculas: 'escuelas',
  'salidas-distrito': 'escuelas',
  contingencias: 'escuelas',
  'eventos-escolares': 'escuelas',
  'proyectos-escolares': 'escuelas',
  eav: 'escuelas',
  'pin-validacion': 'escuelas',
  inspectores: 'inspectores',
  'proyectos-areales': 'inspectores',
  disposiciones: 'inspectores',
  'agenda-distrito': 'inspectores',
  'labores-distrito': 'inspectores',
  estadistica: 'estadistica',
  acreditacion: 'utilidades',
  'mapa-escolar': 'utilidades',
  simulado: 'sistema',
  'usuarios-distrito': 'sistema',
  configuracion: 'sistema',
  'ayuda-distrital': 'sistema',
  'reportes-error': 'sistema',
}

export function agruparMenuDistrital(modulos: readonly AppModule[]) {
  return ordenarMenu(CATEGORIAS_DISTRITALES.map((categoria) => ({
    ...categoria,
    modulos: ordenarMenu(modulos.filter((modulo) => modulo.id !== 'inicio' && modulo.id !== 'mensajes' && (CATEGORIA_POR_MODULO[modulo.id] ?? 'sistema') === categoria.id)),
  })).filter((categoria) => categoria.modulos.length > 0))
}
