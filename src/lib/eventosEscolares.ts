import { supabase } from './supabase'
import { leerPaginas, type RegistroCalendario } from './calendarioDistrital'
import type { Table } from './export'

export interface TipoEventoEscolar { id: number; nombre: string }
export interface EscuelaEvento {
  id: number; cue: string; clave: string | null; nombre: string | null
  tipo: string | null; numero: number | null; localidad: string | null
}
export interface SeguimientoEvento extends EscuelaEvento { nivel: string | null; modalidad: string | null; cargado: boolean }
export interface RealizacionEscolar {
  id: number; evento_id: number; evento: string; escuela_id: number; escuela_cue: string
  escuela_clave: string | null; escuela_nombre: string | null; escuela_tipo: string | null; escuela_numero: number | null
  articulada_id: number | null; articulada_cue: string | null; articulada_clave: string | null
  articulada_nombre: string | null; articulada_tipo: string | null; articulada_numero: number | null
  fecha: string; lugar: string; hora_inicio: string; hora_fin: string
  objetivos: string; observaciones: string; created_at: string; updated_at: string
}

export const escuelaEvento = (e: Pick<EscuelaEvento, 'clave' | 'nombre' | 'tipo' | 'numero'>) =>
  [e.clave, [e.tipo, e.numero, e.nombre].filter(Boolean).join(' ')].filter(Boolean).join(' · ')

export const escuelaRealizacion = (r: RealizacionEscolar) =>
  escuelaEvento({ clave: r.escuela_clave, nombre: r.escuela_nombre, tipo: r.escuela_tipo, numero: r.escuela_numero })
export const escuelaArticulada = (r: RealizacionEscolar) => r.articulada_id == null ? '' :
  escuelaEvento({ clave: r.articulada_clave, nombre: r.articulada_nombre, tipo: r.articulada_tipo, numero: r.articulada_numero })

export async function leerTiposEscolares(): Promise<TipoEventoEscolar[]> {
  return leerPaginas<TipoEventoEscolar>((a, b) => supabase.from('eventos_escolares_catalogo').select('id,nombre').order('id').range(a, b))
}

export async function leerEscuelasEventos(): Promise<EscuelaEvento[]> {
  return leerPaginas<EscuelaEvento>((a, b) => supabase.rpc('eventos_escolares_escuelas').select('*').order('id').range(a, b))
}

export async function leerRealizaciones(desde?: string, hasta?: string, id?: number, evento?: number): Promise<RealizacionEscolar[]> {
  return leerPaginas<RealizacionEscolar>((a, b) => supabase.rpc('eventos_escolares_listar', {
    p_desde: desde ?? null, p_hasta: hasta ?? null, p_id: id ?? null, p_evento: evento ?? null,
  }).select('*').order('id').range(a, b))
}

export async function leerSeguimiento(evento: number): Promise<SeguimientoEvento[]> {
  return leerPaginas<SeguimientoEvento>((a, b) => supabase.rpc('eventos_escolares_seguimiento', { p_evento: evento })
    .select('*').order('id').range(a, b))
}

export function registrosEventosEscolares(filas: RealizacionEscolar[]): RegistroCalendario[] {
  return filas.map((r) => {
    const escuela = escuelaRealizacion(r)
    const articulada = escuelaArticulada(r)
    const horario = `${r.hora_inicio.slice(0, 5)} a ${r.hora_fin.slice(0, 5)}`
    return {
      id: `evento-escolar-${r.id}`, fuente: 'evento-escolar', fecha: r.fecha, nombre: r.evento,
      lugar: r.lugar, descripcion: `${escuela} · ${horario}${articulada ? `\nArticulado con ${articulada}` : ''}`,
      enlace: `/eventos-escolares?realizacion=${r.id}`,
      detalles: [
        { etiqueta: 'Escuela que registró', valor: escuela }, { etiqueta: 'Horario', valor: horario },
        { etiqueta: 'Lugar', valor: r.lugar }, { etiqueta: 'Articulación', valor: articulada || 'No' },
        { etiqueta: 'Objetivos', valor: r.objetivos }, { etiqueta: 'Observaciones', valor: r.observaciones },
        { etiqueta: 'Fecha de carga', valor: r.created_at }, { etiqueta: 'Última actualización', valor: r.updated_at },
      ],
    }
  })
}

export function tablaSeguimiento(filas: SeguimientoEvento[], evento: string, organizacion: string): Table {
  return {
    title: 'Seguimiento de eventos escolares',
    subtitle: `${organizacion} · ${evento} · ${filas.length} escuelas`,
    headers: ['Clave', 'CUE', 'Escuela', 'Nivel', 'Modalidad', 'Localidad', 'Estado'],
    widths: [15, 15, 30, 18, 18, 16, 14],
    rows: filas.map((e) => [e.clave ?? '', e.cue, escuelaEvento({ ...e, clave: null }), e.nivel ?? '', e.modalidad ?? '', e.localidad ?? '', e.cargado ? 'Cargado' : 'Pendiente']),
  }
}
