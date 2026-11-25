import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, Spinner, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { ValidarPin } from './EoeValidarPin'
import { LegajoArchivos } from './LegajoArchivos'

interface Solicitud {
  id: string; origen: string; destino: string; dni: string | null; descripcion: string | null
  estado: 'borrador' | 'pendiente' | 'transferido'; direccion: 'enviada' | 'recibida'; probanzas: number
}
interface Escuela { id: number; nombre: string; cue: string }
interface Legajo { id: string; nombre: string; dni: string | null; identificador_temporal: string }

export function LegajoTransferencias() {
  const [nueva, setNueva] = useState(false)
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const lista = useAsync(async () => {
    const r = await supabase.rpc('eoe_legajo_solicitudes')
    if (r.error) throw r.error
    return r.data as Solicitud[]
  })
  const solicitud = lista.data?.find((s) => s.id === seleccion)
  const estados = { borrador: 'Borrador', pendiente: 'Pendiente', transferido: 'Transferido' }
  return <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-sm text-slate-600">Solicitá un legajo a la escuela de origen o respondé las solicitudes recibidas.</p>
      <button type="button" class={BTN_PRIMARY} onClick={() => setNueva(true)}><Icon name="plus" class="size-4" />Nueva solicitud</button>
    </div>
    {lista.error && <Alert tone="error">{lista.error}</Alert>}
    {lista.loading && !lista.data ? <Spinner /> : !lista.error && <>
      {!lista.data?.length ? <Card><EmptyState title="Sin solicitudes" /></Card> : lista.data.map((s) => <Card key={s.id}>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap gap-2"><Badge tone={s.direccion === 'recibida' ? 'blue' : 'slate'}>{s.direccion === 'recibida' ? 'Recibida' : 'Enviada'}</Badge><Badge tone={s.estado === 'transferido' ? 'green' : 'amber'}>{estados[s.estado]}</Badge></div>
            <p class="text-sm font-semibold">{s.direccion === 'recibida' ? `Solicita: ${s.destino}` : `Origen: ${s.origen}`}</p>
            <p class="break-words text-sm text-slate-600">{s.dni ? `DNI ${s.dni}` : s.descripcion}</p>
          </div>
          <button type="button" class={BTN_SECONDARY} onClick={() => setSeleccion(s.id)}><Icon name="eye" class="size-4" />Ver solicitud</button>
        </div>
      </Card>)}
    </>}
    {nueva && <NuevaSolicitud onClose={() => setNueva(false)} onDone={(id) => { setNueva(false); setSeleccion(id); lista.reload() }} />}
    {solicitud && <DetalleSolicitud key={solicitud.id} solicitud={solicitud} onClose={() => setSeleccion(null)} onChanged={() => lista.reload()} />}
  </div>
}

function NuevaSolicitud({ onClose, onDone }: { onClose(): void; onDone(id: string): void }) {
  const [origen, setOrigen] = useState(''), [sinDni, setSinDni] = useState(false)
  const [dni, setDni] = useState(''), [descripcion, setDescripcion] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const escuelas = useAsync(async () => {
    const r = await supabase.rpc('eoe_legajo_escuelas_destino')
    if (r.error) throw r.error
    return r.data as Escuela[]
  })
  const crear = async (e: Event) => {
    e.preventDefault(); setBusy(true); setError('')
    const r = await supabase.rpc('eoe_legajo_solicitar', { p_origen: Number(origen), p_dni: sinDni ? null : dni, p_descripcion: sinDni ? descripcion : null })
    setBusy(false)
    if (r.error) return setError(r.error.message)
    if (typeof r.data !== 'string') return setError('No se pudo crear la solicitud.')
    toast.ok('Borrador creado. Adjuntá la probanza para enviarlo.'); onDone(r.data)
  }
  return <Modal title="Solicitar un legajo" onClose={onClose}><form class="space-y-4" onSubmit={crear}>
    {(error || escuelas.error) && <Alert tone="error">{error || escuelas.error}</Alert>}
    {escuelas.loading ? <Spinner /> : <>
      <Lbl label="Escuela de origen"><select class={FIELD} required value={origen} onChange={(e) => setOrigen(e.currentTarget.value)}><option value="">Seleccionar escuela</option>{escuelas.data?.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {e.cue}</option>)}</select></Lbl>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={sinDni} onChange={(e) => setSinDni(e.currentTarget.checked)} />El estudiante no tiene DNI</label>
      {sinDni
        ? <Lbl label="Descripción para identificar al estudiante"><textarea class={`${FIELD} min-h-24 py-2`} required minLength={3} maxLength={1000} value={descripcion} onInput={(e) => setDescripcion(e.currentTarget.value)} /></Lbl>
        : <Lbl label="DNI del estudiante"><input class={FIELD} required inputMode="numeric" pattern="[0-9]{6,9}" maxLength={9} value={dni} onInput={(e) => setDni(e.currentTarget.value)} /></Lbl>}
      <p class="text-sm text-slate-500">La solicitud se crea como borrador. Deberás adjuntar una probanza de matriculación antes de enviarla.</p>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}><Icon name="x" class="size-4" />Cancelar</button><button class={BTN_PRIMARY} disabled={busy || !escuelas.data?.length}><Icon name="plus" class="size-4" />Crear borrador</button></div>
    </>}
  </form></Modal>
}

