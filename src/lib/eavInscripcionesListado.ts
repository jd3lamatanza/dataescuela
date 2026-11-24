import type { SupabaseClient } from '@supabase/supabase-js'
import type { Table } from './export'

export interface EscuelaEavListado {
  id: number; clave: string | null; cue: string; codigo: string | null
  tipo: string | null; numero: number | null; nombre: string | null; localidad: string | null
}

export interface InscripcionEav {
  id: number; temporada: number; escuela_eav_id: number; dni: string; nombre: string; nacimiento: string; genero: string
  escuela_actual_id: number | null; escuela_actual_otra: string | null; domicilio: string
  responsable: string; vinculo: string; telefono: string; email: string; creado_en: string
  inscrito_en: string | null; legajo_completo: boolean | null
  escuela_eav: EscuelaEavListado | null; escuela_actual: EscuelaEavListado | null
}

export interface FiltrosInscripcionesEav { escuela: string; busqueda: string }

const CAMPOS_ESCUELA = 'id,clave,cue,codigo,tipo,numero,nombre,localidad'
const CAMPOS = `id,temporada,escuela_eav_id,dni,nombre,nacimiento,genero,escuela_actual_id,escuela_actual_otra,domicilio,responsable,vinculo,telefono,email,creado_en,inscrito_en,legajo_completo,escuela_eav:escuelas!eav_preinscripciones_escuela_eav_id_fkey(${CAMPOS_ESCUELA}),escuela_actual:escuelas!eav_preinscripciones_escuela_actual_id_fkey(${CAMPOS_ESCUELA})`

export const nombreEscuelaEav = (e: EscuelaEavListado | null) =>
  e ? [e.tipo || e.codigo, e.numero, e.nombre, e.localidad ? `(${e.localidad})` : '', e.clave ? `· ${e.clave}` : '', `· CUE ${e.cue}`].filter(Boolean).join(' ') : 'Escuela no disponible'

export const limpiarBusquedaInscripcionesEav = (texto: string) => texto.trim().slice(0, 80).replace(/[,()%*\\"]/g, ' ').trim()
export const fechaEav = (fecha: string) => fecha.split('-').reverse().join('/')
export const fechaHoraEav = (fecha: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(fecha))

export function consultaInscripcionesEav(cliente: SupabaseClient, filtros: FiltrosInscripcionesEav) {
  let consulta = cliente.from('eav_preinscripciones').select(CAMPOS, { count: 'exact' })
  if (filtros.escuela) consulta = consulta.eq('escuela_eav_id', Number(filtros.escuela))
  const texto = limpiarBusquedaInscripcionesEav(filtros.busqueda)
  if (texto) consulta = consulta.or(`nombre.ilike.%${texto}%,dni.ilike.%${texto}%`)
  return consulta.order('temporada', { ascending: false }).order('creado_en', { ascending: false }).order('id', { ascending: false })
}

export async function leerInscripcionesEav(cliente: SupabaseClient, filtros: FiltrosInscripcionesEav): Promise<InscripcionEav[]> {
  const filas: InscripcionEav[] = []
  for (let offset = 0; ; offset += 500) {
    const r = await consultaInscripcionesEav(cliente, filtros).range(offset, offset + 499).overrideTypes<InscripcionEav[], { merge: false }>()
    if (r.error) throw r.error
    filas.push(...r.data)
    if (r.data.length < 500) return filas
  }
}

export async function leerEscuelasEav(cliente: SupabaseClient): Promise<EscuelaEavListado[]> {
  const filas: EscuelaEavListado[] = []
  for (let offset = 0; ; offset += 500) {
    const r = await cliente.from('escuelas').select(CAMPOS_ESCUELA).order('id').range(offset, offset + 499)
    if (r.error) throw r.error
    filas.push(...r.data as EscuelaEavListado[])
    if (r.data.length < 500) return filas.sort((a, b) => nombreEscuelaEav(a).localeCompare(nombreEscuelaEav(b), 'es', { numeric: true }))
  }
}

export function tablaInscripcionesEav(filas: InscripcionEav[], filtros: FiltrosInscripcionesEav, escuela: EscuelaEavListado | undefined, organizacion: string): Table {
  const detalles = [escuela && `Escuela: ${nombreEscuelaEav(escuela)}`, filtros.busqueda && `Búsqueda: ${filtros.busqueda}`, `${filas.length} estudiante(s)`].filter(Boolean).join(' · ')
  return {
    title: 'Preinscripciones e inscripciones - Escuela de Verano',
    subtitle: `${organizacion} · ${detalles}`,
    headers: ['Escuela de verano', 'Estudiante', 'DNI', 'Nacimiento', 'Temporada', 'Responsable', 'Teléfono', 'Estado', 'Legajo'],
    widths: [31, 26, 13, 13, 10, 25, 16, 15, 14],
    rows: filas.map((p) => [nombreEscuelaEav(p.escuela_eav), p.nombre, p.dni, fechaEav(p.nacimiento), String(p.temporada),
      p.responsable, p.telefono, p.inscrito_en ? 'Inscripto' : 'Preinscripto', p.inscrito_en ? (p.legajo_completo ? 'Completo' : 'Incompleto') : 'Pendiente']),
  }
}
