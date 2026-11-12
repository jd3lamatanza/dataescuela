import type { AppModule, IconName } from '../modules'

export type CategoriaDistrital = 'escuelas' | 'inspectores' | 'estadistica' | 'sistema'

export const CATEGORIAS_DISTRITALES: readonly { id: CategoriaDistrital; label: string; icon: IconName }[] = [
  { id: 'escuelas', label: 'Escuelas', icon: 'building' },
  { id: 'inspectores', label: 'Inspectores', icon: 'shield' },
  { id: 'estadistica', label: 'Estadística', icon: 'chart' },
  { id: 'sistema', label: 'Sistema', icon: 'settings' },
]

const CATEGORIA_POR_MODULO: Record<string, CategoriaDistrital> = {
  distrito: 'escuelas',
  escuelas: 'escuelas',
  plantas: 'escuelas',
  matriculas: 'escuelas',
  'salidas-distrito': 'escuelas',
  eav: 'escuelas',
  inspectores: 'inspectores',
  'agenda-distrito': 'inspectores',
  'labores-distrito': 'inspectores',
  estadistica: 'estadistica',
  simulado: 'sistema',
  'usuarios-distrito': 'sistema',
  configuracion: 'sistema',
  mensajes: 'sistema',
}

export function agruparMenuDistrital(modulos: readonly AppModule[]) {
  return CATEGORIAS_DISTRITALES.map((categoria) => ({
    ...categoria,
    modulos: modulos.filter((modulo) => modulo.id !== 'inicio' && (CATEGORIA_POR_MODULO[modulo.id] ?? 'sistema') === categoria.id),
  })).filter((categoria) => categoria.modulos.length > 0)
}
