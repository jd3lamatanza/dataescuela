import { useState } from 'preact/hooks'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { TIPOS, SUSPENSIONES, type Suspension } from '../lib/contingencias'
import { ContingenciasSupervision } from './ContingenciasSupervision'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, Toggle, toast } from '../ui/kit'

type Turno = { id: number; nombre: string; activo: boolean }
type Contingencia = {
  id: number
  tipos: string[]
  suspension: Suspension
  observaciones: string
  fecha: string
  fecha_estimada: boolean
  created_at: string
  contingencia_turnos: { turno_id: number }[]
}
const TAMANO = 15
const fecha = (s: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s))

export function Contingencias() {
  const { user } = useAuth()
  return user?.role === 'escolar' ? <Listado key={user.id} /> : <ContingenciasSupervision key={user?.id} />
}

function Listado() {
  const [pagina, setPagina] = useState(1)
  const [editando, setEditando] = useState<Contingencia | 'nueva' | null>(null)
  const { data, error, loading, reload } = useAsync(async () => {
    const [c, t] = await Promise.all([
      supabase.from('contingencias').select('id,tipos,suspension,observaciones,fecha,fecha_estimada,created_at,contingencia_turnos(turno_id)', { count: 'exact' })
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range((pagina - 1) * TAMANO, pagina * TAMANO - 1),
      supabase.from('turnos').select('id,nombre,activo').order('hora_desde').order('nombre'),
    ])
    if (c.error) throw c.error
    if (t.error) throw t.error
    if (c.count == null) throw new Error('No se pudo contar las contingencias')
    return { filas: c.data as Contingencia[], turnos: t.data as Turno[], total: c.count, pagina }
  }, [pagina])
  const actual = !loading && !error && data?.pagina === pagina ? data : null
  const nombreTurno = (id: number) => actual?.turnos.find((t) => t.id === id)?.nombre ?? `Turno ${id}`

  return <>
    <PageHeader title="Contingencias" subtitle="Registrá y actualizá las contingencias de tu escuela."
      actions={<button type="button" class={BTN_PRIMARY} disabled={!actual} onClick={() => setEditando('nueva')}>Nueva contingencia</button>} />
    {error && <Alert tone="error">{error}</Alert>}
    {loading && <Spinner />}
    {actual && <>
      {!actual.filas.length ? <Card><EmptyState title="Sin contingencias" text="Cargá la primera con «Nueva contingencia»." /></Card> :
        <div class="space-y-3">{actual.filas.map((c) => <Card key={c.id}>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-slate-900">{c.tipos.join(' · ')}</p>
              <p class="mt-1 text-sm text-slate-600">Fecha de contingencia: {c.fecha.split('-').reverse().join('/')}{c.fecha_estimada ? ' (fecha de carga; revisá la fecha)' : ''}</p>
              <p class="mt-1 text-sm text-slate-600">{SUSPENSIONES[c.suspension]}</p>
              <p class="mt-1 text-sm text-slate-600">Turnos: {c.contingencia_turnos.map((t) => nombreTurno(t.turno_id)).join(', ')}</p>
              {c.observaciones && <p class="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{c.observaciones}</p>}
              <p class="mt-2 text-xs text-slate-500">Registrada: {fecha(c.created_at)}</p>
            </div>
            <button type="button" class={BTN_SECONDARY} onClick={() => setEditando(c)}>Editar</button>
          </div>
        </Card>)}</div>}
      <Pager page={pagina} total={actual.total} size={TAMANO} onPage={setPagina} />
    </>}
    {editando && actual && <Formulario contingencia={editando === 'nueva' ? null : editando} turnos={actual.turnos}
      onClose={() => setEditando(null)} onDone={() => { setEditando(null); if (pagina !== 1 && editando === 'nueva') setPagina(1); else reload() }} />}
  </>
}

function Formulario({ contingencia, turnos, onClose, onDone }: {
  contingencia: Contingencia | null; turnos: Turno[]; onClose(): void; onDone(): void
}) {
  const [tipos, setTipos] = useState<string[]>(contingencia?.tipos ?? [])
  const [fechaContingencia, setFechaContingencia] = useState(contingencia?.fecha ?? '')
  const [suspension, setSuspension] = useState<string>(contingencia?.suspension ?? '')
  const anteriores = contingencia?.contingencia_turnos.map((t) => t.turno_id) ?? []
  const [seleccionados, setSeleccionados] = useState<number[]>(anteriores)
  const [observaciones, setObservaciones] = useState(contingencia?.observaciones ?? '')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const guardar = async (e: Event) => {
    e.preventDefault()
    if (!tipos.length) return setError('Seleccioná al menos un tipo de contingencia.')
    if (!fechaContingencia) return setError('Seleccioná la fecha de contingencia.')
    if (!suspension) return setError('Seleccioná una opción de suspensión.')
    if (!seleccionados.length) return setError('Seleccioná al menos un turno afectado.')
    setError(null)
    setGuardando(true)
    try {
      const { error: err } = await supabase.rpc('contingencia_guardar', {
        p_id: contingencia?.id ?? null, p_tipos: tipos, p_suspension: suspension,
        p_turnos: seleccionados, p_observaciones: observaciones, p_fecha: fechaContingencia,
      })
      if (err) throw new Error(err.message)
      toast.ok(contingencia ? 'Contingencia actualizada' : 'Contingencia registrada')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : `No se pudo guardar: ${String(e)}`)
    } finally {
      setGuardando(false)
    }
  }

  return <Modal title={contingencia ? 'Editar contingencia' : 'Nueva contingencia'} onClose={() => { if (!guardando) onClose() }}>
    <form class="space-y-4" onSubmit={guardar}>
      {error && <Alert tone="error">{error}</Alert>}
      {contingencia?.fecha_estimada && <Alert tone="warning">La fecha indicada corresponde a la carga anterior. Revisala y confirmá la fecha de la contingencia.</Alert>}
      <Lbl label="Fecha de contingencia"><input type="date" class={FIELD} value={fechaContingencia} required disabled={guardando} onInput={(e) => setFechaContingencia(e.currentTarget.value)} /></Lbl>
      <fieldset disabled={guardando}>
        <legend class="mb-2 text-sm font-medium text-slate-700">Tipos de contingencia</legend>
        <div class="grid gap-3 sm:grid-cols-2">{TIPOS.map((tipo) =>
          <Toggle key={tipo} label={tipo} checked={tipos.includes(tipo)}
            onChange={(v) => { setError(null); setTipos(v ? [...tipos, tipo] : tipos.filter((t) => t !== tipo)) }} />)}</div>
      </fieldset>
      <Lbl label="Suspensión de actividad"><select class={FIELD} value={suspension} disabled={guardando} required onChange={(e) => { setError(null); setSuspension(e.currentTarget.value) }}>
        <option value="">Seleccioná una opción</option>
        {Object.entries(SUSPENSIONES).map(([v, nombre]) => <option key={v} value={v}>{nombre}</option>)}
      </select></Lbl>
      <fieldset disabled={guardando}>
        <legend class="mb-2 text-sm font-medium text-slate-700">Turnos afectados</legend>
        <div class="grid gap-2 sm:grid-cols-2">{turnos.filter((t) => t.activo || anteriores.includes(t.id)).map((t) =>
          <label key={t.id} class="flex min-h-11 items-center gap-3 rounded-md border border-slate-300 px-3 text-sm">
            <input type="checkbox" class="size-5" checked={seleccionados.includes(t.id)}
              onChange={(e) => { setError(null); setSeleccionados(e.currentTarget.checked ? [...seleccionados, t.id] : seleccionados.filter((id) => id !== t.id)) }} />
            {t.nombre}{!t.activo && ' (inactivo)'}
          </label>)}</div>
        {!turnos.some((t) => t.activo || anteriores.includes(t.id)) && <p class="text-sm text-red-700">No hay turnos disponibles. Consultá con la Jefatura.</p>}
      </fieldset>
      <Lbl label="Observaciones"><textarea class={`${FIELD} min-h-24 py-2`} value={observaciones} disabled={guardando} onInput={(e) => setObservaciones(e.currentTarget.value)} /></Lbl>
      <div class="flex justify-end gap-2">
        <button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={onClose}>Cancelar</button>
        <button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  </Modal>
}
