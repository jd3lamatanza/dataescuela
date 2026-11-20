import type { Table } from './export'

export interface Nudo { id: number; nombre: string; activo: boolean }
export interface EscuelaNudo { id: number; nudo_id: number | null; clave: string | null; tipo: string | null; numero: number | null; nombre: string | null; localidad: string | null }
export type OrdenNudo = 'clave' | 'nombre' | 'localidad'
export interface FiltrosNudos { busqueda: string; nudo: string; localidad: string; orden: OrdenNudo; descendente: boolean }
export interface GrupoNudo { id: number | null; nombre: string; activo: boolean; escuelas: EscuelaNudo[] }

const normalizar = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR').trim()
export const esSinNudo = (nudo: Pick<Nudo, 'nombre'>, tipo: 'nudo' | 'circuito' = 'nudo') => normalizar(nudo.nombre) === `sin ${tipo}`
export const etiquetaEscuela = (e: EscuelaNudo) => e.clave || [e.tipo, e.numero].filter(Boolean).join(' ') || `Escuela ${e.id}`

export function contarSinNudo(nudos: Nudo[], escuelas: EscuelaNudo[], tipo: 'nudo' | 'circuito' = 'nudo') {
  const ids = new Set(nudos.filter((n) => esSinNudo(n, tipo)).map((n) => n.id))
  return escuelas.filter((e) => e.nudo_id == null || ids.has(e.nudo_id)).length
}

export function filtrarNudos(nudos: Nudo[], escuelas: EscuelaNudo[], filtros: FiltrosNudos, tipo: 'nudo' | 'circuito' = 'nudo'): GrupoNudo[] {
  const termino = normalizar(filtros.busqueda)
  const factor = filtros.descendente ? -1 : 1
  const grupos: GrupoNudo[] = nudos.map((n) => ({ ...n, escuelas: [] }))
  const sinReferencia = escuelas.some((e) => e.nudo_id === null)
  if (sinReferencia) grupos.push({ id: null, nombre: `Sin ${tipo} asignado`, activo: true, escuelas: [] })
  const porId = new Map(grupos.map((g) => [g.id, g]))
  for (const escuela of escuelas) {
    const grupo = porId.get(escuela.nudo_id)
    if (!grupo) continue
    const sinNudo = grupo.id === null || esSinNudo(grupo, tipo)
    if (filtros.nudo && (filtros.nudo === 'sin-asignar' ? !sinNudo : String(grupo.id) !== filtros.nudo)) continue
    if (filtros.localidad && escuela.localidad !== filtros.localidad) continue
    if (termino && ![grupo.nombre, escuela.clave, escuela.tipo, escuela.numero, escuela.nombre, escuela.localidad].some((x) => normalizar(String(x ?? '')).includes(termino))) continue
    grupo.escuelas.push(escuela)
  }
  const comparar = (a: string, b: string) => a.localeCompare(b, 'es-AR', { numeric: true, sensitivity: 'base' })
  for (const grupo of grupos) {
    grupo.escuelas.sort((a, b) => {
      const valor = (e: EscuelaNudo) => filtros.orden === 'nombre' ? e.nombre ?? '' : filtros.orden === 'localidad' ? e.localidad ?? '' : etiquetaEscuela(e)
      return factor * comparar(valor(a), valor(b)) || comparar(etiquetaEscuela(a), etiquetaEscuela(b)) || a.id - b.id
    })
  }
  return grupos.filter((grupo) => {
    if (grupo.escuelas.length) return true
    if (filtros.localidad || (filtros.nudo && (filtros.nudo === 'sin-asignar' ? !(grupo.id === null || esSinNudo(grupo, tipo)) : String(grupo.id) !== filtros.nudo))) return false
    return !termino || normalizar(grupo.nombre).includes(termino)
  }).sort((a, b) => factor * comparar(a.nombre, b.nombre) || (a.id ?? 0) - (b.id ?? 0))
}

export function tablaNudos(grupos: GrupoNudo[], filtros: FiltrosNudos, organizacion: string, tipo: 'nudo' | 'circuito' = 'nudo'): Table {
  const total = grupos.reduce((n, g) => n + g.escuelas.length, 0)
  const etiqueta = tipo === 'nudo' ? 'Nudo' : 'Circuito'
  const subtitle = [
    organizacion, filtros.nudo && `${etiqueta}: ${filtros.nudo === 'sin-asignar' ? 'Sin asignar' : grupos[0]?.nombre ?? 'Seleccionado'}`,
    filtros.busqueda && `Búsqueda: ${filtros.busqueda.trim()}`, filtros.localidad && `Localidad: ${filtros.localidad}`,
    `Orden: ${filtros.orden} ${filtros.descendente ? 'descendente' : 'ascendente'}`, `${total} escuela(s)`,
  ].filter(Boolean).join(' · ')
  return {
    title: `Escuelas por ${tipo}`, subtitle,
    headers: [etiqueta, 'Clave', 'Escuela', 'Localidad'], widths: [23, 16, 35, 18],
    rows: grupos.flatMap((g) => g.escuelas.length ? g.escuelas.map((e) => [g.nombre, etiquetaEscuela(e), e.nombre ?? '', e.localidad ?? '']) : [[g.nombre, '', 'Sin escuelas asociadas', '']]),
  }
}
