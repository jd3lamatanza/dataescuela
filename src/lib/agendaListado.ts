import type { Table } from './export'

export interface ItemAgenda {
  id: number; fecha: string; hora: string | null; nombre: string; descripcion: string | null; lugar: string | null
  user_id: string; autor: string; agenda_historica: boolean
}

export function tablaAgenda(rows: ItemAgenda[], mes: string, filtro: string, distrito: boolean): Table {
  return {
    title: 'Agenda Anticipada',
    subtitle: `${mes.replace(/^./, (c) => c.toUpperCase())}${filtro ? ` · ${distrito ? 'Inspector' : 'Lugar'}: ${filtro}` : ''} · ${rows.length} evento(s)`,
    headers: distrito ? ['Fecha', 'Hora', 'Título', 'Lugar', 'Inspector', 'Descripción'] : ['Fecha', 'Hora', 'Título', 'Lugar', 'Descripción'],
    widths: distrito ? [12, 8, 28, 22, 24, 40] : [12, 8, 30, 24, 44],
    rows: rows.map((i) => {
      const f = i.fecha.split('-').reverse().join('/')
      const hora = i.hora?.slice(0, 5) ?? ''
      return distrito ? [f, hora, i.nombre, i.lugar ?? '', i.autor, i.descripcion ?? ''] : [f, hora, i.nombre, i.lugar ?? '', i.descripcion ?? '']
    }),
  }
}
