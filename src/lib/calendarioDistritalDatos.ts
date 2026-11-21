import { supabase } from './supabase'
import { leerPaginas, registrosDistritales, type Acreditacion, type Salida, type Labor, type Disposicion, type Periodo, type TomaEquipo, type TomaInspector, type RegistroCalendario } from './calendarioDistrital'

export async function cargarCalendarioDistrital(desde: string, hasta: string): Promise<{ registros: RegistroCalendario[]; eventosSalidas: number[] }> {
  const rango = (a: string, b: string) => `and(${a}.gte.${desde},${a}.lte.${hasta}),and(${b}.gte.${desde},${b}.lte.${hasta})`
  const fechasTexto = (campo: string) => {
    const [y, m] = desde.split('-').map(Number)
    const fin = hasta.slice(0, 7)
    const meses: string[] = []
    for (let d = new Date(Date.UTC(y, m - 1, 1)); d.toISOString().slice(0, 7) <= fin; d.setUTCMonth(d.getUTCMonth() + 1)) {
      meses.push(`${campo}.like.*/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`)
    }
    return `and(${campo}.gte.${desde},${campo}.lte.${hasta}),${meses.join(',')}`
  }
  const [acreditaciones, salidas, labores, disposiciones, periodos, directivos, orientacion, inspectores] = await Promise.all([
    leerPaginas<Acreditacion>((a, b) => supabase.from('acreditacion_eventos').select('id,nombre,fecha,lugar,descripcion,hora_inicio,hora_fin,estado').gte('fecha', desde).lte('fecha', hasta).order('id').range(a, b)),
    leerPaginas<Salida>((a, b) => supabase.from('salidas').select('id,titulo,fecha,destino,escuela,clave,evento_id,estado:salida_estados(nombre)').gte('fecha', desde).lte('fecha', hasta).order('id').range(a, b).overrideTypes<Salida[], { merge: false }>()),
    leerPaginas<Labor>((a, b) => supabase.from('labores').select('id,fecha,motivo,autor,lugar:catalogos!labores_lugar_id_fkey(nombre),evento:catalogos!labores_evento_id_fkey(nombre)').gte('fecha', desde).lte('fecha', hasta).order('id').range(a, b).overrideTypes<Labor[], { merge: false }>()),
    leerPaginas<Disposicion>((a, b) => supabase.from('disposiciones').select('id,fecha_designacion,fecha_desde,docente_nombre,escuela_cubrir_clave,escuela_cubrir_nombre,tipo,estado').or(rango('fecha_designacion', 'fecha_desde')).order('id').range(a, b)),
    leerPaginas<Periodo>((a, b) => supabase.from('carga_activa').select('id,ciclo,mes,fecha_apertura,fecha_cierre,carga').or(rango('fecha_apertura', 'fecha_cierre')).order('id').range(a, b)),
    leerPaginas<TomaEquipo>((a, b) => supabase.from('equipo_directivo').select('id,apellido_nombre,toma_posesion,activo,escuela:escuelas(clave,nombre)').or(fechasTexto('toma_posesion')).order('id').range(a, b).overrideTypes<TomaEquipo[], { merge: false }>()),
    leerPaginas<TomaEquipo>((a, b) => supabase.from('equipo_orientacion').select('id,apellido_nombre,toma_posesion,activo,escuela:escuelas(clave,nombre)').or(fechasTexto('toma_posesion')).order('id').range(a, b).overrideTypes<TomaEquipo[], { merge: false }>()),
    leerPaginas<TomaInspector>((a, b) => supabase.from('inspectores').select('id,nombre,fecha_toma_posesion,activo').or(fechasTexto('fecha_toma_posesion')).order('id').range(a, b)),
  ])
  return { registros: registrosDistritales({ acreditaciones, salidas, labores, disposiciones, periodos, directivos, orientacion, inspectores }, desde, hasta), eventosSalidas: salidas.flatMap((s) => s.evento_id === null ? [] : [s.evento_id]) }
}
