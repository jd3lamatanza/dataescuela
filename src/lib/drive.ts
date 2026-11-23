import { supabase } from './supabase'

export async function llamarDrive(servicio: 'proyectos-drive' | 'proyectos-areales-drive' | 'reportes-error', body: FormData | Record<string, unknown>): Promise<Response> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  if (!data.session?.access_token) throw new Error('Tu sesión venció. Volvé a ingresar.')
  const h: Record<string, string> = { Authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_KEY }
  if (!(body instanceof FormData)) h['Content-Type'] = 'application/json'
  const respuesta = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${servicio}`, {
    method: 'POST', headers: h, body: body instanceof FormData ? body : JSON.stringify(body),
  })
  if (!respuesta.ok) {
    let mensaje = `No se pudo completar la operación (${respuesta.status}).`
    try { const detalle = await respuesta.json(); if (typeof detalle.error === 'string') mensaje = detalle.error } catch { /* respuesta sin JSON */ }
    throw new Error(mensaje)
  }
  return respuesta
}
