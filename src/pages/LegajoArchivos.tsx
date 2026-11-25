import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, FIELD, Spinner, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'

type Tipo = 'legajo' | 'solicitud'
interface Archivo { id: string; nombre: string; mime: string; bytes: number; creado_en: string }
interface Carga { drive_file_id: string; nombre: string; mime: string; bytes: number }

async function drive(body: Record<string, unknown>) {
  const r = await supabase.functions.invoke('eoe-legajo-drive', { body })
  if (r.error) {
    let mensaje = r.error.message
    if (r.error.context instanceof Response) {
      try {
        const detalle = await r.error.context.json()
        if (typeof detalle.error === 'string') mensaje = detalle.error
      } catch { mensaje = 'No se pudo completar la operación de Drive.' }
    }
    throw new Error(mensaje)
  }
  return r.data
}

export async function sincronizarCarpetaLegajo(id: string, token: string) {
  await drive({ action: 'sync', tipo: 'legajo', referencia: id, token })
}

export function LegajoArchivos({ tipo, referencia, token, editable, permitirNueva = true, onChanged }: {
  tipo: Tipo; referencia: string; token?: string; editable: boolean; permitirNueva?: boolean; onChanged?(): void
}) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [reiniciar, setReiniciar] = useState<Carga | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lista = useAsync(async () => {
    const r = await supabase.rpc('eoe_drive_listar', { p_tipo: tipo, p_referencia: referencia, p_token: token ?? null })
    if (r.error) throw r.error
    return r.data as Archivo[]
  }, [tipo, referencia, token])
  const pendientes = useAsync(async () => {
    if (!editable) return [] as Carga[]
    const r = await supabase.rpc('eoe_drive_pendientes', { p_tipo: tipo, p_referencia: referencia, p_token: token ?? null })
    if (r.error) throw r.error
    return r.data as Carga[]
  }, [tipo, referencia, token, editable])

  const subir = async (e: Event) => {
    e.preventDefault()
    if (!archivo) return setError('Elegí un archivo.')
    setError(''); setBusy(true)
    try {
      const inicio = await drive({ action: 'init', tipo, referencia, token, nombre: archivo.name, mime: archivo.type || 'application/octet-stream', bytes: archivo.size, ...(reiniciar ? { file_id: reiniciar.drive_file_id } : {}) })
      if (typeof inicio?.upload_url !== 'string' || typeof inicio.file_id !== 'string') throw new Error('No se pudo preparar la carga.')
      const url = new URL(inicio.upload_url)
      if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || url.pathname !== '/upload/drive/v3/files') throw new Error('La dirección de carga no es válida.')
      let subida: Response
      try { subida = await fetch(url, { method: 'PUT', headers: { 'Content-Type': archivo.type || 'application/octet-stream' }, body: archivo }) }
      catch { throw new Error('No se pudo confirmar la carga en Drive. Podés recuperarla desde las cargas pendientes.') }
      if (!subida.ok) throw new Error('No se pudo confirmar la carga en Drive. Podés recuperarla desde las cargas pendientes.')
      let respuesta: { id?: unknown }
      try { respuesta = await subida.json() }
      catch { throw new Error('Drive no confirmó el archivo. Podés recuperarlo desde las cargas pendientes.') }
      if (respuesta.id !== inicio.file_id) throw new Error('Drive no confirmó el archivo. Podés recuperarlo desde las cargas pendientes.')
      await drive({ action: 'register', tipo, referencia, token, file_id: respuesta.id })
      setReiniciar(null); setArchivo(null); lista.reload(); onChanged?.(); toast.ok('Archivo agregado')
      if (e.target instanceof HTMLFormElement) e.target.reset()
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo agregar el archivo.') }
    finally { setBusy(false); pendientes.reload() }
  }
  const recuperar = async (carga: Carga) => {
    setError(''); setBusy(true)
    try {
      await drive({ action: 'register', tipo, referencia, token, file_id: carga.drive_file_id })
      setReiniciar(null); setArchivo(null); lista.reload(); pendientes.reload(); onChanged?.(); toast.ok('Archivo recuperado')
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar el archivo.') }
    finally { setBusy(false) }
  }
  const descargar = async (a: Archivo) => {
    setError(''); setBusy(true)
    try {
      const blob = await drive({ action: 'download', tipo, id: a.id, token })
      if (!(blob instanceof Blob)) throw new Error('No se pudo leer el archivo.')
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url; enlace.download = a.nombre; enlace.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo descargar el archivo.') }
    finally { setBusy(false) }
  }
  const sincronizar = async () => {
    if (!token) return
    setError(''); setBusy(true)
    try { await sincronizarCarpetaLegajo(referencia, token); toast.ok('Carpeta sincronizada') }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo sincronizar la carpeta.') }
    finally { setBusy(false) }
  }
  return <div class="space-y-3">
    {(error || lista.error || pendientes.error) && <Alert tone="error">{error || lista.error || pendientes.error}</Alert>}
    {!!pendientes.data?.length && <div class="space-y-2">
      <Alert tone="warning">Hay cargas pendientes. Si terminaron, recuperalas; si se interrumpieron, reinicialas con el mismo archivo.</Alert>
      {pendientes.data.map((p) => <div key={p.drive_file_id} class="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 p-2">
        <span class="min-w-0 flex-1 break-all text-sm">{p.nombre}</span>
        <button type="button" class={BTN_SECONDARY} disabled={busy} onClick={() => recuperar(p)}><Icon name="check" class="size-4" />Recuperar</button>
        <button type="button" class={BTN_SECONDARY} disabled={busy} onClick={() => { setArchivo(null); setReiniciar(p); setError('') }}><Icon name="attachment" class="size-4" />Reiniciar</button>
      </div>)}
    </div>}
    {lista.loading && !lista.data ? <Spinner /> : !lista.error && <>
      {!lista.data?.length ? <p class="text-sm text-slate-500">Sin archivos adjuntos.</p> : <ul class="divide-y divide-slate-100">{lista.data.map((a) => <li key={a.id} class="flex flex-wrap items-center justify-between gap-2 py-2">
        <div class="min-w-0"><p class="break-all text-sm font-medium">{a.nombre}</p><p class="text-xs text-slate-500">{(a.bytes / 1024 / 1024).toFixed(2)} MB</p></div>
        <button type="button" class={BTN_SECONDARY} disabled={busy} onClick={() => descargar(a)}><Icon name="download" class="size-4" />Descargar</button>
      </li>)}</ul>}
    </>}
    {editable && (permitirNueva || reiniciar) && <form class="space-y-2" onSubmit={subir}>
      <label class="block text-sm font-medium text-slate-700">{reiniciar ? `Seleccioná nuevamente: ${reiniciar.nombre}` : 'Agregar archivo'}<input class={`${FIELD} py-2`} type="file" required onChange={(e) => setArchivo(e.currentTarget.files?.[0] ?? null)} /></label>
      <button class={BTN_PRIMARY} disabled={busy || !archivo}><Icon name="attachment" class="size-4" />{busy ? 'Procesando…' : reiniciar ? 'Reiniciar carga' : 'Subir archivo'}</button>
      {reiniciar && <button type="button" class={`${BTN_SECONDARY} ml-2`} disabled={busy} onClick={() => { setReiniciar(null); setArchivo(null) }}><Icon name="x" class="size-4" />Cancelar</button>}
    </form>}
    {tipo === 'legajo' && token && <button type="button" class={BTN_SECONDARY} disabled={busy} onClick={sincronizar}><Icon name="folder-star" class="size-4" />Sincronizar carpeta</button>}
  </div>
}
