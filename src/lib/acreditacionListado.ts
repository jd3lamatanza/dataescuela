import type { Evento, Persona } from './acreditacionTipos'
import { etiquetaEscuela } from './escuelaEtiqueta'
import type { Table } from './export'

export function estadoConstancia(p: Persona): { texto: string; detalle: string; icon: 'check' | 'alert' | 'clock' | 'send'; tone: 'green' | 'amber' | 'blue' | 'slate' } {
  if (p.constancia_enviada_en) return { texto: 'Enviada', detalle: new Date(p.constancia_enviada_en).toLocaleString('es-AR'), icon: 'check', tone: 'green' }
  if (p.envio_estado === 'incierto') return { texto: 'Envío sin confirmar', detalle: 'Pendiente de reintento', icon: 'alert', tone: 'amber' }
  if (p.envio_estado === 'enviando') return { texto: 'Envío en curso', detalle: '', icon: 'send', tone: 'blue' }
  return { texto: 'Pendiente', detalle: '', icon: 'clock', tone: 'slate' }
}

export function tablaAcreditados(evento: Evento, personas: Persona[], busqueda: string, organizacion: string): Table {
  const fecha = evento.fecha.split('-').reverse().join('/')
  const subtitle = [
    organizacion, `Evento: ${evento.nombre}`, `Fecha: ${fecha}`,
    `Horario: ${evento.hora_inicio.slice(0, 5)} a ${evento.hora_fin.slice(0, 5)}`,
    `Lugar: ${evento.lugar}`, `Descripción: ${evento.descripcion}`,
    busqueda && `Búsqueda: ${busqueda}`, `${personas.length} acreditado(s)`,
  ].filter(Boolean).join(' · ')
  return {
    title: 'Listado de acreditados', subtitle,
    headers: ['Nombre completo', 'DNI', 'Cargo', 'Escuela', 'Correo Oficial ABC', 'Constancia'],
    widths: [23, 10, 17, 26, 24, 20],
    rows: personas.map((p) => {
      const estado = estadoConstancia(p)
      return [p.nombre, p.dni, p.cargo, p.escuela ? etiquetaEscuela(p.escuela) : `Escuela ${p.escuela_id}`, p.email, [estado.texto, estado.detalle].filter(Boolean).join(' · ')]
    }),
  }
}
