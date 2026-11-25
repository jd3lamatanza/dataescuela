import type { SupabaseClient } from '@supabase/supabase-js'
import type { TipoEquipo } from '../ui/Equipo'
import type { Table } from './export'

export interface EquipoListado {
  id: number
  escuela_id: number
  apellido_nombre: string
  escuela: { clave: string | null; cue: string; codigo: string | null; numero: number | null; nivel: string | null; localidad: string | null }
  cargo: { nombre: string } | string | null
  revista?: { nombre: string } | null
  cuil?: string | null
  dni?: string | null
  telefono?: string | null
  email?: string | null
  toma_posesion?: string | null
  cargo_base?: string | null
  area?: string | null
  turno?: string | null
  otra_escuela?: boolean
  otra_escuela_detalle?: string | null
  tiene_pin?: boolean
}

export interface FiltrosEquipos { busqueda: string; nivel: string; localidad: string }

const TABLAS: Record<TipoEquipo, string> = { directivo: 'equipo_directivo', orientacion: 'equipo_orientacion', esi: 'referentes_esi' }
const ESCUELA = 'escuela:escuelas!inner(clave,cue,codigo,numero,nivel,localidad)'

export async function leerEquipos(cliente: SupabaseClient, tipo: TipoEquipo): Promise<EquipoListado[]> {
  const campos = tipo === 'esi'
    ? `id,escuela_id,apellido_nombre,dni,cargo,area,turno,otra_escuela,otra_escuela_detalle,${ESCUELA}`
    : `id,escuela_id,apellido_nombre,cuil,telefono,email,toma_posesion,${tipo === 'directivo' ? 'cargo_base,' : ''}cargo:catalogos!cargo_id(nombre),revista:catalogos!revista_id(nombre),${ESCUELA}`
  const filas: EquipoListado[] = []
  for (let offset = 0; ; offset += 500) {
    const r = await cliente.from(TABLAS[tipo]).select(campos).order('apellido_nombre').order('id').range(offset, offset + 499)
      .overrideTypes<EquipoListado[], { merge: false }>()
    if (r.error) throw r.error
    filas.push(...r.data)
    if (r.data.length < 500) return filas
  }
}

export const escuelaEquipo = (e: EquipoListado['escuela']) =>
  [e.codigo, e.numero].filter((v) => v != null && v !== '').join(' ') || e.clave || e.cue
export const cargoEquipo = (r: EquipoListado) => typeof r.cargo === 'string' ? r.cargo : r.cargo?.nombre ?? ''
export const otraEscuelaEquipo = (r: EquipoListado) => r.otra_escuela ? `Sí${r.otra_escuela_detalle ? ` · ${r.otra_escuela_detalle}` : ''}` : 'No'
export const fechaEquipo = (v: string | null | undefined) => v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v ?? ''

export function filtrarEquipos(filas: EquipoListado[], filtros: FiltrosEquipos): EquipoListado[] {
  const q = filtros.busqueda.trim().toLocaleLowerCase('es-AR')
  return filas.filter((r) =>
    (!filtros.nivel || r.escuela.nivel === filtros.nivel)
    && (!filtros.localidad || r.escuela.localidad === filtros.localidad)
    && (!q || [r.apellido_nombre, r.cuil, r.dni, cargoEquipo(r), r.escuela.clave, r.escuela.cue,
      escuelaEquipo(r.escuela), r.escuela.nivel, r.escuela.localidad].some((v) => String(v ?? '').toLocaleLowerCase('es-AR').includes(q))))
}

export function tablaEquipos(filas: EquipoListado[], tipo: TipoEquipo, filtros: FiltrosEquipos, organizacion: string): Table {
  const esi = tipo === 'esi'
  const nombres: Record<TipoEquipo, string> = { directivo: 'Equipos directivos', orientacion: 'Equipos de orientación', esi: 'Referentes ESI' }
  const detalles = [filtros.nivel && `Nivel: ${filtros.nivel}`, filtros.localidad && `Localidad: ${filtros.localidad}`,
    filtros.busqueda.trim() && `Búsqueda: ${filtros.busqueda.trim()}`, `${filas.length} registro(s)`].filter(Boolean).join(' · ')
  return {
    title: nombres[tipo],
    subtitle: `${organizacion} · ${detalles}`,
    headers: esi
      ? ['Escuela', 'Clave', 'CUE', 'Apellido y nombre', 'DNI', 'Cargo', 'Área', 'Turno', 'Otra escuela']
      : ['Escuela', 'Clave', 'CUE', 'Apellido y nombre', 'CUIL', 'Cargo', 'Revista', 'Toma', 'Contacto', ...(tipo === 'directivo' ? ['Cargo base'] : [])],
    widths: esi ? [13, 14, 14, 25, 12, 16, 16, 12, 18] : [13, 14, 14, 25, 15, 16, 16, 12, 27, ...(tipo === 'directivo' ? [16] : [])],
    rows: filas.map((r) => [
      escuelaEquipo(r.escuela), r.escuela.clave ?? '', r.escuela.cue, r.apellido_nombre,
      ...(esi
        ? [r.dni ?? '', cargoEquipo(r), r.area ?? '', r.turno ?? '', otraEscuelaEquipo(r)]
        : [r.cuil ?? '', cargoEquipo(r), r.revista?.nombre ?? '', fechaEquipo(r.toma_posesion),
          [r.telefono, r.email].filter(Boolean).join(' · '), ...(tipo === 'directivo' ? [r.cargo_base ?? ''] : [])]),
    ]),
  }
}
