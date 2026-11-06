import { supabase } from '../lib/supabase'

export interface Escuela { clave: string | null; cue: string; codigo: string | null; numero: number | null; nombre: string | null; localidad: string | null }
export interface Inspector { id: number; nombre: string | null; cuil: string; escuelas_asignadas: string[] }
export interface Grupo { id: number; nombre: string }
export interface CodigoGrupo { agrupamiento_id: number; codigo: string }
export const nombre = (e: Escuela) => [e.codigo, e.numero].filter(Boolean).join(' ') || e.nombre || e.cue
export const mensaje = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)

export async function cargar<T extends { clave: string; fecha: string }>(distrito: boolean, tabla: string, campos: string, desempate?: string) {
  const escuelas: Escuela[] = []
  const registros: T[] = []
  const inspectores: Inspector[] = []
  const grupos: Grupo[] = []
  const codigosGrupo: CodigoGrupo[] = []
  const size = 1000
  for (let desde = 0; ; desde += size) {
    const r = await supabase.from('agrupamientos_matricula').select('id,nombre').order('nombre').order('id').range(desde, desde + size - 1)
    if (r.error) throw r.error
    grupos.push(...(r.data as Grupo[]))
    if (r.data.length < size) break
  }
  for (let desde = 0; ; desde += size) {
    const r = await supabase.from('agrupamiento_codigos').select('agrupamiento_id,codigo').order('agrupamiento_id').order('codigo').range(desde, desde + size - 1)
    if (r.error) throw r.error
    codigosGrupo.push(...(r.data as CodigoGrupo[]))
    if (r.data.length < size) break
  }
  if (distrito) {
    for (let desde = 0; ; desde += size) {
      const r = await supabase.from('inspectores').select('id,nombre,cuil,escuelas_asignadas').order('nombre').order('id').range(desde, desde + size - 1)
      if (r.error) throw r.error
      inspectores.push(...(r.data as Inspector[]))
      if (r.data.length < size) break
    }
  }
  for (let desde = 0; ; desde += size) {
    const r = await supabase.from('escuelas').select('clave,cue,codigo,numero,nombre,localidad').order('id').range(desde, desde + size - 1)
    if (r.error) throw r.error
    escuelas.push(...(r.data as Escuela[]))
    if (r.data.length < size) break
  }
  for (let desde = 0; ; desde += size) {
    const consulta = supabase.from(tabla).select(campos).order('clave')
    const r = await (desempate ? consulta.order(desempate) : consulta).range(desde, desde + size - 1)
    if (r.error) throw r.error
    registros.push(...(r.data as unknown as T[]))
    if (r.data.length < size) break
  }
  const porClave = new Map<string, Escuela>()
  const codigosPorClave = new Map<string, Set<string>>()
  for (const e of escuelas) {
    if (!e.clave) continue
    if (!porClave.has(e.clave)) porClave.set(e.clave, e)
    if (e.codigo) {
      if (!codigosPorClave.has(e.clave)) codigosPorClave.set(e.clave, new Set())
      codigosPorClave.get(e.clave)!.add(e.codigo)
    }
  }
  const filas: (T & { escuela: Escuela })[] = []
  for (const r of registros) {
    const escuela = porClave.get(r.clave)
    if (escuela) filas.push({ ...r, escuela })
  }
  return { claves: porClave, filas, inspectores, grupos, codigosGrupo, codigosPorClave }
}
