import type { SupabaseClient } from '@supabase/supabase-js'
import type { Table } from './export'
import type { Escuela } from './escuelaEtiqueta'

// Helpers locales: este módulo se prueba con Node sin resolver imports de valores entre archivos .ts
const fechaEav = (fecha: string) => fecha.split('-').reverse().join('/')
const fechaHoraEav = (fecha: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(fecha))
const limpiarBusqueda = (texto: string) => texto.trim().slice(0, 80).replace(/[,()%*\\"]/g, ' ').trim()
const etiquetaEscuela = (e: Escuela) => [e.tipo || e.codigo, e.numero, e.nombre, e.localidad ? `(${e.localidad})` : ''].filter(Boolean).join(' ')

export type VersionListado = 'resumida' | 'completa'

export interface PreinscripcionCuenta {
  id: number; temporada: number; dni: string; nombre: string; nacimiento: string; genero: string
  escuela_actual_id: number | null; escuela_actual_otra: string | null; domicilio: string
  responsable: string; vinculo: string; telefono: string; email: string; creado_en: string
  inscrito_en: string | null; legajo_completo: boolean | null
}

const CAMPOS = 'id,temporada,dni,nombre,nacimiento,genero,escuela_actual_id,escuela_actual_otra,domicilio,responsable,vinculo,telefono,email,creado_en,inscrito_en,legajo_completo'

/** Todas las preinscripciones de la escuela de la cuenta (la base solo expone las propias) que coinciden con la búsqueda. */
export async function leerPreinscripcionesCuenta(cliente: SupabaseClient, escuelaId: number, busqueda: string): Promise<PreinscripcionCuenta[]> {
  const filas: PreinscripcionCuenta[] = []
  const texto = limpiarBusqueda(busqueda)
  for (let offset = 0; ; offset += 500) {
    let q = cliente.from('eav_preinscripciones').select(CAMPOS).eq('escuela_eav_id', escuelaId)
    if (texto) q = q.or(`nombre.ilike.%${texto}%,dni.ilike.%${texto}%`)
    const r = await q.order('temporada', { ascending: false }).order('creado_en', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 499)
    if (r.error) throw r.error
    filas.push(...r.data as PreinscripcionCuenta[])
    if (r.data.length < 500) return filas
  }
}

export async function leerEtiquetasEscuelas(cliente: SupabaseClient): Promise<Map<number, string>> {
  const r = await cliente.rpc('eav_escuelas_opciones')
  if (r.error) throw r.error
  return new Map((r.data as Escuela[]).map((e) => [e.id, etiquetaEscuela(e) || `Escuela ${e.id}`]))
}

const estado = (p: PreinscripcionCuenta) => (p.inscrito_en ? 'Inscripto' : 'Preinscripto')
const legajo = (p: PreinscripcionCuenta) => (p.inscrito_en ? (p.legajo_completo ? 'Completo' : 'Incompleto') : 'Pendiente')

export function tablaPreinscripcionesCuenta(
  filas: PreinscripcionCuenta[], version: VersionListado,
  contexto: { escuela: string; busqueda: string; organizacion: string; escuelasActuales: Map<number, string> },
): Table {
  const detalles = [`Escuela: ${contexto.escuela}`, contexto.busqueda && `Búsqueda: ${contexto.busqueda}`, `${filas.length} estudiante(s)`].filter(Boolean).join(' · ')
  const base = {
    title: `Preinscripciones e inscripciones - Escuela de Verano (${version})`,
    subtitle: `${contexto.organizacion} · ${detalles}`,
  }
  if (version === 'resumida') {
    return {
      ...base,
      headers: ['Estudiante', 'DNI', 'Nacimiento', 'Responsable', 'Teléfono', 'Estado', 'Legajo'],
      widths: [30, 13, 13, 28, 16, 15, 13],
      rows: filas.map((p) => [p.nombre, p.dni, fechaEav(p.nacimiento), p.responsable, p.telefono, estado(p), legajo(p)]),
    }
  }
  return {
    ...base,
    headers: ['Temporada', 'Estudiante', 'DNI', 'Nacimiento', 'Género', 'Escuela actual', 'Domicilio', 'Responsable', 'Vínculo', 'Teléfono', 'Email', 'Preinscripción', 'Inscripción', 'Legajo'],
    widths: [10, 26, 12, 12, 11, 28, 26, 24, 16, 15, 26, 16, 16, 12],
    rows: filas.map((p) => [String(p.temporada), p.nombre, p.dni, fechaEav(p.nacimiento), p.genero,
      p.escuela_actual_id ? contexto.escuelasActuales.get(p.escuela_actual_id) ?? `Escuela ${p.escuela_actual_id}` : p.escuela_actual_otra ?? '',
      p.domicilio, p.responsable, p.vinculo, p.telefono, p.email, fechaHoraEav(p.creado_en), p.inscrito_en ? fechaHoraEav(p.inscrito_en) : 'Pendiente', legajo(p)]),
  }
}
