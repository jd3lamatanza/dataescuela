export interface MedioPaso {
  imagen_drive?: string | null
  youtube?: string | null
}

export interface GuiaEscolar {
  id: string
  modulo: string
  titulo: string
  descripcion: string
  secciones: { titulo: string; pasos: string[]; medios?: (MedioPaso | null)[] }[]
  captura_drive: string | null
  posicion: number
  version: number
  actualizado: string
}

export function idVideoYoutube(texto: string): string | null {
  try {
    const url = new URL(texto.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.toLowerCase()
    let id: string | null = null
    if (host === 'youtu.be') id = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v')
      else id = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
  } catch { return null }
}

export function buscarGuias(guias: readonly GuiaEscolar[], q: string): GuiaEscolar[] {
  const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR')
  const terminos = normalizar(q.trim()).split(/\s+/).filter(Boolean)
  return guias.filter((guia) => {
    const texto = normalizar([guia.titulo, guia.modulo, guia.descripcion, ...guia.secciones.flatMap((s) => [s.titulo, ...s.pasos])].join(' '))
    return terminos.every((t) => texto.includes(t))
  })
}

export type ImagenPaso = { seccion: number; paso: number; mime: string; base64: string }
export type GestionGuia = { accion: 'guardar'; guia: Partial<GuiaEscolar>; imagen?: { mime: string; base64: string }; quitar_captura?: boolean; imagenes_pasos?: ImagenPaso[] }
  | { accion: 'eliminar'; guia: Pick<GuiaEscolar, 'id' | 'version'> }
