import { useEffect, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Spinner, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { ValidarPin } from './EoeValidarPin'
import { LegajoArchivos, sincronizarCarpetaLegajo } from './LegajoArchivos'
import { LegajoTransferencias } from './LegajoTransferencias'

interface Legajo { id: string; nombre: string; dni: string | null; identificador_temporal: string }
interface Intervencion { id: number; fecha: string; texto: string; firmante_nombre: string; firmado_en: string }
interface Auditoria { id: number; accion: string; integrante_nombre: string | null; fecha: string }
interface Detalle extends Legajo { intervenciones: Intervencion[]; auditoria: Auditoria[] }
interface Abierto { legajo: Legajo; token: string }
const fecha = (v: string) => new Date(v).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
const fechaDia = (v: string) => v.split('-').reverse().join('/')

export function LegajoDigital() {
  const [nuevo, setNuevo] = useState(false)
  const [abrir, setAbrir] = useState<Legajo | null>(null)
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [tab, setTab] = useState<'legajos' | 'transferencias'>('legajos')
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('eoe_legajos_listar')
    if (r.error) throw r.error
    return r.data as Legajo[]
  })
  if (abierto) return <VistaLegajo key={`${abierto.legajo.id}-${abierto.token}`} abierto={abierto} onClose={() => { setAbierto(null); reload() }} />
  const filtrados = (data ?? []).filter((l) => `${l.nombre} ${l.dni ?? l.identificador_temporal}`.toLocaleLowerCase().includes(busqueda.trim().toLocaleLowerCase()))
  return <>
    <PageHeader title="Legajo Digital" subtitle="Intervenciones del Equipo de Orientación" actions={tab === 'legajos' && <button type="button" class={BTN_PRIMARY} onClick={() => setNuevo(true)}><Icon name="plus" class="size-4" />Crear legajo</button>} />
    <Alert>Los legajos se abren con PIN y registran cada acceso.</Alert>
    <nav class="mt-4 flex flex-wrap gap-2" aria-label="Secciones de legajo digital">
      <button type="button" class={tab === 'legajos' ? BTN_PRIMARY : BTN_SECONDARY} onClick={() => setTab('legajos')}><Icon name="books" class="size-4" />Legajos</button>
      <button type="button" class={tab === 'transferencias' ? BTN_PRIMARY : BTN_SECONDARY} onClick={() => setTab('transferencias')}><Icon name="transfer" class="size-4" />Solicitudes</button>
    </nav>
    {tab === 'transferencias' ? <div class="mt-4"><LegajoTransferencias /></div> : <>
    <div class="mt-4"><input class={FIELD} type="search" aria-label="Buscar legajo" placeholder="Buscar por nombre, DNI o identificador" value={busqueda} onInput={(e) => setBusqueda(e.currentTarget.value)} /></div>
    {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
    {loading && !data ? <Spinner /> : <div class="mt-3 space-y-2">
      {!filtrados.length && !error && <Card><EmptyState title="Sin legajos" text="No hay resultados para mostrar." /></Card>}
      {filtrados.map((l) => <Card key={l.id}><div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0"><p class="font-semibold">{l.nombre}</p><p class="break-all text-sm text-slate-500">{l.dni ? `DNI ${l.dni}` : `Identificador temporal: ${l.identificador_temporal}`}</p></div>
        <button type="button" class={BTN_SECONDARY} onClick={() => setAbrir(l)}><Icon name="lock" class="size-4" />Abrir con PIN</button>
      </div></Card>)}
    </div>}
    {nuevo && <CrearLegajo onClose={() => setNuevo(false)} onDone={() => { setNuevo(false); reload() }} />}
    {abrir && <ValidarPin titulo={`Abrir legajo · ${abrir.nombre}`} onClose={() => setAbrir(null)} onSubmit={async (integrante, pin) => {
      const r = await supabase.rpc('eoe_legajo_abrir', { p_legajo: abrir.id, p_integrante: integrante, p_pin: pin })
      if (r.error) throw new Error(r.error.message)
      const respuesta = r.data as { error?: string; token?: string }
      if (respuesta.error) throw new Error(respuesta.error)
      if (!respuesta.token) throw new Error('No se pudo abrir el legajo.')
      setAbierto({ legajo: abrir, token: respuesta.token }); setAbrir(null)
    }} />}
    </>}
  </>
}

