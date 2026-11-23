import { supabase } from './supabase'

const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ayuda-video`

async function llamar(body: object): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('ayuda-video', { body })
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const respuesta = await error.context.json().catch(() => null)
      if (typeof respuesta?.error === 'string') throw new Error(respuesta.error)
    }
    throw new Error('No se pudo gestionar el video: ' + error.message)
  }
  if (!data || typeof data !== 'object') throw new Error('El servidor no devolvió una respuesta válida.')
  return data
}

export async function subirVideo(file: File, progreso: (valor: number) => void): Promise<string> {
  const mime = /\.mp4$/i.test(file.name) ? 'video/mp4' : /\.webm$/i.test(file.name) ? 'video/webm' : ''
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const mp4 = bytes.length >= 8 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
  const webm = bytes.length >= 4 && [0x1a, 0x45, 0xdf, 0xa3].every((v, i) => bytes[i] === v)
  if (!file.size || !mime || (mime === 'video/mp4' ? !mp4 : !webm)) throw new Error('Elegí un archivo de video MP4 o WebM válido.')
  const datos = await llamar({ accion: 'iniciar', nombre: file.name, mime, tamano: file.size })
  if (typeof datos.upload_url !== 'string') throw new Error('Drive no devolvió una dirección de carga.')
  const url = new URL(datos.upload_url)
  if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com') throw new Error('La dirección de carga de Drive no es válida.')
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url.href)
    xhr.setRequestHeader('Content-Type', mime)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) progreso(Math.round(e.loaded / e.total * 100)) }
    xhr.onerror = () => reject(new Error('Se interrumpió la carga del video. Intentá nuevamente.'))
    xhr.onabort = () => reject(new Error('Se canceló la carga del video.'))
    xhr.onload = () => {
      try {
        const resultado = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300 && typeof resultado.id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(resultado.id)) return resolve(resultado.id)
      } catch { /* La respuesta no contiene el identificador de Drive. */ }
      reject(new Error('Drive no confirmó la carga del video. Revisá la carpeta antes de reintentar.'))
    }
    xhr.send(file)
  })
}

export async function urlVideo(guia: string, video: string): Promise<string> {
  const datos = await llamar({ accion: 'reproducir', guia, video })
  if (typeof datos.ticket !== 'string') throw new Error('No se pudo autorizar la reproducción.')
  return `${endpoint}?${new URLSearchParams({ ticket: datos.ticket })}`
}
