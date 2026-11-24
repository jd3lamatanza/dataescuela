import type { SupabaseClient } from '@supabase/supabase-js'
import type { Table } from './export'

export interface SalidaListado {
  id: number; user_id: string; cue: string; clave: string | null; escuela: string; titulo: string; fecha: string; destino: string
  observaciones: string | null; estado_id: number; enviar_mail: boolean; mail_enviado_at: string | null; created_at: string
  visado_at: string | null
}

export interface FiltrosSalidas { busqueda: string; estado: string }

export const limpiarBusquedaSalidas = (texto: string) => texto.trim().slice(0, 80).replace(/[,()%*\\"]/g, ' ').trim()

export function consultaSalidas(cliente: SupabaseClient, filtros: FiltrosSalidas) {
  let consulta = cliente.from('salidas').select('id,user_id,cue,clave,escuela,titulo,fecha,destino,observaciones,estado_id,enviar_mail,mail_enviado_at,created_at,visado_at', { count: 'exact' })
  if (filtros.estado) consulta = consulta.eq('estado_id', Number(filtros.estado))
  const texto = limpiarBusquedaSalidas(filtros.busqueda)
  if (texto) consulta = consulta.or(['titulo', 'destino', 'escuela', 'clave', 'cue'].map((campo) => `${campo}.ilike.%${texto}%`).join(','))
  return consulta.order('fecha', { ascending: false }).order('id', { ascending: false })
}

export async function leerSalidasFiltradas(cliente: SupabaseClient, filtros: FiltrosSalidas): Promise<SalidaListado[]> {
  const salidas: SalidaListado[] = []
  for (let offset = 0; ; offset += 500) {
    const r = await consultaSalidas(cliente, filtros).range(offset, offset + 499)
    if (r.error) throw r.error
    salidas.push(...r.data as SalidaListado[])
    if (r.data.length < 500) return salidas
  }
}

export function tablaSalidas(salidas: SalidaListado[], estados: { id: number; nombre: string }[], filtros: FiltrosSalidas, organizacion: string): Table {
  const estado = estados.find((e) => String(e.id) === filtros.estado)?.nombre
  const detalles = [estado && `Estado: ${estado}`, filtros.busqueda && `Búsqueda: ${filtros.busqueda}`, `${salidas.length} salida(s)`].filter(Boolean).join(' · ')
  return {
    title: 'Salidas educativas',
    subtitle: `${organizacion} · ${detalles}`,
    headers: ['Fecha', 'Título', 'Destino', 'Escuela', 'Clave', 'CUE', 'Estado'],
    widths: [13, 30, 25, 28, 17, 15, 20],
    rows: salidas.map((s) => [
      s.fecha.split('-').reverse().join('/'), s.titulo, s.destino, s.escuela, s.clave ?? '', s.cue,
      estados.find((e) => e.id === s.estado_id)?.nombre ?? 'Sin estado',
    ]),
  }
}
