import { useEffect, useRef, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, confirmar, EmptyState, FIELD, Lbl, Modal, PageHeader, Spinner, TabBar, toast, type TabItem } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { ValidarPin } from './EoeValidarPin'
import { LegajoArchivos, sincronizarCarpetaLegajo } from './LegajoArchivos'
import { LegajoTransferencias } from './LegajoTransferencias'

interface Legajo { id: string; nombre: string; dni: string | null; identificador_temporal: string }
interface Intervencion { id: number; fecha: string; texto: string; firmante_nombre: string; firmado_en: string }
interface Auditoria { id: number; accion: string; integrante_nombre: string | null; fecha: string }
interface Detalle extends Legajo { intervenciones: Intervencion[]; auditoria: Auditoria[] }
interface Abierto { legajo: Legajo; token: string; vence: number }
interface Familiar extends Legajo { vinculado: boolean; otro_grupo: boolean }
const fecha = (v: string) => new Date(v).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
const fechaDia = (v: string) => v.split('-').reverse().join('/')
const SECCIONES: TabItem[] = [
  { id: 'legajos', label: 'Legajos', icon: 'books', color: 'sky' },
  { id: 'transferencias', label: 'Solicitudes', icon: 'transfer', color: 'amber' },
]
const DETALLE_TABS: TabItem[] = [
  { id: 'intervenciones', label: 'Intervenciones', icon: 'note', color: 'sky' },
  { id: 'familia', label: 'Grupo familiar', icon: 'users', color: 'violet' },
]

async function cerrarAcceso(token: string) {
  const r = await supabase.rpc('eoe_legajo_cerrar', { p_token: token })
  if (r.error) throw new Error(r.error.message)
}

export function LegajoDigital() {
  const [nuevo, setNuevo] = useState(false)
  const [abrir, setAbrir] = useState<Legajo | null>(null)
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [tab, setTab] = useState('legajos')
  useEffect(() => {
    if (!abierto) return
    return () => { void cerrarAcceso(abierto.token).catch(() => toast.error('No se pudo cerrar el acceso al legajo en el servidor.')) }
  }, [abierto?.token])
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('eoe_legajos_listar')
    if (r.error) throw r.error
    return r.data as Legajo[]
  })
  if (abierto) return <VistaLegajo key={`${abierto.legajo.id}-${abierto.token}`} abierto={abierto} onNavigate={setAbierto} onClose={() => { setAbierto(null); reload() }} />
  const filtrados = (data ?? []).filter((l) => `${l.nombre} ${l.dni ?? l.identificador_temporal}`.toLocaleLowerCase().includes(busqueda.trim().toLocaleLowerCase()))
  return <>
    <PageHeader title="Legajo Digital" subtitle="Intervenciones del Equipo de Orientación" actions={tab === 'legajos' && <button type="button" class={BTN_PRIMARY} onClick={() => setNuevo(true)}><Icon name="plus" class="size-4" />Crear legajo</button>} />
    <Alert>Los legajos se abren con PIN y registran cada acceso.</Alert>
    <TabBar class="mt-4" label="Secciones de legajo digital" items={SECCIONES} active={tab} onChange={setTab} />
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
      setAbierto({ legajo: abrir, token: respuesta.token, vence: Date.now() + 15 * 60 * 1000 }); setAbrir(null)
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

