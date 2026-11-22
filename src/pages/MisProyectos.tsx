import { useState } from 'preact/hooks'
import { esPdf, MAX_PROYECTO, TIPOS_PROYECTO } from '../../supabase/functions/_shared/proyectos'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, confirmar, toast } from '../ui/kit'

type Proyecto = { id: string; tipo: string; otro_tipo: string | null; nombre: string; bytes: number; created_at: string }
const TAMANO = 15
const fecha = (s: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(s))

async function llamar(body: FormData | Record<string, unknown>): Promise<Response> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  if (!data.session?.access_token) throw new Error('Tu sesión venció. Volvé a ingresar.')
  const h: Record<string, string> = { Authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_KEY }
  if (!(body instanceof FormData)) h['Content-Type'] = 'application/json'
  const respuesta = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proyectos-drive`, {
    method: 'POST', headers: h, body: body instanceof FormData ? body : JSON.stringify(body),
  })
  if (!respuesta.ok) {
    let mensaje = `No se pudo completar la operación (${respuesta.status}).`
    try { const detalle = await respuesta.json(); if (typeof detalle.error === 'string') mensaje = detalle.error } catch { /* respuesta sin JSON */ }
    throw new Error(mensaje)
  }
  return respuesta
}

export function MisProyectos() {
  const { user } = useAuth()
  return <Listado key={user?.id} />
}

function Listado() {
  const [pagina, setPagina] = useState(1)
  const [subiendo, setSubiendo] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.from('proyectos_escolares').select('id,tipo,otro_tipo,nombre,bytes,created_at', { count: 'exact' })
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range((pagina - 1) * TAMANO, pagina * TAMANO - 1)
    if (r.error) throw r.error
    if (r.count == null) throw new Error('No se pudo contar los proyectos.')
    return { filas: r.data as Proyecto[], total: r.count, pagina }
  }, [pagina])
  const actual = !error && !loading && data?.pagina === pagina ? data : null

  const descargar = async (p: Proyecto) => {
    setOcupado(p.id)
    try {
      const r = await llamar({ action: 'download', id: p.id })
      const url = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'application/pdf' }))
      const a = Object.assign(document.createElement('a'), { href: url, download: p.nombre })
      document.body.append(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setOcupado(null) }
  }
  const eliminar = async (p: Proyecto) => {
    if (!(await confirmar('Eliminar proyecto', { text: `Se eliminará «${p.nombre}» de Google Drive. Esta acción no se puede deshacer.`, ok: 'Eliminar', danger: true }))) return
    setOcupado(p.id)
    try {
      await llamar({ action: 'remove', id: p.id })
      toast.ok('Proyecto eliminado')
      if (pagina > 1 && actual?.filas.length === 1) setPagina(pagina - 1)
      else reload()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setOcupado(null) }
  }

  return <>
    <PageHeader title="Mis Proyectos" subtitle="Proyectos de tu escuela."
      actions={<button type="button" class={BTN_PRIMARY} disabled={!actual} onClick={() => setSubiendo(true)}>Subir proyecto</button>} />
    <Alert>Subí solamente los proyectos que se aplican al nivel y la modalidad de tu escuela. Se aceptan archivos PDF de hasta 5 MB; podés subir más de uno por tipo.</Alert>
    <div class="mt-4">
      {error && <Alert tone="error">{error}</Alert>}
      {loading && <Spinner />}
      {actual && <>
        {!actual.filas.length ? <Card><EmptyState title="Sin proyectos" text="Elegí «Subir proyecto» para cargar un archivo." /></Card> :
          <div class="space-y-3">{actual.filas.map((p) => <Card key={p.id}>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-slate-900">{p.tipo === 'Otro' ? p.otro_tipo : p.tipo}</p>
                <p class="mt-1 break-all text-sm text-slate-700">{p.nombre}</p>
                <p class="mt-1 text-xs text-slate-500">{(p.bytes / 1024 / 1024).toFixed(2)} MB · {fecha(p.created_at)}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" class={BTN_SECONDARY} disabled={!!ocupado} onClick={() => void descargar(p)}>Descargar</button>
                <button type="button" class={BTN_SECONDARY} disabled={!!ocupado} onClick={() => void eliminar(p)}>Eliminar</button>
              </div>
            </div>
          </Card>)}</div>}
        <Pager page={pagina} total={actual.total} size={TAMANO} onPage={setPagina} />
      </>}
    </div>
    {subiendo && <Formulario onClose={() => setSubiendo(false)} onDone={() => { setSubiendo(false); if (pagina !== 1) setPagina(1); else reload() }} />}
  </>
}

function Formulario({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [tipo, setTipo] = useState('')
  const [otro, setOtro] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guardar = async (e: Event) => {
    e.preventDefault()
    if (!tipo) return setError('Seleccioná un tipo de proyecto.')
    if (tipo === 'Otro' && !otro.trim()) return setError('Indicá el tipo de proyecto.')
    if (!archivo || !/\.pdf$/i.test(archivo.name) || archivo.size < 1 || archivo.size > MAX_PROYECTO) return setError('Elegí un PDF de hasta 5 MB.')
    setError(null); setGuardando(true)
    try {
      if (!esPdf(new Uint8Array(await archivo.slice(0, 5).arrayBuffer()))) throw new Error('El archivo no es un PDF válido.')
      const form = new FormData()
      form.append('action', 'upload'); form.append('tipo', tipo); form.append('otro_tipo', otro.trim()); form.append('archivo', archivo)
      await llamar(form)
      toast.ok('Proyecto subido')
      onDone()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setGuardando(false) }
  }
  return <Modal title="Subir proyecto" onClose={() => { if (!guardando) onClose() }}>
    <form class="space-y-4" onSubmit={guardar}>
      {error && <Alert tone="error">{error}</Alert>}
      <Lbl label="Tipo de proyecto"><select class={FIELD} required value={tipo} disabled={guardando} onChange={(e) => setTipo(e.currentTarget.value)}>
        <option value="">Seleccioná un tipo</option>
        {TIPOS_PROYECTO.map((t) => <option key={t} value={t}>{t}</option>)}
      </select></Lbl>
      {tipo === 'Otro' && <Lbl label="Indicá el tipo de proyecto"><input class={FIELD} required maxLength={150} value={otro} disabled={guardando} onInput={(e) => setOtro(e.currentTarget.value)} /></Lbl>}
      <Lbl label="Archivo PDF (máximo 5 MB)"><input class={`${FIELD} py-2`} type="file" accept=".pdf,application/pdf" required disabled={guardando}
        onChange={(e) => setArchivo(e.currentTarget.files?.[0] ?? null)} /></Lbl>
      <div class="flex justify-end gap-2">
        <button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={onClose}>Cancelar</button>
        <button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Subiendo…' : 'Subir'}</button>
      </div>
    </form>
  </Modal>
}
