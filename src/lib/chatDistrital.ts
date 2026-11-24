import { supabase } from './supabase'

export interface ContactoChat {
  id: string
  nombre: string
  activo: boolean
  no_leidos: number
  ultimo_recibido: number | null
  ultimo_mensaje: string | null
}

export interface MensajeChat {
  id: number
  autor_id: string
  destinatario_id: string
  texto: string
  creado_en: string
  leido_en: string | null
}

export async function contactosChat(): Promise<ContactoChat[]> {
  const { data, error } = await supabase.rpc('chat_distrital_contactos')
  if (error) throw new Error(error.message)
  return (data ?? []) as ContactoChat[]
}

export async function historialChat(contacto: string, antes: number | null = null): Promise<MensajeChat[]> {
  const { data, error } = await supabase.rpc('chat_distrital_historial', { p_contacto: contacto, p_antes: antes })
  if (error) throw new Error(error.message)
  return (data ?? []) as MensajeChat[]
}

export async function enviarChat(contacto: string, texto: string, solicitud: string): Promise<void> {
  const { error } = await supabase.rpc('chat_distrital_enviar', { p_contacto: contacto, p_texto: texto, p_solicitud: solicitud })
  if (error) throw new Error(error.message)
}

export async function leerChat(contacto: string, hasta: number): Promise<void> {
  const { error } = await supabase.rpc('chat_distrital_leer', { p_contacto: contacto, p_hasta: hasta })
  if (error) throw new Error(error.message)
}