function CrearLegajo({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [nombre, setNombre] = useState(''), [dni, setDni] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const guardar = async (e: Event) => {
    e.preventDefault(); setBusy(true); setError('')
    const r = await supabase.rpc('eoe_legajo_crear', { p_nombre: nombre, p_dni: dni.trim() || null })
    setBusy(false)
    if (r.error) return setError(r.error.message)
    toast.ok('Legajo creado'); onDone()
  }
  return <Modal title="Crear legajo" onClose={onClose}><form class="space-y-4" onSubmit={guardar}>
    {error && <Alert tone="error">{error}</Alert>}
    <Lbl label="Apellido y nombre"><input class={FIELD} required minLength={3} maxLength={200} value={nombre} onInput={(e) => setNombre(e.currentTarget.value)} /></Lbl>
    <Lbl label="DNI (opcional)"><input class={FIELD} inputMode="numeric" pattern="[0-9]{6,9}" maxLength={9} value={dni} onInput={(e) => setDni(e.currentTarget.value)} /></Lbl>
    <p class="text-sm text-slate-500">Si no tiene DNI, se asignará un identificador temporal.</p>
    <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}><Icon name="x" class="size-4" />Cancelar</button><button class={BTN_PRIMARY} disabled={busy}><Icon name="plus" class="size-4" />Crear</button></div>
  </form></Modal>
}

function VistaLegajo({ abierto, onClose }: { abierto: Abierto; onClose(): void }) {
  const [intervenir, setIntervenir] = useState(false)
  const [identificar, setIdentificar] = useState(false)
  const [vencido, setVencido] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVencido(true), 15 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [])
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('eoe_legajo_detalle', { p_legajo: abierto.legajo.id, p_token: abierto.token })
    if (r.error) throw r.error
    return r.data as Detalle
  })
  const acciones: Record<string, string> = { creacion: 'Creación', apertura: 'Apertura', intervencion: 'Intervención', identificacion: 'Asignación de DNI', documentacion: 'Documento agregado', transferencia: 'Transferencia' }
  if (vencido) return <><button type="button" class={`${BTN_SECONDARY} mb-3`} onClick={onClose}><Icon name="chevl" class="size-4" />Volver</button><Alert tone="warning">El acceso venció. Abrí el legajo nuevamente con tu PIN.</Alert></>
  return <>
    <button type="button" class={`${BTN_SECONDARY} mb-3`} onClick={onClose}><Icon name="chevl" class="size-4" />Cerrar legajo</button>
    <PageHeader title={data?.nombre ?? abierto.legajo.nombre} subtitle={data?.dni ? `DNI ${data.dni}` : data ? `Identificador temporal: ${data.identificador_temporal}` : 'Legajo Digital'} />
    {error && <Alert tone="error">{error}</Alert>}
    {loading && !data ? <Spinner /> : !error && data && <>
      <div class="mb-4 flex flex-wrap gap-2">
        <Badge tone="blue">Acceso temporal</Badge>
        {!data.dni && <button type="button" class={BTN_SECONDARY} onClick={() => setIdentificar(true)}><Icon name="id-card" class="size-4" />Asignar DNI</button>}
        <button type="button" class={BTN_PRIMARY} onClick={() => setIntervenir(true)}><Icon name="plus" class="size-4" />Nueva intervención</button>
      </div>
      <div class="grid gap-4 lg:grid-cols-3">
        <Card title="Intervenciones" class="lg:col-span-2">
          {!data.intervenciones.length ? <EmptyState title="Sin intervenciones" /> : <ul class="divide-y divide-slate-100">{data.intervenciones.map((i) => <li key={i.id} class="py-3"><p class="text-sm font-semibold">{fechaDia(i.fecha)} · {i.firmante_nombre}</p><p class="mt-2 whitespace-pre-wrap text-sm text-slate-700">{i.texto}</p><p class="mt-2 text-xs text-slate-500">Firmada el {fecha(i.firmado_en)}</p></li>)}</ul>}
          <div class="mt-5 border-t border-slate-200 pt-4"><h3 class="mb-3 text-sm font-semibold">Documentación</h3><LegajoArchivos tipo="legajo" referencia={data.id} token={abierto.token} editable onChanged={reload} /></div>
        </Card>
        <Card title="Actividad del legajo">
          <ul class="divide-y divide-slate-100">{data.auditoria.map((a) => <li key={a.id} class="py-2 text-sm"><p class="font-medium">{acciones[a.accion] ?? a.accion}</p><p class="text-xs text-slate-500">{fecha(a.fecha)}{a.integrante_nombre ? ` · ${a.integrante_nombre}` : ''}</p></li>)}</ul>
        </Card>
      </div>
      {intervenir && <NuevaIntervencion abierto={abierto} onClose={() => setIntervenir(false)} onDone={() => { setIntervenir(false); reload() }} />}
      {identificar && <AsignarDni abierto={abierto} onClose={() => setIdentificar(false)} onDone={() => { setIdentificar(false); reload() }} />}
    </>}
  </>
}

