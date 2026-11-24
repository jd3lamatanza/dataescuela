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
export interface DisposicionEscolar { id: number; estado: string; fecha_registro: string; escuela_cubrir_nombre: string; cargo_cubrir: string; docente_nombre: string; inspector: string; pdf_disponible: boolean }
export interface MensajeDisposicion { id: number; autor: string; rol: string; texto: string; created_at: string }
export interface MotivoDisposicion { tipo: string; motivo: string; orden: number }
export const ESTADOS = ['Pendiente', 'En proceso', 'Enviada a SAD', 'Rechazada', 'Devuelta para Corrección']
export const CARGOS = ['Director', 'Vicedirector', 'Secretario', 'Prosecretario']
export const REVISTAS = ['Titular', 'Provisional', 'Suplente']
export const MAX_BYTES = 10 * 1024 * 1024
const FORMATOS: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
export const FORMATOS_ACEPTADOS = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx'
export function validarArchivo(archivo: File) {
  const mime = FORMATOS[archivo.name.split('.').pop()?.toLowerCase() ?? '']
  if (!mime || archivo.size < 1 || archivo.size > MAX_BYTES || (archivo.type && archivo.type !== mime && archivo.type !== 'application/octet-stream'))
    throw new Error('Elegí archivos PDF, JPG, PNG, Word o Excel de hasta 10 MB cada uno.')
  return mime
}

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

async function subirArchivo(disposicionId: number, archivo: File, lote: string, seguimiento: boolean) {
  const mime = validarArchivo(archivo)
  const inicio = await llamar({ action: 'init', disposicion_id: disposicionId, lote_id: lote, name: archivo.name, mime, size: archivo.size, seguimiento })
  const { upload_url } = await inicio.json()
  if (typeof upload_url !== 'string') throw new Error('No se pudo iniciar la carga en Drive.')
  const subida = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': mime }, body: archivo })
  if (!subida.ok) throw new Error(`No se pudo subir ${archivo.name}.`)
  const result = await subida.json()
  if (typeof result.id !== 'string') throw new Error(`No se pudo identificar ${archivo.name} en Drive.`)
  try {
    await llamar({ action: 'register', disposicion_id: disposicionId, lote_id: lote, file_id: result.id, name: archivo.name, seguimiento })
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error)
    throw new Error(`No se pudo confirmar la vinculación de ${archivo.name}. El archivo podría haber quedado en Drive; revisá la disposición y la carpeta antes de reintentar. ${detalle}`)
  }
}

export async function subirLote(disposicionId: number, archivos: File[], seguimiento = false) {
  if (!archivos.length) return
  archivos.forEach(validarArchivo)
  const inicio = await supabase.rpc('disposicion_lote_iniciar', { p_id: disposicionId, p_cantidad: archivos.length })
  if (inicio.error) throw inicio.error
  const lote = inicio.data as string
  try {
    for (const archivo of archivos) await subirArchivo(disposicionId, archivo, lote, seguimiento)
    const resultado = await supabase.rpc('disposicion_lote_cerrar', { p_lote: lote, p_completar: true })
    if (resultado.error) throw resultado.error
  } catch (error) {
    const cancelar = await supabase.rpc('disposicion_lote_cerrar', { p_lote: lote, p_completar: false })
    const detalle = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)
    throw new Error(`${detalle}. La carga no se completó; algunos archivos podrían haber quedado en Drive.${cancelar.error ? ` No se pudo cancelar la carga: ${cancelar.error.message}` : ''}`)
  }
}

export async function finalizarTramite(disposicionId: number) {
  await llamar({ action: 'approve', disposicion_id: disposicionId })
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
