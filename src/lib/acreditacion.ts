import { supabase } from './supabase'
import type { Escuela } from './escuelaEtiqueta'
import type { DatosPersona, EscuelaCargoForm, Evento } from './acreditacionTipos'
export type { DatosPersona, Evento, Persona, Progreso } from './acreditacionTipos'

export const escuelaCargoVacia = (): EscuelaCargoForm => ({ cargo: '', escuela: '', externa: false, escuelaExterna: '' })
export const personaVacia = (): DatosPersona => ({ nombre: '', dni: '', escuelas: [escuelaCargoVacia()], email: '' })
export const linkEvento = (id: string) => `https://jd3lamatanza.github.io/dataescuela/#/registro-acreditacion?id=${encodeURIComponent(id)}`
export const fechaEvento = (evento: Evento) => `${evento.fecha.split('-').reverse().join('/')} · ${evento.hora_inicio.slice(0, 5)} a ${evento.hora_fin.slice(0, 5)}`

export async function invocarPublico(action: string, evento: string, form?: DatosPersona): Promise<{ evento?: Evento; escuelas?: Escuela[] }> {
  const respuesta = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acreditacion-publica`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_KEY },
    body: JSON.stringify({ action, evento, ...(form ? { form: { ...form, escuelas: escuelasParaRegistro(form) } } : {}) }),
  })
  const datos = await respuesta.json()
  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la solicitud.')
  return datos
}

export async function cargarEscuelas(): Promise<Escuela[]> {
  const escuelas: Escuela[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('escuelas').select('id,nombre,tipo,numero,codigo,localidad,eav').order('id').range(offset, offset + 499)
    if (error) throw error
    escuelas.push(...data)
    if (data.length < 500) return escuelas
  }
}

export async function registrarManual(evento: string, form: DatosPersona) {
  const { data, error } = await supabase.rpc('acreditacion_registrar_multi', {
    p_evento: evento, p_nombre: form.nombre, p_dni: form.dni,
    p_escuelas: escuelasParaRegistro(form), p_email: form.email, p_publico: false,
  })
  if (error) throw error
  if (data === 'duplicado') throw new Error('El DNI ya se encuentra acreditado en este evento.')
  if (data !== 'ok') throw new Error('No se pudo registrar la acreditación. Revisá los datos.')
}

function escuelasParaRegistro(form: DatosPersona) {
  return form.escuelas.map((e) => ({
    cargo: e.cargo, escuela_id: e.externa ? null : Number(e.escuela), escuela_externa: e.externa ? e.escuelaExterna : null,
  }))
}
