import { supabase } from './supabase'

export interface ArchivoDisposicion { id: number; disposicion_id: number; nombre: string; mime: string; bytes: number; drive_file_id: string; tipo: 'inicial' | 'seguimiento' }
export type AdjuntoEscolar = Pick<ArchivoDisposicion, 'id' | 'disposicion_id' | 'nombre' | 'mime'>
export interface Disposicion {
  id: number; estado: string; fecha_registro: string; inspector: string; email_jefatura: string
  docente_nombre: string; docente_cuil: string; docente_email: string
  escuela_cubrir_id: number; escuela_cubrir_clave: string; escuela_cubrir_nombre: string
  cargo_cubrir: string; revista_cubrir: string; tipo: string; motivo: string
  fecha_designacion: string; numero_designacion: string
  escuela_base_id: number | null; escuela_base_clave: string; escuela_base_nombre: string; escuela_base_fuera_distrital: boolean
  cargo_base: string; revista_base: string; fecha_desde: string; observaciones: string
  usuario: string; actualizada: string; archivos: ArchivoDisposicion[]
  creado_areal: boolean; leida_at: string | null
}
export interface DisposicionEscolar { id: number; estado: string; fecha_registro: string; escuela_cubrir_nombre: string; pdf_disponible: boolean }
export interface MensajeDisposicion { id: number; autor: string; rol: string; texto: string; created_at: string }
export interface MotivoDisposicion { tipo: string; motivo: string; orden: number }
export const ESTADOS = ['Pendiente', 'En proceso', 'Enviada a SAD', 'Rechazada', 'Devuelta para Corrección']
export const CARGOS = ['Director', 'Vicedirector', 'Secretario', 'Prosecretario']
export const REVISTAS = ['Titular', 'Provisional', 'Suplente']
export const MAX_ARCHIVOS = 3
export const MAX_BYTES = 10 * 1024 * 1024
export const TIPOS_ARCHIVO = ['application/pdf', 'image/jpeg', 'image/png']

async function llamar(body: Record<string, unknown>) {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('Tu sesión venció. Volvé a ingresar.')
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/disposiciones-drive`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const result = await r.json()
    throw new Error(result.error || 'No se pudo completar la operación.')
  }
  return r
}

export async function subirArchivo(disposicionId: number, archivo: File, seguimiento = false) {
  if (!TIPOS_ARCHIVO.includes(archivo.type) || archivo.size < 1 || archivo.size > MAX_BYTES) throw new Error('Elegí un PDF, JPG o PNG de hasta 10 MB.')
  const inicio = await llamar({ action: 'init', disposicion_id: disposicionId, name: archivo.name, mime: archivo.type, size: archivo.size, seguimiento })
  const { upload_url } = await inicio.json()
  if (typeof upload_url !== 'string') throw new Error('No se pudo iniciar la carga en Drive.')
  const subida = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': archivo.type }, body: archivo })
  if (!subida.ok) throw new Error(`No se pudo subir ${archivo.name}.`)
  const result = await subida.json()
  if (typeof result.id !== 'string') throw new Error(`No se pudo identificar ${archivo.name} en Drive.`)
  try {
    await llamar({ action: 'register', disposicion_id: disposicionId, file_id: result.id, name: archivo.name, seguimiento })
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new Error(`No se pudo confirmar la vinculación de ${archivo.name}. El archivo podría haber quedado en Drive; revisá la disposición y la carpeta antes de reintentar. ${detalle}`)
  }
}

export async function finalizarTramite(disposicionId: number, archivo: File) {
  if (!/\.pdf$/i.test(archivo.name) || archivo.size < 1 || archivo.size > MAX_BYTES
    || new TextDecoder().decode(await archivo.slice(0, 5).arrayBuffer()) !== '%PDF-') throw new Error('Elegí un PDF válido de hasta 10 MB.')
  const inicio = await llamar({ action: 'final-init', disposicion_id: disposicionId, name: archivo.name, size: archivo.size })
  const { upload_url } = await inicio.json()
  if (typeof upload_url !== 'string') throw new Error('No se pudo iniciar la carga del PDF.')
  const subida = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: archivo })
  if (!subida.ok) throw new Error('No se pudo subir el PDF.')
  const result = await subida.json()
  if (typeof result.id !== 'string') throw new Error('No se pudo identificar el PDF en Drive.')
  try { await llamar({ action: 'final-register', disposicion_id: disposicionId, file_id: result.id, name: archivo.name }) }
  catch (error) { throw new Error(`El PDF podría haber quedado en Drive, pero no se confirmó la finalización: ${error instanceof Error ? error.message : String(error)}`) }
}

export async function abrirPdfFinal(id: number) {
  const respuesta = await llamar({ action: 'final-download', disposicion_id: id })
  const url = URL.createObjectURL(new Blob([await respuesta.arrayBuffer()], { type: 'application/pdf' }))
  const enlace = document.createElement('a')
  enlace.href = url; enlace.download = `disposicion-${id}.pdf`
  document.body.append(enlace); enlace.click(); enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function quitarArchivo(id: number) {
  await llamar({ action: 'remove', archivo_id: id })
}

export async function abrirArchivo(archivo: Pick<ArchivoDisposicion, 'id' | 'nombre' | 'mime'>) {
  const respuesta = await llamar({ action: 'download', archivo_id: archivo.id })
  const blob = new Blob([await respuesta.arrayBuffer()], { type: archivo.mime })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url; enlace.download = archivo.nombre
  document.body.append(enlace); enlace.click(); enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
