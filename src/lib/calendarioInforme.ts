import type { Evento } from '../ui/Calendario'
import type { RegistroCalendario } from './calendarioDistrital'

export interface CampoInforme { etiqueta: string; valor: string }
export interface EntradaInforme {
  id: string
  fecha: string
  titulo: string
  tipo: string
  enlace?: string
  resumen: CampoInforme[]
  detalles: CampoInforme[]
  registro?: RegistroCalendario
}

export function protegerCuil(valor: string): string {
  return valor.replace(/(?<!\d)(?:20|23|24|27|30|33|34)[ \t.\-–—]*(?:\d{8}|\d{2}\.\d{3}\.\d{3})[ \t.\-–—]*\d(?!\d)/g, '[CUIL omitido]')
}

export function campo(etiqueta: string, valor: string | number | boolean | null | undefined): CampoInforme[] {
  if (valor === null || valor === undefined || valor === '') return []
  return [{ etiqueta, valor: protegerCuil(typeof valor === 'boolean' ? (valor ? 'Sí' : 'No') : String(valor)) }]
}

export function informeEvento(e: Evento, tipo: string): EntradaInforme {
  const resumen = [
    ...campo('Hora', e.hora?.slice(0, 5)), ...campo('Lugar', e.lugar),
    ...campo('Autor', e.autor), ...campo('Descripción', e.descripcion),
  ]
  return {
    id: `evento-${e.id}`, fecha: e.fecha, titulo: protegerCuil(e.nombre), tipo, resumen,
    detalles: [...resumen, ...campo('Rol del autor', e.rol),
      ...campo('Asignado a', e.para_roles.join(', ')), ...campo('CUE', e.cue),
      ...campo('Fecha de creación', e.created_at), ...campo('Agenda histórica', e.agenda_historica)],
  }
}

export function informeRegistro(r: RegistroCalendario, tipo: string): EntradaInforme {
  const resumen = [...campo('Estado', r.estado), ...campo('Lugar', r.lugar), ...campo('Detalle', r.descripcion)]
  const detalles = r.detalles ? r.detalles.flatMap((c) => campo(c.etiqueta, c.valor)) : [...resumen]
  return { id: r.id, fecha: r.fecha, titulo: protegerCuil(r.nombre), tipo, enlace: r.enlace, resumen, detalles, registro: r }
}

export function fechasDelMes(ano: number, mes: number): string[] {
  const dias = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate()
  return Array.from({ length: dias }, (_, i) => `${ano}-${String(mes + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}

export function ordenarInforme(entradas: readonly EntradaInforme[]): EntradaInforme[] {
  return [...entradas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.titulo.localeCompare(b.titulo, 'es') || a.id.localeCompare(b.id))
}

export function fechaArgentina(fecha = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(fecha)
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? ''
  return `${valor('year')}-${valor('month')}-${valor('day')}`
}