function DetalleSolicitud({ solicitud, onClose, onChanged }: { solicitud: Solicitud; onClose(): void; onChanged(): void }) {
  const [paso, setPaso] = useState<'detalle' | 'pin' | 'confirmar'>('detalle')
  const [legajo, setLegajo] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const legajos = useAsync(async () => {
    if (solicitud.direccion !== 'recibida' || solicitud.estado !== 'pendiente') return [] as Legajo[]
    const r = await supabase.rpc('eoe_legajos_listar')
    if (r.error) throw r.error
    return (r.data as Legajo[]).filter((l) => !solicitud.dni || l.dni === solicitud.dni)
  }, [solicitud.id, solicitud.direccion, solicitud.estado])
  const enviar = async () => {
    setBusy(true); setError('')
    const r = await supabase.rpc('eoe_legajo_enviar_solicitud', { p_solicitud: solicitud.id })
    setBusy(false)
    if (r.error) return setError(r.error.message)
    toast.ok('Solicitud enviada'); onChanged()
  }
  const confirmar = async () => {
    setBusy(true); setError('')
    const r = await supabase.rpc('eoe_legajo_confirmar_transferencia', { p_solicitud: solicitud.id, p_token: token })
    setBusy(false)
    if (r.error) return setError(r.error.message)
    toast.ok('Legajo transferido'); onClose(); onChanged()
  }
  if (paso === 'pin') return <ValidarPin titulo="Validar transferencia" onClose={() => setPaso('detalle')} onSubmit={async (integrante, pin) => {
    const r = await supabase.rpc('eoe_legajo_preparar_transferencia', { p_solicitud: solicitud.id, p_legajo: legajo, p_integrante: integrante, p_pin: pin })
    if (r.error) throw new Error(r.error.message)
    const resultado = r.data as { error?: string; token?: string }
    if (resultado.error) throw new Error(resultado.error)
    if (!resultado.token) throw new Error('No se pudo validar la transferencia.')
    setToken(resultado.token); setPaso('confirmar')
  }} />
  if (paso === 'confirmar') return <Modal title="Confirmar transferencia" onClose={() => { setToken(''); setPaso('detalle') }}>
    <div class="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Alert tone="warning">Se transferirá el legajo de {legajos.data?.find((l) => l.id === legajo)?.nombre} a {solicitud.destino}. Tu escuela perderá el acceso al legajo y sus documentos.</Alert>
      <p class="text-sm text-slate-600">El PIN ya fue validado. Confirmá para completar la transferencia.</p>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={() => { setToken(''); setPaso('detalle') }}><Icon name="x" class="size-4" />Cancelar</button><button type="button" class={BTN_PRIMARY} disabled={busy} onClick={confirmar}><Icon name="check" class="size-4" />Confirmar transferencia</button></div>
    </div>
  </Modal>
  return <Modal title="Detalle de solicitud" onClose={onClose}>
    <div class="space-y-4">
      {(error || legajos.error) && <Alert tone="error">{error || legajos.error}</Alert>}
      <div class="space-y-1 text-sm"><p><strong>Origen:</strong> {solicitud.origen}</p><p><strong>Destino:</strong> {solicitud.destino}</p><p><strong>Estudiante:</strong> {solicitud.dni ? `DNI ${solicitud.dni}` : solicitud.descripcion}</p></div>
      {(solicitud.direccion === 'enviada' || solicitud.estado === 'pendiente') && <div>
        <h3 class="mb-2 text-sm font-semibold">Probanza de matriculación</h3>
        <LegajoArchivos tipo="solicitud" referencia={solicitud.id} editable={solicitud.direccion === 'enviada'} permitirNueva={solicitud.estado === 'borrador'} onChanged={onChanged} />
      </div>}
      {solicitud.direccion === 'enviada' && solicitud.estado === 'borrador' && <button type="button" class={BTN_PRIMARY} disabled={busy || solicitud.probanzas < 1} onClick={enviar}><Icon name="send" class="size-4" />Enviar solicitud</button>}
      {solicitud.direccion === 'recibida' && solicitud.estado === 'pendiente' && <div class="space-y-3 border-t border-slate-200 pt-4">
        <Lbl label="Legajo que se transferirá"><select class={FIELD} value={legajo} onChange={(e) => setLegajo(e.currentTarget.value)}><option value="">Seleccionar legajo</option>{legajos.data?.map((l) => <option key={l.id} value={l.id}>{l.nombre} · {l.dni ? `DNI ${l.dni}` : `Sin DNI · ${l.identificador_temporal}`}</option>)}</select></Lbl>
        {!legajos.loading && !legajos.data?.length && <Alert tone="warning">No hay un legajo coincidente disponible en tu escuela.</Alert>}
        <button type="button" class={BTN_PRIMARY} disabled={!legajo || legajos.loading} onClick={() => { setError(''); setPaso('pin') }}><Icon name="lock" class="size-4" />Validar con PIN</button>
      </div>}
      <div class="flex justify-end"><button type="button" class={BTN_SECONDARY} onClick={onClose}><Icon name="x" class="size-4" />Cerrar</button></div>
    </div>
  </Modal>
}
