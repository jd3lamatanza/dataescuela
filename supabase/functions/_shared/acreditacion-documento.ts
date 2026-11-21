import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { generarConstancia, type EventoConstancia, type PersonaConstancia, type FirmaConstancia } from './constancia.ts'

export async function prepararConstancia(admin: SupabaseClient, evento: string, personaId: number) {
  const [ev, person, adicionales, imagenes] = await Promise.all([
    admin.from('acreditacion_eventos').select('nombre,lugar,fecha,hora_inicio,hora_fin').eq('id', evento).single(),
    admin.from('acreditacion_personas').select('nombre,email,cargo,escuela_id,escuela_externa').eq('id', personaId).eq('evento_id', evento).single(),
    admin.from('acreditacion_escuelas_adicionales').select('orden,cargo,escuela_id,escuela_externa').eq('persona_id', personaId).order('orden'),
    admin.rpc('acreditacion_firmas_evento_datos', { p_evento: evento }),
  ])
  if (ev.error || person.error || adicionales.error || imagenes.error) throw new Error('No se pudieron cargar los datos de la constancia.')
  if (!imagenes.data?.length) throw new Error('La Distrital todavía no configuró las firmas de este evento.')
  const firmas: FirmaConstancia[] = imagenes.data
  const identificar = async (item: { cargo: string; escuela_id: number | null; escuela_externa: string | null }) => {
    let nombreEscuela = item.escuela_externa
    if (item.escuela_id != null) {
      const { data: escuela, error } = await admin.from('escuelas').select('id,clave,tipo,numero,nombre,codigo,localidad').eq('id', item.escuela_id).single()
      if (error || !escuela) throw new Error('No se pudo cargar la escuela del acreditado.')
      nombreEscuela = escuela.clave?.trim() || [escuela.tipo || escuela.codigo, escuela.numero, escuela.nombre, escuela.localidad ? `(${escuela.localidad})` : ''].filter(Boolean).join(' ') || `Escuela ${escuela.id}`
    }
    if (!nombreEscuela) throw new Error('La escuela del acreditado no tiene identificación.')
    return { cargo: item.cargo, escuela: nombreEscuela }
  }
  const escuelas = await Promise.all([person.data, ...adicionales.data].map(identificar))
  const persona: PersonaConstancia = { nombre: person.data.nombre, ...escuelas[0], adicionales: escuelas.slice(1) }
  return { contenido: await generarConstancia(ev.data as EventoConstancia, persona, firmas), email: person.data.email }
}
