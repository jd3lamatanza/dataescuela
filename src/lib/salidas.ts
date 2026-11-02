import { supabase } from './supabase'

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/salidas-drive`

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

/** Sube un archivo directo a Google Drive (sin límite de tamaño) y lo registra en la salida. */
export async function subirArchivo(salidaId: number, file: File, onProgress: (pct: number) => void) {
  const { upload_url } = await callJson<{ upload_url: string }>({ action: 'init', salida_id: salidaId, name: file.name, size: file.size, mime: file.type })
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
  await callJson({ action: 'register', salida_id: salidaId, file_id: fileId })
}

export const enviarCorreo = (salidaId: number) => callJson<{ adjuntos: number; enlaces: number }>({ action: 'send', salida_id: salidaId })

async function bajarBlob(archivoId: number): Promise<Blob> {
  const r = await call({ action: 'download', archivo_id: archivoId })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'No se pudo leer el archivo')
  return new Blob([await r.arrayBuffer()], { type: 'application/pdf' })
}

/** Valida extensión y firma %PDF; devuelve el nombre del primer archivo inválido. */
export async function primerNoPdf(files: File[]): Promise<string | null> {
  for (const f of files) {
    const head = new TextDecoder().decode(await f.slice(0, 5).arrayBuffer())
    if (!/\.pdf$/i.test(f.name) || head !== '%PDF-') return f.name
  }
  return null
}

export async function urlVistaPrevia(archivoId: number) {
  return URL.createObjectURL(await bajarBlob(archivoId))
}

export async function descargarArchivo(archivoId: number, nombre: string) {
  const url = URL.createObjectURL(await bajarBlob(archivoId))
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre })
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
