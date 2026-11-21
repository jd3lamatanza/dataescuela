import { createClient } from 'npm:@supabase/supabase-js@2'
import { borrarFirma, tokenDrive, validarImagen } from '../_shared/firmas-drive.ts'

const carpeta = '1HChSKnfT-wXedYF98-t08i5vFwCdx5m3'
const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'private, no-store', Vary: 'Origin' }
const respuesta = (body: object, status = 200) => Response.json(body, { status, headers: cors })
class Conflicto extends Error {}

async function subirCaptura(token: string, bytes: Uint8Array, mime = 'image/png'): Promise<string> {
  const boundary = `ayuda_${crypto.randomUUID().replaceAll('-', '')}`
  const inicio = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: `ayuda-${crypto.randomUUID()}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`, parents: [carpeta] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`)
  const fin = new TextEncoder().encode(`\r\n--${boundary}--`)
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: new Blob([inicio, Uint8Array.from(bytes), fin]),
  })
  if (!r.ok) throw new Error('No se pudo subir la captura a Drive.')
  const data = await r.json()
  if (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(data.id)) throw new Error('Drive no devolvió un identificador válido.')
  return data.id
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return respuesta({ error: 'Método no permitido.' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !anon || !origin) return respuesta({ error: 'El servicio de ayuda no está configurado.' }, 503)
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return respuesta({ error: 'Sesión requerida.' }, 401)
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const who = await user.auth.getUser()
    if (who.error || !who.data.user) return respuesta({ error: 'Sesión inválida.' }, 401)
    const permiso = await user.rpc('tiene_permiso_avanzado')
    if (permiso.error) return respuesta({ error: 'No se pudo verificar el permiso.' }, 503)
    if (permiso.data !== true) return respuesta({ error: 'Sin permiso.' }, 403)
    let body: { accion?: unknown; guia?: Record<string, unknown>; imagen?: { mime?: unknown; base64?: unknown }; quitar_captura?: unknown; imagenes_pasos?: unknown }
    try { body = await req.json() } catch { return respuesta({ error: 'Solicitud inválida.' }, 400) }
    if (!body || !['guardar', 'eliminar'].includes(String(body.accion)) || !body.guia || typeof body.guia !== 'object') return respuesta({ error: 'Solicitud inválida.' }, 400)
    const g = body.guia
    const id = g.id
    const version = g.version
    if (id !== undefined && (typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id) || !Number.isSafeInteger(version) || Number(version) < 1)) return respuesta({ error: 'Guía inválida.' }, 400)
    if (body.accion === 'eliminar') {
      if (typeof id !== 'string') return respuesta({ error: 'Guía inválida.' }, 400)
      const { data, error } = await user.from('ayuda_guias').delete().eq('id', id).eq('version', version).select('id').maybeSingle()
      if (error) throw new Error('No se pudo eliminar la guía.')
      if (!data) return respuesta({ error: 'La guía cambió o ya no existe. Actualizá la lista.' }, 409)
      return respuesta({ ok: true })
    }
    if (typeof g.modulo !== 'string' || !/^[a-z0-9-]{1,80}$/.test(g.modulo)
      || typeof g.titulo !== 'string' || !g.titulo.trim() || g.titulo.trim().length > 160
      || typeof g.descripcion !== 'string' || !g.descripcion.trim() || g.descripcion.trim().length > 2000
      || !Array.isArray(g.secciones) || g.secciones.length < 1 || g.secciones.length > 30
      || !g.secciones.every((s: unknown) => {
        if (!s || typeof s !== 'object') return false
        const seccion = s as { titulo?: unknown; pasos?: unknown; medios?: unknown }
        return typeof seccion.titulo === 'string' && seccion.titulo.trim().length > 0 && seccion.titulo.trim().length <= 160
          && Array.isArray(seccion.pasos) && seccion.pasos.length > 0 && seccion.pasos.length <= 50
          && seccion.pasos.every((p: unknown) => typeof p === 'string' && p.trim().length > 0 && p.trim().length <= 4000)
          && (seccion.medios === undefined || (Array.isArray(seccion.medios) && seccion.medios.length === seccion.pasos.length
            && seccion.medios.every((m: unknown) => {
              if (m === null) return true
              if (!m || typeof m !== 'object' || Array.isArray(m)) return false
              const medio = m as { youtube?: unknown; imagen_drive?: unknown }
              return (medio.youtube == null || (typeof medio.youtube === 'string' && /^[A-Za-z0-9_-]{11}$/.test(medio.youtube)))
                && (medio.imagen_drive == null || (typeof medio.imagen_drive === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(medio.imagen_drive)))
            })))
      })) return respuesta({ error: 'Completá el título, descripción y al menos una sección con sus pasos.' }, 400)
    type Seccion = { titulo: string; pasos: string[]; medios?: ({ youtube?: string | null; imagen_drive?: string | null } | null)[] }
    const secciones = (g.secciones as Seccion[]).map((s) => ({
      titulo: s.titulo, pasos: s.pasos, medios: s.pasos.map((_, i) => ({
        youtube: s.medios?.[i]?.youtube ?? null, imagen_drive: s.medios?.[i]?.imagen_drive ?? null,
      })),
    }))
    let bytes: Uint8Array | undefined
    if (body.quitar_captura !== undefined && typeof body.quitar_captura !== 'boolean') return respuesta({ error: 'Solicitud inválida.' }, 400)
    if (body.quitar_captura && body.imagen) return respuesta({ error: 'Elegí reemplazar o quitar la captura.' }, 400)
    if (body.imagen !== undefined) {
      try { bytes = validarImagen(body.imagen?.mime, body.imagen?.base64) } catch { return respuesta({ error: 'Elegí una imagen PNG de hasta 2 MB.' }, 400) }
      if (body.imagen.mime !== 'image/png') return respuesta({ error: 'Elegí una imagen PNG de hasta 2 MB.' }, 400)
    }
    let anteriores: Seccion[] = []
    if (typeof id === 'string') {
      const anterior = await user.from('ayuda_guias').select('version,secciones').eq('id', id).maybeSingle()
      if (anterior.error) throw new Error('No se pudo consultar la guía.')
      if (!anterior.data || anterior.data.version !== version) return respuesta({ error: 'La guía cambió o ya no existe. Actualizá la lista.' }, 409)
      anteriores = anterior.data.secciones
    }
    const permitidas = new Set(anteriores.flatMap((s) => (s.medios ?? []).map((m) => m?.imagen_drive).filter((v): v is string => !!v)))
    if (secciones.some((s) => s.medios.some((m) => m.imagen_drive && !permitidas.has(m.imagen_drive)))) return respuesta({ error: 'La imagen de un paso no pertenece a esta guía.' }, 400)
    if (body.imagenes_pasos !== undefined && !Array.isArray(body.imagenes_pasos)) return respuesta({ error: 'Imágenes de pasos inválidas.' }, 400)
    const imagenes: { seccion: number; paso: number; mime: string; bytes: Uint8Array }[] = []
    const posiciones = new Set<string>()
    for (const item of body.imagenes_pasos ?? []) {
      if (!item || typeof item !== 'object' || !Number.isInteger(item.seccion) || !Number.isInteger(item.paso)
        || item.seccion < 0 || item.paso < 0 || !secciones[item.seccion]?.medios[item.paso]
        || posiciones.has(`${item.seccion}:${item.paso}`) || !['image/png', 'image/jpeg'].includes(item.mime)) return respuesta({ error: 'Imagen de paso inválida.' }, 400)
      let contenido: Uint8Array
      try { contenido = validarImagen(item.mime, item.base64) } catch { return respuesta({ error: 'Elegí imágenes PNG o JPEG de hasta 2 MB.' }, 400) }
      posiciones.add(`${item.seccion}:${item.paso}`)
      imagenes.push({ seccion: item.seccion, paso: item.paso, mime: item.mime, bytes: contenido })
    }
    if (imagenes.reduce((total, item) => total + item.bytes.length, bytes?.length ?? 0) > 6 * 1024 * 1024) return respuesta({ error: 'Las imágenes seleccionadas suman más de 6 MB.' }, 400)
    const token = bytes || imagenes.length ? await tokenDrive() : ''
    const subidas: string[] = []
    let escrituraIniciada = false
    try {
      const captura = bytes ? await subirCaptura(token, bytes) : undefined
      if (captura) subidas.push(captura)
      for (const img of imagenes) {
        const archivo = await subirCaptura(token, img.bytes, img.mime)
        subidas.push(archivo)
        secciones[img.seccion].medios[img.paso].imagen_drive = archivo
      }
      const datos = {
        modulo: g.modulo, titulo: g.titulo.trim(), descripcion: g.descripcion.trim(), secciones,
        ...(captura ? { captura_drive: captura } : body.quitar_captura ? { captura_drive: null } : {}), actualizado: new Date().toISOString(),
      }
      escrituraIniciada = true
      const result = typeof id === 'string'
        ? await user.from('ayuda_guias').update({ ...datos, version: Number(version) + 1 }).eq('id', id).eq('version', version).select().maybeSingle()
        : await user.from('ayuda_guias').insert(datos).select().single()
      if (result.error) throw new Error('No se pudo guardar la guía.')
      if (!result.data) throw new Conflicto('La guía cambió o ya no existe. Actualizá la lista.')
      return respuesta({ guia: result.data })
    } catch (error) {
      if (subidas.length && (!escrituraIniciada || error instanceof Conflicto)) {
        const limpieza = await Promise.allSettled(subidas.map((archivo) => borrarFirma(token, archivo)))
        if (limpieza.some((resultado) => resultado.status === 'rejected')) {
          console.error('No se pudieron limpiar imágenes nuevas:', limpieza.filter((resultado) => resultado.status === 'rejected'))
          throw new Error('No se guardó la guía y no se pudieron limpiar todas las imágenes subidas en Drive.')
        }
      }
      if (error instanceof Conflicto) return respuesta({ error: error.message }, 409)
      if (subidas.length && escrituraIniciada) throw new Error('No se pudo confirmar si se guardó la guía. Revisá la guía y las imágenes en Drive antes de reintentar.')
      throw error
    }
  } catch (error) {
    console.error('Gestión de ayuda:', error instanceof Error ? error.message : String(error))
    return respuesta({ error: error instanceof Error ? error.message : 'No se pudo gestionar la guía.' }, 503)
  }
})
