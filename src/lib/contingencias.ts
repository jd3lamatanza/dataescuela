import type { SupabaseClient } from '@supabase/supabase-js'
import type { Table } from './export'
import type { RegistroCalendario } from './calendarioDistrital'

export const TIPOS = ['Falta de Agua', 'Falta de Electricidad', 'Falta de Gas', 'Inclemencia Climática', 'Riesgo Edilicio', 'Medida de Fuerza', 'Duelo', 'Otro'] as const
export const SUSPENSIONES = { sin: 'Sin Suspensión de Actividad', parcial: 'Con Suspensión Parcial', total: 'Con Suspensión Total' } as const
export type Suspension = keyof typeof SUSPENSIONES
export interface ContingenciaSupervision {
  id: number; cue: string; clave: string; escuela: string; fecha: string; fecha_estimada: boolean
  tipos: string[]; suspension: Suspension; observaciones: string; created_at: string; turnos: string[]
}
export interface FiltrosContingencias { busqueda: string; tipo: string; suspension: string; desde: string; hasta: string; id?: number }
export interface ResultadoContingencias { total: number; filas: ContingenciaSupervision[] }
export const fechaCorta = (s: string) => s.split('-').reverse().join('/')

export function registrosContingencias(filas: ContingenciaSupervision[]): RegistroCalendario[] {
  return filas.map((c) => ({
    id: `contingencia-${c.id}`, fuente: 'contingencia', fecha: c.fecha,
    nombre: `Contingencia: ${c.tipos.join(', ')}`,
    descripcion: [`${c.clave || c.cue} ${c.escuela}`.trim(), `Turnos: ${c.turnos.join(', ')}`,
      c.fecha_estimada ? 'Fecha de carga, pendiente de revisión' : '', c.observaciones].filter(Boolean).join('\n'),
    estado: SUSPENSIONES[c.suspension], enlace: `/contingencias?contingencia=${c.id}`,
    detalles: [
      { etiqueta: 'Escuela', valor: c.escuela }, { etiqueta: 'Clave provincial', valor: c.clave },
      { etiqueta: 'CUE', valor: c.cue }, { etiqueta: 'Tipos', valor: c.tipos.join(', ') },
      { etiqueta: 'Suspensión', valor: SUSPENSIONES[c.suspension] }, { etiqueta: 'Turnos', valor: c.turnos.join(', ') },
      { etiqueta: 'Fecha estimada', valor: c.fecha_estimada ? 'Sí, fecha de carga pendiente de revisión' : 'No' },
      { etiqueta: 'Observaciones', valor: c.observaciones }, { etiqueta: 'Fecha de carga', valor: c.created_at },
    ],
  }))
}

export async function consultarContingencias(cliente: SupabaseClient, filtros: FiltrosContingencias, limite: number, offset: number): Promise<ResultadoContingencias> {
  const { data, error } = await cliente.rpc('contingencias_supervision', {
    p_busqueda: filtros.busqueda.trim().slice(0, 100), p_tipo: filtros.tipo, p_suspension: filtros.suspension,
    p_desde: filtros.desde || null, p_hasta: filtros.hasta || null, p_id: filtros.id ?? null,
    p_lim: limite, p_offset: offset,
  })
  if (error) throw new Error(error.message)
  if (!data || !Array.isArray(data.filas) || typeof data.total !== 'number') throw new Error('El servidor no devolvió el listado de contingencias.')
  return data as ResultadoContingencias
}

export async function leerContingencias(cliente: SupabaseClient, filtros: FiltrosContingencias): Promise<ContingenciaSupervision[]> {
  const filas: ContingenciaSupervision[] = []
  for (let offset = 0; ; offset += 500) {
    const pagina = await consultarContingencias(cliente, filtros, 500, offset)
    filas.push(...pagina.filas)
    if (pagina.filas.length < 500) return filas
  }
}

export function tablaContingencias(filas: ContingenciaSupervision[], filtros: FiltrosContingencias, organizacion: string): Table {
  const resumen = [
    filtros.busqueda && `Búsqueda: ${filtros.busqueda}`, filtros.tipo && `Tipo: ${filtros.tipo}`,
    filtros.suspension && `Suspensión: ${SUSPENSIONES[filtros.suspension as Suspension]}`,
    filtros.desde && `Desde: ${fechaCorta(filtros.desde)}`, filtros.hasta && `Hasta: ${fechaCorta(filtros.hasta)}`,
    `${filas.length} contingencia(s)`,
  ].filter(Boolean).join(' · ')
  return {
    title: 'Contingencias escolares', subtitle: `${organizacion} · ${resumen}`,
    headers: ['Fecha', 'Escuela', 'Clave', 'CUE', 'Tipos', 'Suspensión', 'Turnos', 'Observaciones'],
    widths: [12, 24, 12, 14, 25, 23, 16, 30],
    rows: filas.map((c) => [
      `${fechaCorta(c.fecha)}${c.fecha_estimada ? ' (fecha de carga)' : ''}`, c.escuela, c.clave, c.cue,
      c.tipos.join(', '), SUSPENSIONES[c.suspension], c.turnos.join(', '), c.observaciones,
    ]),
  }
}
