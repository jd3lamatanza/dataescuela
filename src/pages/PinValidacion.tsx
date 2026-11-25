import { useState } from 'preact/hooks'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/hooks'
import { supabase } from '../lib/supabase'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Spinner, confirmar, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'

interface Integrante { id: number; nombre: string; cargo: string | null; tiene_pin: boolean; solicitud_pendiente: boolean }
interface Solicitud { id: number; integrante: string; escuela: string | null; cue: string; creado_en: string }
interface Movimiento { accion: 'alta' | 'edicion' | 'eliminacion'; nombre: string; autor: string | null; fecha: string; cambios: string[] }

export function PinValidacion() {
  const { user } = useAuth()
  return user?.role === 'distrital' ? <Solicitudes /> : <Pines />
}

function Pines() {
  const [edit, setEdit] = useState<Integrante | null>(null)
  const [enviando, setEnviando] = useState<number | null>(null)
  const [historial, setHistorial] = useState(false)
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('eoe_pin_integrantes')
    if (r.error) throw r.error
    return r.data as Integrante[]
  })
  const solicitar = async (item: Integrante) => {
    if (!await confirmar('Solicitar restablecimiento', { text: `Se enviará una solicitud a JD3 para restablecer el PIN de ${item.nombre}.`, ok: 'Solicitar' })) return
    setEnviando(item.id)
    const { error } = await supabase.rpc('eoe_pin_solicitar_restablecimiento', { p_integrante: item.id })
    setEnviando(null)
    if (error) return toast.error(error.message)
    toast.ok('Solicitud enviada a JD3'); reload()
  }
  return <>
    <PageHeader title="PIN de Validación" subtitle="Cada integrante utiliza su propio PIN secreto de seis dígitos." actions={<button type="button" class={BTN_SECONDARY} onClick={() => setHistorial(!historial)}><Icon name={historial ? 'users' : 'clock'} class="size-4" />{historial ? 'Ver integrantes' : 'Historial del equipo'}</button>} />
    <Alert tone="info">No compartas tu PIN. Para recuperar un PIN olvidado, solicitá su restablecimiento a JD3.</Alert>
    {historial ? <HistorialEquipo /> : <>
    {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
    {loading && !data ? <Spinner /> : <div class="mt-4 space-y-3">
      {!data?.length && !error && <Card><EmptyState title="Sin integrantes" text="Cargá el equipo de orientación en la ficha de tu escuela." /></Card>}
      {data?.map((item) => <Card key={item.id}>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="font-semibold text-slate-900">{item.nombre}</p>
            <p class="text-sm text-slate-500">{item.cargo || 'Equipo de orientación'}</p>
            <div class="mt-2"><Badge tone={item.tiene_pin ? 'green' : 'amber'}>{item.tiene_pin ? 'PIN creado' : 'Sin PIN'}</Badge>{item.solicitud_pendiente && <span class="ml-2"><Badge tone="blue">Solicitud pendiente</Badge></span>}</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class={BTN_PRIMARY} onClick={() => setEdit(item)}><Icon name="key" class="size-4" />{item.tiene_pin ? 'Cambiar PIN' : 'Crear PIN'}</button>
            {item.tiene_pin && <button type="button" class={BTN_SECONDARY} disabled={item.solicitud_pendiente || enviando !== null} onClick={() => solicitar(item)}><Icon name="mail" class="size-4" />Solicitar restablecimiento</button>}
          </div>
        </div>
      </Card>)}
    </div>}
    {edit && <FormularioPin integrante={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload() }} />}
    </>}
  </>
}

function HistorialEquipo() {
  const [pagina, setPagina] = useState(0)
  const { data, error, loading } = useAsync(async () => {
    const r = await supabase.rpc('eoe_equipo_historial_listar').range(pagina * 20, pagina * 20 + 20)
    if (r.error) throw r.error
    return r.data as Movimiento[]
  }, [pagina])
  const acciones = { alta: 'Alta', edicion: 'Edición', eliminacion: 'Eliminación' }
  const campos: Record<string, string> = { apellido_nombre: 'nombre', cargo_id: 'cargo', revista_id: 'situación de revista', cuil: 'CUIL', telefono: 'teléfono', email: 'correo', toma_posesion: 'toma de posesión', activo: 'estado' }
  return <div class="mt-4">
    <p class="mb-3 text-sm text-slate-500">Se muestran los movimientos desde la activación del módulo. Las acciones desde la cuenta compartida se registran con el nombre de esa cuenta.</p>
    {error && <Alert tone="error">{error}</Alert>}
    {loading ? <Spinner /> : <Card>
      {!data?.length ? <EmptyState title="Sin movimientos" /> : <ul class="divide-y divide-slate-100">{data.slice(0, 20).map((m, i) => <li key={`${m.fecha}-${i}`} class="py-3">
        <p class="font-medium">{acciones[m.accion]} · {m.nombre}</p>
        <p class="text-sm text-slate-500">{new Date(m.fecha).toLocaleString('es-AR')} · {m.autor || 'Sistema'}</p>
        {m.cambios.length > 0 && <p class="mt-1 text-xs text-slate-500">Campos modificados: {m.cambios.map((c) => campos[c] ?? c).join(', ')}</p>}
      </li>)}</ul>}
      <div class="mt-3 flex items-center justify-between gap-2">
        <button type="button" class={BTN_SECONDARY} disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}><Icon name="chevl" class="size-4" />Anterior</button>
        <span class="text-sm text-slate-500">Página {pagina + 1}</span>
        <button type="button" class={BTN_SECONDARY} disabled={!data || data.length <= 20} onClick={() => setPagina(pagina + 1)}><Icon name="chevr" class="size-4" />Siguiente</button>
      </div>
    </Card>}
  </div>
}