function VistaLegajo({ abierto, onClose, onNavigate }: { abierto: Abierto; onClose(): void; onNavigate(v: Abierto): void }) {
  const [intervenir, setIntervenir] = useState(false)
  const [identificar, setIdentificar] = useState(false)
  const [vencido, setVencido] = useState(false)
  const [tab, setTab] = useState('intervenciones')
  const [cerrando, setCerrando] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVencido(true), Math.max(0, abierto.vence - Date.now()))
    return () => clearTimeout(timer)
  }, [abierto.vence])
  const cerrar = async () => {
    setCerrando(true)
    try { await cerrarAcceso(abierto.token) }
    catch { toast.error('No se pudo cerrar el acceso en el servidor; vencerá automáticamente.') }
    onClose()
  }
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('eoe_legajo_detalle', { p_legajo: abierto.legajo.id, p_token: abierto.token })
    if (r.error) throw r.error
    return r.data as Detalle
  })
  const acciones: Record<string, string> = { creacion: 'Creación', apertura: 'Apertura', intervencion: 'Intervención', identificacion: 'Asignación de DNI', documentacion: 'Documento agregado', transferencia: 'Transferencia', grupo_familiar_asociado: 'Grupo familiar: asociación', grupo_familiar_desvinculado: 'Grupo familiar: desvinculación' }
  if (vencido) return <><button type="button" disabled={cerrando} class={`${BTN_SECONDARY} mb-3`} onClick={cerrar}><Icon name="chevl" class="size-4" />Volver</button><Alert tone="warning">El acceso venció. Abrí el legajo nuevamente con tu PIN.</Alert></>
  return <>
    <button type="button" disabled={cerrando} class={`${BTN_SECONDARY} mb-3`} onClick={cerrar}><Icon name="chevl" class="size-4" />Cerrar legajo</button>
    <PageHeader title={data?.nombre ?? abierto.legajo.nombre} subtitle={data?.dni ? `DNI ${data.dni}` : data ? `Identificador temporal: ${data.identificador_temporal}` : 'Legajo Digital'} />
    {error && <Alert tone="error">{error}</Alert>}
    {loading && !data ? <Spinner /> : !error && data && <>
      <div class="mb-4 flex flex-wrap gap-2">
        <Badge tone="blue">Acceso temporal</Badge>
        {!data.dni && <button type="button" class={BTN_SECONDARY} onClick={() => setIdentificar(true)}><Icon name="id-card" class="size-4" />Asignar DNI</button>}
        <button type="button" class={BTN_PRIMARY} onClick={() => setIntervenir(true)}><Icon name="plus" class="size-4" />Nueva intervención</button>
      </div>
      <TabBar label="Secciones del legajo" items={DETALLE_TABS} active={tab} onChange={setTab} />
      {tab === 'familia' ? <GrupoFamiliar abierto={abierto} onNavigate={onNavigate} onChanged={reload} /> : <div class="grid gap-4 lg:grid-cols-3">
        <Card title="Intervenciones" class="lg:col-span-2">
          {!data.intervenciones.length ? <EmptyState title="Sin intervenciones" /> : <ul class="divide-y divide-slate-100">{data.intervenciones.map((i) => <li key={i.id} class="py-3"><p class="text-sm font-semibold">{fechaDia(i.fecha)} · {i.firmante_nombre}</p><p class="mt-2 whitespace-pre-wrap text-sm text-slate-700">{i.texto}</p><p class="mt-2 text-xs text-slate-500">Firmada el {fecha(i.firmado_en)}</p></li>)}</ul>}
          <div class="mt-5 border-t border-slate-200 pt-4"><h3 class="mb-3 text-sm font-semibold">Documentación</h3><LegajoArchivos tipo="legajo" referencia={data.id} token={abierto.token} editable onChanged={reload} /></div>
        </Card>
        <Card title="Actividad del legajo">
          <ul class="divide-y divide-slate-100">{data.auditoria.map((a) => <li key={a.id} class="py-2 text-sm"><p class="font-medium">{acciones[a.accion] ?? a.accion}</p><p class="text-xs text-slate-500">{fecha(a.fecha)}{a.integrante_nombre ? ` · ${a.integrante_nombre}` : ''}</p></li>)}</ul>
        </Card>
      </div>}
      {intervenir && <NuevaIntervencion abierto={abierto} onClose={() => setIntervenir(false)} onDone={() => { setIntervenir(false); reload() }} />}
      {identificar && <AsignarDni abierto={abierto} onClose={() => setIdentificar(false)} onDone={() => { setIdentificar(false); reload() }} />}
    </>}
  </>
}

