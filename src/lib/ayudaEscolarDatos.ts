import type { GestionGuia, GuiaEscolar } from './ayudaEscolar'
import { supabase } from './supabase'

export async function cargarGuias(): Promise<GuiaEscolar[]> {
  const { data, error } = await supabase.from('ayuda_guias').select('*').order('posicion').order('titulo')
  if (error) throw new Error('No se pudieron cargar las guías: ' + error.message)
  return data as GuiaEscolar[]
}

export async function gestionarGuia(body: GestionGuia): Promise<{ guia?: GuiaEscolar }> {
  const { data, error } = await supabase.functions.invoke('ayuda-gestionar', { body })
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      let detalle: unknown
      try { detalle = await error.context.json() } catch { detalle = null }
      if (detalle && typeof detalle === 'object' && 'error' in detalle && typeof detalle.error === 'string') throw new Error(detalle.error)
    }
    throw new Error('No se pudo gestionar la guía: ' + error.message)
  }
  return data
}
