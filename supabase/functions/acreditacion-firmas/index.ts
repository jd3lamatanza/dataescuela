import { createClient } from 'npm:@supabase/supabase-js@2'
import { borrarFirma, comprobarCarpeta, descargarFirma, subirFirma, tokenDrive, validarImagen } from '../_shared/firmas-drive.ts'
import { comprobarFirmas, validarFirmas } from '../_shared/firmas-seleccion.ts'

const origin = Deno.env.get('APP_PUBLIC_URL') ? new URL(Deno.env.get('APP_PUBLIC_URL')!).origin : ''
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !key || !origin) throw new HttpError(503, 'El servicio de firmas no está configurado.')
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Sesión requerida.')
    const user = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const who = await user.auth.getUser()
    if (who.error || !who.data.user) throw new HttpError(401, 'Sesión inválida.')
    const [role, real] = await Promise.all([user.rpc('app_role'), user.rpc('real_role')])
    if (role.error || real.error) throw new HttpError(503, 'No se pudo verificar el acceso.')
    if (role.data !== 'distrital' || real.data !== 'distrital') throw new HttpError(403, 'Sin permiso.')
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    const body = await req.json()
    if (body?.action === 'guardar_evento' || body?.action === 'configurar_evento') {
      let firmas = null
      if (body.action === 'configurar_evento' || body.evento?.id == null) {
        let ids: number[]
        try { ids = validarFirmas(body.firmas) }
        catch (e) { throw new HttpError(400, e instanceof Error ? e.message : 'Firmas inválidas.') }
        const result = await admin.rpc('acreditacion_firmas_datos', { p_ids: ids })
        if (result.error) throw new Error('No se pudieron consultar las firmas.')
        comprobarFirmas(ids, result.data)
        const token = result.data.some((f: { drive_file_id: string | null }) => f.drive_file_id) ? await tokenDrive() : null
        firmas = await Promise.all(result.data.map(async (f: { nombre: string; mime: string; base64: string | null; drive_file_id: string | null }) => {
          const base64 = f.drive_file_id && token ? await descargarFirma(token, f.drive_file_id, f.mime) : f.base64
          validarImagen(f.mime, base64)
          return { nombre: f.nombre, mime: f.mime, base64: base64!.replace(/\s/g, '') }
        }))
      }
      if (body.action === 'configurar_evento') {
        const result = await admin.rpc('acreditacion_configurar_firmas', { p_evento: body.id, p_firmas: firmas, p_usuario: who.data.user.id })
        if (result.error) throw new HttpError(400, result.error.message)
      } else {
        const e = body.evento
        if (!e || typeof e !== 'object') throw new HttpError(400, 'Evento inválido.')
        const result = await admin.rpc('acreditacion_guardar_evento_firmado', {
          p_id: e.id ?? null, p_nombre: e.nombre, p_lugar: e.lugar, p_fecha: e.fecha,
          p_inicio: e.hora_inicio, p_fin: e.hora_fin, p_descripcion: e.descripcion, p_firmas: firmas, p_usuario: who.data.user.id,
        })
        if (result.error) throw new HttpError(400, result.error.message)
      }
      return json({ ok: true })
    }
    if (body?.action === 'verificar') {
      await comprobarCarpeta(await tokenDrive())
      return json({ ok: true })
    }
    if (body?.action === 'listar') {
      const { data: firmas, error } = await admin.rpc('acreditacion_firmas_datos', { p_ids: null })
      if (error) throw new Error('No se pudieron consultar las firmas.')
      const antiguas = firmas.filter((f: { drive_file_id: string | null }) => !f.drive_file_id)
      if (antiguas.length) {
        const token = await tokenDrive()
        for (const firma of antiguas) {
          const bytes = validarImagen(firma.mime, firma.base64.replace(/\s/g, ''))
          const driveId = await subirFirma(token, firma.nombre, firma.mime, bytes)
          const update = await admin.from('acreditacion_firmas').update({ drive_file_id: driveId, contenido: null }).eq('id', firma.id).is('drive_file_id', null).select('id')
          if (update.error || !update.data.length) {
            try { await borrarFirma(token, driveId) } catch (e) {
              console.error('No se pudo limpiar una firma duplicada en Drive:', e)
              throw new Error('No se pudo completar el traslado ni limpiar una copia en Drive. Revisá la carpeta antes de reintentar.')
            }
            if (update.error) throw new Error('No se pudo completar el traslado de una firma. Volvé a intentarlo.')
          }
        }
      }
      const result = await admin.from('acreditacion_firmas').select('id,nombre,mime').order('id')
      if (result.error) throw new Error('No se pudieron consultar las firmas.')
      return json({ firmas: result.data })
    }
    if (body?.action === 'cargar') {
      const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : ''
      if (!nombre || nombre.length > 150 || /[\x00-\x1f\x7f]/.test(nombre)) throw new HttpError(400, 'Ingresá un nombre válido de hasta 150 caracteres.')
      const bytes = validarImagen(body.mime, body.base64)
      const token = await tokenDrive()
      const id = await subirFirma(token, nombre, body.mime, bytes)
      const result = await admin.from('acreditacion_firmas').insert({ nombre, mime: body.mime, drive_file_id: id })
      if (result.error) {
        try { await borrarFirma(token, id) } catch (e) {
          console.error('No se pudo limpiar la firma no registrada:', e)
          throw new Error('No se pudo registrar la firma ni limpiar el archivo en Drive. Revisá la carpeta antes de reintentar.')
        }
        throw new Error('No se pudo registrar la firma. Volvé a intentarlo.')
      }
      return json({ ok: true })
    }
    if (body?.action === 'eliminar') {
      if (!Number.isSafeInteger(body.id) || body.id <= 0) throw new HttpError(400, 'Firma inválida.')
      const result = await admin.from('acreditacion_firmas').select('id,drive_file_id').eq('id', body.id).maybeSingle()
      if (result.error) throw new Error('No se pudo consultar la firma.')
      if (!result.data) throw new HttpError(404, 'Firma inexistente.')
      if (result.data.drive_file_id) await borrarFirma(await tokenDrive(), result.data.drive_file_id)
      const deleted = await admin.from('acreditacion_firmas').delete().eq('id', body.id)
      if (deleted.error) throw new Error('No se pudo actualizar la biblioteca. Volvé a intentar la eliminación.')
      return json({ ok: true })
    }
    throw new HttpError(400, 'Solicitud inválida.')
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error('Biblioteca de firmas:', error instanceof Error ? error.message : String(error))
    return json({ error: error instanceof Error ? error.message : 'No se pudo procesar la firma.' }, 503)
  }
})
