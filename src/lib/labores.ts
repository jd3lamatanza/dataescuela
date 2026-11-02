import { supabase } from './supabase'

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/labores-drive`

async function call(body: Record<string, unknown>): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Tu sesión venció. Volvé a ingresar.')
  return fetch(FN, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function callJson<T>(body: Record<string, unknown>): Promise<T> {
  const r = await call(body)
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error ?? 'No se pudo completar la operación')
  return d as T
}

/** Crea/actualiza la carpeta y el archivo de texto de la labor en Drive. */
export const sincronizarLabor = (laborId: number) => callJson({ action: 'sync', labor_id: laborId })
export const quitarArchivo = (archivoId: number) => callJson({ action: 'quitar', archivo_id: archivoId })
export const eliminarLabor = (laborId: number) => callJson({ action: 'eliminar', labor_id: laborId })

/** Sube un archivo directo a Google Drive (sin límite de tamaño) y lo registra en la labor. */
export async function subirProbanza(laborId: number, file: File, onProgress: (pct: number) => void) {
  const { upload_url } = await callJson<{ upload_url: string }>({ action: 'init', labor_id: laborId, name: file.name, size: file.size, mime: file.type })
  const fileId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', upload_url)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onerror = () => reject(new Error(`No se pudo subir ${file.name}`))
    xhr.onload = () => {
      try {
        const id = JSON.parse(xhr.responseText).id
        xhr.status < 300 && id ? resolve(id) : reject(new Error(`No se pudo subir ${file.name}`))
      } catch { reject(new Error(`No se pudo subir ${file.name}`)) }
    }
    xhr.send(file)
  })
  await callJson({ action: 'register', labor_id: laborId, file_id: fileId })
}

async function bajarBlob(archivoId: number, mime: string | null): Promise<Blob> {
  const r = await call({ action: 'download', archivo_id: archivoId })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'No se pudo leer el archivo')
  return new Blob([await r.arrayBuffer()], { type: mime || 'application/octet-stream' })
}

/** Tipos que el navegador puede mostrar sin descargar. */
export const previsualizable = (mime: string | null) => !!mime && (mime === 'application/pdf' || mime.startsWith('image/') || mime.startsWith('text/'))

export async function urlVistaPrevia(archivoId: number, mime: string | null) {
  return URL.createObjectURL(await bajarBlob(archivoId, mime))
}

export async function descargarProbanza(archivoId: number, nombre: string, mime: string | null) {
  const url = URL.createObjectURL(await bajarBlob(archivoId, mime))
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre })
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export const driveLink = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`
