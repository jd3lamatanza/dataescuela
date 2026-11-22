export type FuenteCalendario = 'acreditacion' | 'salida' | 'labor' | 'disposicion' | 'matricula' | 'posesion' | 'contingencia'
export interface RegistroCalendario {
  id: string
  fuente: FuenteCalendario
  fecha: string
  nombre: string
  descripcion: string
  lugar?: string | null
  estado?: string
  enlace: string
  detalles?: { etiqueta: string; valor: string }[]
}
export interface Acreditacion { id: string; nombre: string; fecha: string; lugar: string; descripcion: string; hora_inicio: string; hora_fin: string; estado: string }
export interface Salida { id: number; titulo: string; fecha: string; destino: string; escuela: string; clave: string | null; evento_id: number | null; estado: { nombre: string } | null }
export interface Labor { id: number; fecha: string; motivo: string; autor: string; lugar: { nombre: string } | null; evento: { nombre: string } | null }
export interface Disposicion { id: number; fecha_designacion: string; fecha_desde: string; docente_nombre: string; escuela_cubrir_clave: string; escuela_cubrir_nombre: string; tipo: string; estado: string }
export interface Periodo { id: number; ciclo: number; mes: number; fecha_apertura: string; fecha_cierre: string; carga: boolean }
export interface TomaEquipo { id: number; apellido_nombre: string; toma_posesion: string; activo: boolean; escuela: { clave: string; nombre: string | null } | null }
export interface TomaInspector { id: number; nombre: string | null; fecha_toma_posesion: string; activo: boolean }
export interface DatosDistritales { acreditaciones: Acreditacion[]; salidas: Salida[]; labores: Labor[]; disposiciones: Disposicion[]; periodos: Periodo[]; directivos: TomaEquipo[]; orientacion: TomaEquipo[]; inspectores: TomaInspector[] }

export function mostrarEventoCalendario(tipo: { id: number; nombre: string }, ocultos: readonly string[], unificarSalidas: boolean): boolean {
  const clave = unificarSalidas && tipo.nombre === 'Salida Educativa' ? 'fuente-salida' : `evento-${tipo.id}`
  return !ocultos.includes(clave)
}

export function mostrarRegistroCalendario(fuente: FuenteCalendario, ocultos: readonly string[]): boolean {
  return !ocultos.includes(`fuente-${fuente}`)
}

export function sinEventosDeSalidas<T extends { id: number }>(eventos: T[], vinculados: readonly number[]): T[] {
  const ids = new Set(vinculados)
  return eventos.filter((evento) => !ids.has(evento.id))
}
const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export function fechaPosesion(fecha: string): string | null {
  const normal = fecha.trim()
  const local = normal.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  const iso = local ? `${local[3]}-${local[2]}-${local[1]}` : normal
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso
}
export function registrosDistritales(datos: DatosDistritales, desde: string, hasta: string): RegistroCalendario[] {
  const registros: RegistroCalendario[] = [
    ...datos.acreditaciones.map((a): RegistroCalendario => ({
      id: `acreditacion-${a.id}`, fuente: 'acreditacion', fecha: a.fecha, nombre: a.nombre, lugar: a.lugar,
      descripcion: `${a.hora_inicio.slice(0, 5)} a ${a.hora_fin.slice(0, 5)} · ${a.descripcion}`,
      estado: a.estado === 'activo' ? 'Acreditación activa' : a.estado === 'finalizado' ? 'Finalizado' : 'Sin iniciar',
      enlace: '/acreditacion',
    })),
    ...datos.salidas.map((s): RegistroCalendario => ({
      id: `salida-${s.id}`, fuente: 'salida', fecha: s.fecha, nombre: s.titulo, lugar: s.destino,
      descripcion: `${s.escuela}${s.clave ? ` · ${s.clave}` : ''}`, estado: s.estado?.nombre ?? 'Sin estado',
      enlace: '/salidas-distrito',
    })),
    ...datos.labores.map((l): RegistroCalendario => ({
      id: `labor-${l.id}`, fuente: 'labor', fecha: l.fecha, nombre: l.motivo, lugar: l.lugar?.nombre,
      descripcion: `${l.evento?.nombre ?? 'Labor'} · ${l.autor}`, enlace: `/labores-distrito?labor=${l.id}`,
    })),
  ]
  for (const d of datos.disposiciones) {
    for (const [clase, fecha] of [['Designación', d.fecha_designacion], ['Inicio', d.fecha_desde]] as const) {
      registros.push({
        id: `disposicion-${d.id}-${clase}`, fuente: 'disposicion', fecha,
        nombre: `${clase}: ${d.tipo}`, descripcion: `${d.docente_nombre} · ${d.escuela_cubrir_clave} · ${d.escuela_cubrir_nombre}`,
        estado: d.estado, enlace: '/disposiciones',
      })
    }
  }
  for (const p of datos.periodos) {
    for (const [clase, fecha] of [['Apertura', p.fecha_apertura], ['Cierre', p.fecha_cierre]] as const) {
      registros.push({
        id: `matricula-${p.id}-${clase}`, fuente: 'matricula', fecha,
        nombre: `${clase} de matrícula: ${meses[p.mes - 1]} ${p.ciclo}`,
        descripcion: 'Período de carga de matrícula', estado: p.carga ? 'Habilitado' : 'Finalizado',
        enlace: `/matriculas?periodo=${p.id}`,
      })
    }
  }
  let fechasInvalidas = 0
  for (const [tipo, items] of [['Equipo directivo', datos.directivos], ['Equipo de orientación', datos.orientacion]] as const) {
    for (const item of items) {
      const fecha = fechaPosesion(item.toma_posesion)
      if (!fecha) { fechasInvalidas++; continue }
      registros.push({
        id: `posesion-${tipo}-${item.id}`, fuente: 'posesion', fecha, nombre: `Toma de posesión: ${item.apellido_nombre}`,
        descripcion: `${tipo}${item.escuela ? ` · ${item.escuela.clave} ${item.escuela.nombre ?? ''}` : ''}`,
        estado: item.activo ? 'Activo' : 'Inactivo', enlace: '/escuelas',
      })
    }
  }
  for (const item of datos.inspectores) {
    const fecha = fechaPosesion(item.fecha_toma_posesion)
    if (!fecha) { fechasInvalidas++; continue }
    registros.push({
      id: `posesion-inspector-${item.id}`, fuente: 'posesion', fecha, nombre: `Toma de posesión: ${item.nombre ?? 'Inspector'}`,
      descripcion: 'Inspector', estado: item.activo ? 'Activo' : 'Inactivo', enlace: '/inspectores',
    })
  }
  if (fechasInvalidas) console.warn(`Calendario: ${fechasInvalidas} fechas de toma de posesión no son válidas.`)
  return registros.filter((r) => r.fecha >= desde && r.fecha <= hasta)
}

export async function leerPaginas<T>(pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const registros: T[] = []
  for (let desde = 0; ; desde += 500) {
    const { data, error } = await pagina(desde, desde + 499)
    if (error) throw new Error(error.message)
    if (!data) throw new Error('El servidor no devolvió los registros del calendario.')
    registros.push(...data)
    if (data.length < 500) return registros
  }
}
