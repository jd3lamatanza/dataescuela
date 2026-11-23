import { useEffect, useState } from 'preact/hooks'
import { llamarDrive } from '../lib/drive'
import { useAsync, useDebounced } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { ROLE_LABELS, type Role } from '../modules'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, toast } from '../ui/kit'

type Estado = 'pendiente' | 'en_revision' | 'resuelto'
type Reporte = { id: string; usuario: string; rol: Role; modulo: string; url: string; descripcion: string; estado: Estado; observaciones: string; created_at: string; actualizado_en: string | null }
const ESTADOS: Record<Estado, string> = { pendiente: 'Pendiente', en_revision: 'En revisión', resuelto: 'Resuelto' }
const TAMANO = 15
const mensaje = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)

export function ReportesError() {
  const [pagina, setPagina] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('recientes')
  const [edicion, setEdicion] = useState<Reporte | null>(null)
  const [previa, setPrevia] = useState<{ url: string; modulo: string } | null>(null)
  const [cargando, setCargando] = useState('')
  const buscar = useDebounced(busqueda)
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa.url) }, [previa])
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('reportes_error_listar', { p_busqueda: buscar, p_orden: orden, p_lim: TAMANO, p_offset: (pagina - 1) * TAMANO })
    if (r.error) throw r.error
    if (!r.data || !Array.isArray(r.data.filas) || !Number.isSafeInteger(r.data.total)) throw new Error('Respuesta inválida al consultar reportes.')
    return { filas: r.data.filas as Reporte[], total: r.data.total as number, pagina, buscar, orden }
  }, [pagina, buscar, orden])
  const actual = !error && !loading && buscar === busqueda && data?.pagina === pagina && data.buscar === buscar && data.orden === orden ? data : null
  const grupos: { modulo: string; filas: Reporte[] }[] = []
  for (const fila of actual?.filas ?? []) {
    let grupo = grupos[grupos.length - 1]
    if (!grupo || grupo.modulo !== fila.modulo) { grupo = { modulo: fila.modulo, filas: [] }; grupos.push(grupo) }
    grupo.filas.push(fila)
  }
  const abrirImagen = async (reporte: Reporte) => {
    setCargando(reporte.id)
    try {
      const r = await llamarDrive('reportes-error', { action: 'download', id: reporte.id })
      const mime = r.headers.get('X-Image-Type')
      if (mime !== 'image/png' && mime !== 'image/jpeg') throw new Error('La captura recibida no es válida.')
      const blob = new Blob([await r.arrayBuffer()], { type: mime })
      setPrevia({ url: URL.createObjectURL(blob), modulo: reporte.modulo })
    } catch (e) { toast.error(mensaje(e)) } finally { setCargando('') }
  }
  return <>
    <PageHeader title="Reportes de Error" subtitle="Seguimiento de los errores informados por los usuarios." />
    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      <Lbl label="Buscar por módulo, usuario o descripción"><input type="search" class={FIELD} value={busqueda} onInput={(e) => { setBusqueda(e.currentTarget.value); setPagina(1) }} /></Lbl>
      <Lbl label="Ordenar dentro de cada módulo"><select class={FIELD} value={orden} onChange={(e) => { setOrden(e.currentTarget.value); setPagina(1) }}>
        <option value="recientes">Más recientes</option><option value="antiguos">Más antiguos</option><option value="usuario">Usuario</option><option value="estado">Estado</option>
      </select></Lbl>
    </div>
    {error && <div class="mt-4 space-y-2"><Alert tone="error">{error}</Alert><button type="button" class={BTN_SECONDARY} onClick={reload}>Reintentar</button></div>}
    {!actual && !error && <Spinner />}
    {actual && <div class="mt-4 space-y-4">
      <p class="text-sm text-slate-500">{actual.total} reporte(s). Los grupos pueden continuar en la página siguiente.</p>
      {!actual.filas.length && <Card><EmptyState title="Sin reportes" text="No hay reportes con esa búsqueda." /></Card>}
      {grupos.map((grupo) => <section key={grupo.modulo} class="space-y-3">
        <h2 class="text-lg font-semibold text-slate-900">{grupo.modulo}</h2>
        {grupo.filas.map((r) => <Card key={r.id}><div class="space-y-3">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div><p class="font-semibold text-slate-900">{r.usuario} · {ROLE_LABELS[r.rol] ?? r.rol}</p>
              <p class="text-xs text-slate-500">{new Date(r.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })} · {r.id}</p></div>
            <Badge tone={r.estado === 'resuelto' ? 'green' : r.estado === 'en_revision' ? 'blue' : 'amber'}>{ESTADOS[r.estado]}</Badge>
          </div>
          <p class="whitespace-pre-wrap break-words text-sm text-slate-800">{r.descripcion}</p>
          <p class="break-all text-xs text-slate-600"><strong>URL:</strong> {r.url}</p>
          {r.observaciones && <p class="whitespace-pre-wrap break-words text-sm text-slate-600"><strong>Seguimiento:</strong> {r.observaciones}</p>}
          <div class="flex flex-wrap gap-2">
            <button type="button" class={BTN_SECONDARY} disabled={!!cargando} onClick={() => void abrirImagen(r)}>{cargando === r.id ? 'Cargando…' : 'Ver captura'}</button>
            <button type="button" class={BTN_SECONDARY} onClick={() => setEdicion(r)}>Editar seguimiento</button>
          </div>
        </div></Card>)}
      </section>)}
      <Pager page={pagina} total={actual.total} size={TAMANO} onPage={setPagina} />
    </div>}
    {edicion && <Seguimiento reporte={edicion} onClose={() => setEdicion(null)} onDone={() => { setEdicion(null); reload() }} />}
    {previa && <Modal title={`Captura: ${previa.modulo}`} onClose={() => setPrevia(null)} wide>
      <img src={previa.url} alt="Captura del error reportado" class="max-h-[70vh] max-w-full object-contain" />
    </Modal>}
  </>
}

function Seguimiento({ reporte, onClose, onDone }: { reporte: Reporte; onClose(): void; onDone(): void }) {
  const [estado, setEstado] = useState<Estado>(reporte.estado)
  const [observaciones, setObservaciones] = useState(reporte.observaciones)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const guardar = async (e: Event) => {
    e.preventDefault(); setGuardando(true); setError('')
    try {
      const r = await supabase.rpc('reporte_error_actualizar', { p_id: reporte.id, p_estado: estado, p_observaciones: observaciones })
      if (r.error) throw r.error
      toast.ok('Seguimiento actualizado'); onDone()
    } catch (e) { setError(mensaje(e)) } finally { setGuardando(false) }
  }
  return <Modal title="Editar seguimiento" onClose={() => { if (!guardando) onClose() }}>
    <form class="space-y-4" onSubmit={(e) => void guardar(e)}>
      {error && <Alert tone="error">{error}</Alert>}
      <p class="text-sm text-slate-600">El reporte original no se modifica.</p>
      <Lbl label="Estado"><select class={FIELD} value={estado} disabled={guardando} onChange={(e) => setEstado(e.currentTarget.value as Estado)}>
        {Object.entries(ESTADOS).map(([v, texto]) => <option value={v} key={v}>{texto}</option>)}
      </select></Lbl>
      <Lbl label="Observaciones de seguimiento"><textarea class={`${FIELD} py-2`} rows={5} maxLength={4000} value={observaciones} disabled={guardando}
        onInput={(e) => setObservaciones(e.currentTarget.value)} /></Lbl>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={onClose}>Cancelar</button>
        <button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
  </Modal>
}
