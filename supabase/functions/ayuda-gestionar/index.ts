import { createClient } from 'npm:@supabase/supabase-js@2'
import { borrarFirma, tokenDrive, validarImagen } from '../_shared/firmas-drive.ts'

const carpeta = '1HChSKnfT-wXedYF98-t08i5vFwCdx5m3'
const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'private, no-store', Vary: 'Origin' }
const respuesta = (body: object, status = 200) => Response.json(body, { status, headers: cors })
class Conflicto extends Error {}

async function subirCaptura(token: string, bytes: Uint8Array): Promise<string> {
  const boundary = `ayuda_${crypto.randomUUID().replaceAll('-', '')}`
  const inicio = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: `ayuda-${crypto.randomUUID()}.png`, parents: [carpeta] })}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`)
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
    let body: { accion?: unknown; guia?: Record<string, unknown>; imagen?: { mime?: unknown; base64?: unknown }; quitar_captura?: unknown }
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
        const seccion = s as { titulo?: unknown; pasos?: unknown }
        return typeof seccion.titulo === 'string' && seccion.titulo.trim().length > 0 && seccion.titulo.trim().length <= 160
          && Array.isArray(seccion.pasos) && seccion.pasos.length > 0 && seccion.pasos.length <= 50
          && seccion.pasos.every((p: unknown) => typeof p === 'string' && p.trim().length > 0 && p.trim().length <= 4000)
      })) return respuesta({ error: 'Completá el título, descripción y al menos una sección con sus pasos.' }, 400)
    let bytes: Uint8Array | undefined
    if (body.quitar_captura !== undefined && typeof body.quitar_captura !== 'boolean') return respuesta({ error: 'Solicitud inválida.' }, 400)
    if (body.quitar_captura && body.imagen) return respuesta({ error: 'Elegí reemplazar o quitar la captura.' }, 400)
    if (body.imagen !== undefined) {
      try { bytes = validarImagen(body.imagen?.mime, body.imagen?.base64) } catch { return respuesta({ error: 'Elegí una imagen PNG de hasta 2 MB.' }, 400) }
      if (body.imagen.mime !== 'image/png') return respuesta({ error: 'Elegí una imagen PNG de hasta 2 MB.' }, 400)
    }
    if (typeof id === 'string') {
      const anterior = await user.from('ayuda_guias').select('version').eq('id', id).maybeSingle()
      if (anterior.error) throw new Error('No se pudo consultar la guía.')
      if (!anterior.data || anterior.data.version !== version) return respuesta({ error: 'La guía cambió o ya no existe. Actualizá la lista.' }, 409)
    }
    const token = bytes ? await tokenDrive() : ''
    const captura = bytes ? await subirCaptura(token, bytes) : undefined
    try {
      const datos = {
        modulo: g.modulo, titulo: g.titulo.trim(), descripcion: g.descripcion.trim(), secciones: g.secciones,
        ...(captura ? { captura_drive: captura } : body.quitar_captura ? { captura_drive: null } : {}), actualizado: new Date().toISOString(),
      }
      const result = typeof id === 'string'
        ? await user.from('ayuda_guias').update({ ...datos, version: Number(version) + 1 }).eq('id', id).eq('version', version).select().maybeSingle()
        : await user.from('ayuda_guias').insert(datos).select().single()
      if (result.error) throw new Error('No se pudo guardar la guía.')
      if (!result.data) throw new Conflicto('La guía cambió o ya no existe. Actualizá la lista.')
      return respuesta({ guia: result.data })
    } catch (error) {
      if (captura && error instanceof Conflicto) {
        try { await borrarFirma(token, captura) }
        catch (limpieza) { console.error('No se pudo limpiar la captura nueva:', limpieza); throw new Error('No se guardó la guía y no se pudo limpiar la captura subida en Drive.') }
      }
      if (error instanceof Conflicto) return respuesta({ error: error.message }, 409)
      if (captura) throw new Error('No se pudo confirmar si se guardó la guía. Revisá la guía y la captura en Drive antes de reintentar.')
      throw error
    }
  } catch (error) {
    console.error('Gestión de ayuda:', error instanceof Error ? error.message : String(error))
    return respuesta({ error: error instanceof Error ? error.message : 'No se pudo gestionar la guía.' }, 503)
  }
})