function FormularioPin({ integrante, onClose, onDone }: { integrante: Integrante; onClose(): void; onDone(): void }) {
  const [anterior, setAnterior] = useState('')
  const [nuevo, setNuevo] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const guardar = async (event: Event) => {
    event.preventDefault()
    if (!/^[0-9]{6}$/.test(nuevo) || (integrante.tiene_pin && !/^[0-9]{6}$/.test(anterior))) return setError('El PIN debe tener exactamente seis dígitos.')
    if (nuevo !== confirmacion) return setError('Los PIN nuevos no coinciden.')
    setError(''); setBusy(true)
    const r = await supabase.rpc('eoe_pin_guardar', { p_integrante: integrante.id, p_nuevo: nuevo, p_anterior: integrante.tiene_pin ? anterior : null })
    setBusy(false)
    if (r.error) return setError(r.error.message)
    if (r.data) return setError(String(r.data))
    toast.ok('PIN actualizado'); onDone()
  }
  const campo = (value: string, change: (value: string) => void) => <input class={FIELD} type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autocomplete="off" value={value} onInput={(e) => change(e.currentTarget.value)} />
  return <Modal title={`${integrante.tiene_pin ? 'Cambiar' : 'Crear'} PIN · ${integrante.nombre}`} onClose={onClose}>
    <form class="space-y-4" onSubmit={guardar}>
      {error && <Alert tone="error">{error}</Alert>}
      {integrante.tiene_pin && <Lbl label="PIN anterior">{campo(anterior, setAnterior)}</Lbl>}
      <Lbl label="Nuevo PIN de seis dígitos">{campo(nuevo, setNuevo)}</Lbl>
      <Lbl label="Confirmar nuevo PIN">{campo(confirmacion, setConfirmacion)}</Lbl>
      <div class="flex justify-end gap-2">
        <button type="button" class={BTN_SECONDARY} onClick={onClose}><Icon name="x" class="size-4" />Cancelar</button>
        <button class={BTN_PRIMARY} disabled={busy}><Icon name="check" class="size-4" />Guardar PIN</button>
      </div>
    </form>
  </Modal>
}

function Solicitudes() {
  const [busy, setBusy] = useState<number | null>(null)
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('eoe_pin_solicitudes_pendientes')
    if (r.error) throw r.error
    return r.data as Solicitud[]
  })
  const resolver = async (s: Solicitud) => {
    if (!await confirmar('Restablecer PIN', { text: `Verificá la identidad de ${s.integrante} antes de autorizar un nuevo PIN. El PIN anterior dejará de funcionar.`, ok: 'Restablecer' })) return
    setBusy(s.id)
    const r = await supabase.rpc('eoe_pin_restablecer', { p_solicitud: s.id })
    setBusy(null)
    if (r.error) return toast.error(r.error.message)
    toast.ok('PIN restablecido'); reload()
  }
  return <>
    <PageHeader title="PIN de Validación" subtitle="Solicitudes de restablecimiento de los equipos de orientación" />
    <Alert tone="warning">Verificá la identidad del integrante por un canal de confianza antes de restablecer su PIN.</Alert>
    {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
    {loading && !data ? <Spinner /> : <div class="mt-4 space-y-3">
      {!data?.length && !error && <Card><EmptyState title="Sin solicitudes pendientes" /></Card>}
      {data?.map((s) => <Card key={s.id}><div class="flex flex-wrap items-center justify-between gap-3">
        <div><p class="font-semibold">{s.integrante}</p><p class="text-sm text-slate-500">{s.escuela || s.cue} · {new Date(s.creado_en).toLocaleString('es-AR')}</p></div>
        <button type="button" class={BTN_SECONDARY} disabled={busy !== null} onClick={() => resolver(s)}><Icon name="unlock" class="size-4" />Restablecer PIN</button>
      </div></Card>)}
    </div>}
  </>
}