function AsignarDni({ abierto, onClose, onDone }: { abierto: Abierto; onClose(): void; onDone(): void }) {
  const [dni, setDni] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const guardar = async (e: Event) => {
    e.preventDefault(); setBusy(true); setError('')
    const r = await supabase.rpc('eoe_legajo_identificar', { p_legajo: abierto.legajo.id, p_token: abierto.token, p_dni: dni })
    if (r.error) { setBusy(false); return setError(r.error.message) }
    try {
      await sincronizarCarpetaLegajo(abierto.legajo.id, abierto.token)
      toast.ok('DNI asignado')
    } catch {
      toast.error('El DNI se asignó, pero no se pudo actualizar la carpeta en Drive. Volvé a intentar desde Documentación.')
    } finally { setBusy(false); onDone() }
  }
  return <Modal title="Asignar DNI" onClose={onClose}><form class="space-y-4" onSubmit={guardar}>
    {error && <Alert tone="error">{error}</Alert>}
    <Lbl label="DNI del estudiante"><input class={FIELD} required inputMode="numeric" pattern="[0-9]{6,9}" maxLength={9} value={dni} onInput={(e) => setDni(e.currentTarget.value)} /></Lbl>
    <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}><Icon name="x" class="size-4" />Cancelar</button><button class={BTN_PRIMARY} disabled={busy}><Icon name="check" class="size-4" />Asignar</button></div>
  </form></Modal>
}

function NuevaIntervencion({ abierto, onClose, onDone }: { abierto: Abierto; onClose(): void; onDone(): void }) {
  const [dia, setDia] = useState(''), [texto, setTexto] = useState(''), [firmar, setFirmar] = useState(false)
  const [error, setError] = useState('')
  if (firmar) return <ValidarPin titulo="Firmar intervención" onClose={() => setFirmar(false)} onSubmit={async (integrante, pin) => {
    const r = await supabase.rpc('eoe_legajo_intervenir', { p_legajo: abierto.legajo.id, p_token: abierto.token, p_fecha: dia, p_texto: texto, p_integrante: integrante, p_pin: pin })
    if (r.error) throw new Error(r.error.message)
    if (r.data) throw new Error(String(r.data))
    toast.ok('Intervención firmada'); onDone()
  }} />
  return <Modal title="Nueva intervención" onClose={onClose}><form class="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!texto.trim()) return setError('Completá la intervención.'); setFirmar(true) }}>
    {error && <Alert tone="error">{error}</Alert>}
    <Lbl label="Fecha"><input class={FIELD} type="date" required value={dia} onInput={(e) => setDia(e.currentTarget.value)} /></Lbl>
    <Lbl label="Intervención"><textarea class={`${FIELD} min-h-32 py-2`} required maxLength={20000} value={texto} onInput={(e) => setTexto(e.currentTarget.value)} /></Lbl>
    <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}><Icon name="x" class="size-4" />Cancelar</button><button class={BTN_PRIMARY}><Icon name="document-seal" class="size-4" />Firmar con PIN</button></div>
  </form></Modal>
}