function GrupoFamiliar({ abierto, onNavigate, onChanged }: { abierto: Abierto; onNavigate(v: Abierto): void; onChanged(): void }) {
  const [busqueda, setBusqueda] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const lista = useAsync(async () => {
    const r = await supabase.rpc('eoe_grupo_familiar_listar', { p_legajo: abierto.legajo.id, p_token: abierto.token })
    if (r.error) throw r.error
    return r.data as Familiar[]
  })
  const familiares = lista.data?.filter((l) => l.vinculado) ?? []
  const consulta = busqueda.trim().toLocaleLowerCase()
  const candidatos = consulta ? (lista.data ?? []).filter((l) => !l.vinculado && `${l.nombre} ${l.dni ?? l.identificador_temporal}`.toLocaleLowerCase().includes(consulta)) : []
  const cambiar = async (l: Familiar, quitar: boolean) => {
    const mensaje = quitar
      ? `${l.nombre} dejará de pertenecer a este grupo familiar.`
      : l.otro_grupo ? `${l.nombre} ya integra otro grupo familiar. Se unirán ambos grupos completos.` : `Se asociará a ${l.nombre} con este grupo familiar.`
    if (!await confirmar(quitar ? 'Desvincular legajo' : 'Asociar legajo', { text: mensaje, ok: quitar ? 'Desvincular' : 'Asociar', danger: quitar })) return
    setBusy(true); setError('')
    const r = await supabase.rpc(quitar ? 'eoe_grupo_familiar_desvincular' : 'eoe_grupo_familiar_asociar', { p_legajo: abierto.legajo.id, p_token: abierto.token, p_otro: l.id })
    setBusy(false)
    if (r.error) return setError(r.error.message)
    toast.ok(quitar ? 'Legajo desvinculado' : 'Legajo asociado'); setBusqueda(''); lista.reload(); onChanged()
  }
  const navegar = async (l: Familiar) => {
    setBusy(true); setError('')
    const r = await supabase.rpc('eoe_grupo_familiar_abrir', { p_legajo: abierto.legajo.id, p_token: abierto.token, p_otro: l.id })
    if (r.error) { if (mounted.current) { setBusy(false); setError(r.error.message) }; return }
    const resultado = r.data as { token?: string; legajo?: Legajo }
    if (!resultado.token || !resultado.legajo) { if (mounted.current) { setBusy(false); setError('No se pudo abrir el legajo familiar.') }; return }
    if (!mounted.current) {
      void cerrarAcceso(resultado.token).catch(() => toast.error('No se pudo cerrar el acceso al legajo en el servidor.'))
      return
    }
    onNavigate({ legajo: resultado.legajo, token: resultado.token, vence: abierto.vence })
  }
  const identificacion = (l: Legajo) => l.dni ? `DNI ${l.dni}` : `Identificador temporal: ${l.identificador_temporal}`
  return <div class="space-y-4">
    <Alert>Solo se pueden asociar legajos de esta escuela. Cada apertura queda registrada y el acceso conserva el vencimiento del primer PIN. Si un legajo se transfiere, se desvincula del grupo.</Alert>
    {(error || lista.error) && <Alert tone="error">{error || lista.error}</Alert>}
    {lista.loading && !lista.data ? <Spinner /> : !lista.error && <>
      <Card title="Legajos del grupo familiar">
        {!familiares.length ? <EmptyState title="Sin legajos asociados" text="Buscá otro legajo para formar un grupo familiar." /> : <div class="space-y-3">{familiares.map((l) => <div key={l.id} class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
          <div class="min-w-0"><p class="font-semibold">{l.nombre}</p><p class="break-all text-sm text-slate-500">{identificacion(l)}</p></div>
          <div class="flex flex-wrap gap-2"><button type="button" disabled={busy} class={BTN_SECONDARY} onClick={() => cambiar(l, true)}><Icon name="x" class="size-4" />Desvincular</button><button type="button" disabled={busy} class={BTN_PRIMARY} onClick={() => navegar(l)}><Icon name="eye" class="size-4" />Abrir legajo</button></div>
        </div>)}</div>}
      </Card>
      <Card title="Asociar otro legajo">
        <input class={FIELD} type="search" aria-label="Buscar legajo para asociar" placeholder="Buscar por nombre, DNI o identificador" value={busqueda} onInput={(e) => setBusqueda(e.currentTarget.value)} />
        {consulta && <div class="mt-3 space-y-2">{!candidatos.length ? <p class="text-sm text-slate-500">No se encontraron otros legajos.</p> : candidatos.map((l) => <div key={l.id} class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
          <div class="min-w-0"><p class="font-semibold">{l.nombre}</p><p class="break-all text-sm text-slate-500">{identificacion(l)}</p>{l.otro_grupo && <Badge tone="amber">Ya pertenece a otro grupo</Badge>}</div>
          <button type="button" disabled={busy} class={BTN_SECONDARY} onClick={() => cambiar(l, false)}><Icon name="plus" class="size-4" />Asociar</button>
        </div>)}</div>}
      </Card>
    </>}
  </div>
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
