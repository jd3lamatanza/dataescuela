import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../../lib/supabase'
import { useAsync } from '../../lib/hooks'
import { setParams, useRoute } from '../../lib/router'
import type { Table } from '../../lib/export'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, confirmar, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, PAGE_SIZE, RowMenu, Spinner, toast, Toggle } from '../../ui/kit'
import {
  ciclos, ciclosIngreso, cicloActual, confirmada, destinoTxt, DestinoFields, EstadoBadge, estadoTxt, Exportar, ExternaModal, fmtFecha, NuevaIntervencion,
  OTRA, puedeEgresar, puedeIngresar, Tabs, VerIntervenciones, type Egresante,
} from './common'
import { ImportarNomina } from './Importar'

interface Origen { cue: string; clave: string; codigo: string; nombre: string }

function useOrigen() {
  return useAsync(async () => {
    const id = await supabase.rpc('mi_escuela')
    if (id.error || !id.data) throw new Error('Tu cuenta no tiene una escuela asociada')
    const r = await supabase.from('escuelas').select('cue,clave,codigo,nombre').eq('id', id.data).single()
    if (r.error) throw r.error
    return r.data as Origen
  })
}

export function ArticulacionEscolar() {
  const { params } = useRoute()
  const { data: o, loading, error } = useOrigen()
  if (loading) return <Spinner />
  if (error || !o) return <Alert tone="error">{error ?? 'Sin escuela'}</Alert>
  const eg = puedeEgresar(o.codigo), ing = puedeIngresar(o.codigo)
  const tabs = [
    { id: 'egresantes', label: 'Egresantes', disabled: !eg, why: 'Tu escuela no carga egresantes' },
    { id: 'ingresantes', label: 'Ingresantes', disabled: !ing, why: 'Tu escuela no recibe ingresantes' },
    { id: 'trayectorias', label: 'Trayectorias', disabled: !eg, why: 'Tu escuela no tiene trayectorias propias' },
  ]
  const wanted = params.get('t') ?? ''
  const tab = tabs.find((t) => t.id === wanted && !t.disabled)?.id ?? tabs.find((t) => !t.disabled)?.id
  return (
    <>
      <PageHeader title="Articulación" subtitle={`${o.nombre ?? ''} · ${o.clave}`} />
      <Tabs items={tabs} active={tab ?? ''} onChange={(t) => setParams({ t, page: null, q: null })} />
      {tab === 'egresantes' && <Egresantes o={o} />}
      {tab === 'ingresantes' && <Ingresantes o={o} />}
      {tab === 'trayectorias' && <Trayectorias o={o} />}
      {!tab && <EmptyState title="Tu escuela no participa de Articulación" />}
    </>
  )
}

function useLista(o: Origen, ciclo: number, tipo: 'origen' | 'destino') {
  return useAsync(async () => {
    let s = supabase.from('egresantes').select('*').eq('ciclo', tipo === 'origen' ? ciclo : ciclo - 1)
    s = tipo === 'origen' ? s.eq('origen_cue', o.cue) : s.eq('destino_clave', o.clave).eq('destino_manual', false)
    const r = await s.order('nombre').limit(5000)
    if (r.error) throw r.error
    return r.data as Egresante[]
  }, [o.cue, ciclo, tipo])
}

const bloqueado = (r: Egresante) => r.ciclo < cicloActual() || confirmada(r)
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function Filtros({ ciclo, setCiclo, q, setQ, lista, children }: { ciclo: number; setCiclo(n: number): void; q: string; setQ(s: string): void; lista: number[]; children?: any }) {
  return (
    <div class="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_1fr_auto_auto]">
      <select class={FIELD + ' lg:w-40'} aria-label="Ciclo lectivo" value={ciclo} onChange={(e) => setCiclo(Number(e.currentTarget.value))}>
        {lista.slice().reverse().map((y) => <option key={y} value={y}>Ciclo {y}</option>)}
      </select>
      <input type="search" class={FIELD} placeholder="Buscar por DNI, nombre o destino" value={q} maxLength={80} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Buscar" />
      {children}
    </div>
  )
}

function Egresantes({ o }: { o: Origen }) {
  const [ciclo, setCiclo] = useState(cicloActual())
  const [q, setQ] = useState('')
  const [curso, setCurso] = useState('')
  const [ppi, setPpi] = useState(false)
  const [page, setPage] = useState(1)
  const [edit, setEdit] = useState<Egresante | 'nuevo' | null>(null)
  const [masivo, setMasivo] = useState(false)
  const [importar, setImportar] = useState(false)
  const lista = useLista(o, ciclo, 'origen')
  const filas = useMemo(() => {
    const n = norm(q)
    return (lista.data ?? []).filter((r) => (!curso || r.curso === curso) && (!ppi || r.ppi) &&
      (!n || norm(`${r.dni} ${r.nombre} ${r.destino_nombre ?? ''} ${r.destino_clave ?? ''} ${r.observaciones ?? ''}`).includes(n)))
  }, [lista.data, q, curso, ppi])
  const cursos = [...new Set((lista.data ?? []).map((r) => r.curso))].sort()
  const vista = filas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const cerrado = ciclo < cicloActual()

  const eliminar = async (r: Egresante) => {
    if (!(await confirmar('Eliminar egresante', { text: `${r.nombre} (DNI ${r.dni})`, ok: 'Eliminar', danger: true }))) return
    const { error } = await supabase.rpc('egresante_eliminar', { p_id: r.id })
    if (error) return toast.error(error.message)
    toast.ok('Registro eliminado'); lista.reload()
  }
  const tabla = async (): Promise<Table> => ({
    title: `Egresantes · Ciclo ${ciclo}`, subtitle: `${o.nombre} (${o.clave}) · ${filas.length} registros`,
    headers: ['DNI', 'Estudiante', 'Curso', 'PPI', 'Escuela destino', 'Observaciones'], widths: [10, 26, 7, 5, 30, 24],
    rows: filas.map((r) => [r.dni, r.nombre, r.curso, r.ppi ? 'Sí' : 'No', destinoTxt(r) || 'Sin completar', r.observaciones ?? '']),
  })

  return (
    <>
      <Filtros ciclo={ciclo} setCiclo={(n) => { setCiclo(n); setPage(1) }} q={q} setQ={(s) => { setQ(s); setPage(1) }} lista={ciclos()}>
        <select class={FIELD + ' lg:w-32'} aria-label="Curso" value={curso} onChange={(e) => { setCurso(e.currentTarget.value); setPage(1) }}>
          <option value="">Cursos</option>{cursos.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={ppi} onChange={(e) => { setPpi(e.currentTarget.checked); setPage(1) }} />Solo PPI</label>
      </Filtros>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <button class={BTN_PRIMARY} disabled={cerrado} onClick={() => setEdit('nuevo')}>Nuevo egresante</button>
        <button class={BTN_SECONDARY} disabled={cerrado} onClick={() => setMasivo(true)}>Asignar destino</button>
        <button class={BTN_SECONDARY} disabled={cerrado} onClick={() => setImportar(true)}>Importar nómina</button>
        <Exportar build={tabla} name={`egresantes-${o.clave}-${ciclo}`} />
        {cerrado && <Badge tone="amber">Ciclo cerrado: solo lectura</Badge>}
      </div>
      <Card>
        {lista.loading ? <Spinner /> : lista.error ? <Alert tone="error">{lista.error}</Alert> : !filas.length ? <EmptyState title="Sin egresantes" text="Cargá estudiantes con «Nuevo egresante» o importá la nómina." /> : (
          <ul class="-my-4 divide-y divide-slate-200">
            {vista.map((r) => (
              <li key={r.id} class="flex items-start gap-3 py-3">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">{r.nombre} {r.ppi && <Badge tone="blue">PPI</Badge>}</p>
                  <p class="text-xs text-slate-500">DNI {r.dni} · Curso {r.curso}</p>
                  <p class="mt-1 text-xs text-slate-600"><span class="font-medium">Destino:</span> {destinoTxt(r) || 'Sin completar'}</p>
                  <div class="mt-1"><EstadoBadge r={r} /></div>
                </div>
                <RowMenu items={[
                  { label: 'Editar', hidden: bloqueado(r), onClick: () => setEdit(r) },
                  { label: 'Eliminar', danger: true, sep: true, hidden: bloqueado(r), onClick: () => eliminar(r) },
                  { label: 'Registro bloqueado (ciclo cerrado o ingreso confirmado)', hidden: !bloqueado(r), onClick: () => toast.info('No se puede modificar') },
                ]} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pager page={page} total={filas.length} onPage={setPage} />
      {edit && <FormEgresante o={o} ciclo={ciclo} r={edit === 'nuevo' ? null : edit} onClose={() => setEdit(null)} onDone={lista.reload} />}
      {masivo && <DestinoMasivo o={o} ciclo={ciclo} filas={filas} onClose={() => setMasivo(false)} onDone={lista.reload} />}
      {importar && <ImportarNomina o={o} ciclo={ciclo} onClose={() => setImportar(false)} onDone={lista.reload} />}
    </>
  )
}

function FormEgresante({ o, ciclo, r, onClose, onDone }: { o: Origen; ciclo: number; r: Egresante | null; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({
    dni: r?.dni ?? '', nombre: r?.nombre ?? '', direccion: r?.direccion ?? '', curso: r?.curso ?? '', ppi: r?.ppi ?? false,
    acompanante: r?.acompanante ?? false, intensifica: r?.intensifica ?? false, obs: r?.observaciones ?? '',
    destino: r?.destino_manual ? OTRA : r?.destino_clave ?? '', dnombre: r?.destino_manual ? r.destino_nombre ?? '' : '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.currentTarget.value })
  const save = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('egresante_guardar', {
      p_id: r?.id ?? null, p_ciclo: ciclo, p_dni: f.dni, p_nombre: f.nombre, p_direccion: f.direccion, p_curso: f.curso, p_ppi: f.ppi,
      p_acompanante: f.acompanante, p_intensifica: f.intensifica, p_destino: f.destino, p_destino_nombre: f.dnombre, p_obs: f.obs,
    })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.ok(r ? 'Egresante actualizado' : 'Egresante cargado'); onDone(); onClose()
  }
  return (
    <Modal title={r ? 'Editar egresante' : `Nuevo egresante · Ciclo ${ciclo}`} onClose={onClose} wide>
      <div class="grid gap-3 sm:grid-cols-2">
        <Lbl label="DNI"><input class={FIELD} inputMode="numeric" maxLength={9} value={f.dni} onInput={set('dni')} /></Lbl>
        <Lbl label="Curso"><input class={FIELD} maxLength={20} value={f.curso} onInput={set('curso')} /></Lbl>
        <div class="sm:col-span-2"><Lbl label="Apellido y nombre"><input class={FIELD} maxLength={150} value={f.nombre} onInput={set('nombre')} /></Lbl></div>
        <div class="sm:col-span-2"><Lbl label="Dirección"><input class={FIELD} maxLength={200} value={f.direccion} onInput={set('direccion')} /></Lbl></div>
        <div class="sm:col-span-2 grid gap-3 sm:grid-cols-2"><DestinoFields codigo={o.codigo} destino={f.destino} nombre={f.dnombre} onDestino={(v) => setF({ ...f, destino: v })} onNombre={(v) => setF({ ...f, dnombre: v })} /></div>
        <Toggle checked={f.ppi} onChange={(v) => setF({ ...f, ppi: v })} label="Tiene PPI" />
        <Toggle checked={f.intensifica} onChange={(v) => setF({ ...f, intensifica: v })} label="Intensifica" />
        <Toggle checked={f.acompanante} onChange={(v) => setF({ ...f, acompanante: v })} label="Requiere acompañante" />
        <div class="sm:col-span-2"><Lbl label="Observaciones"><textarea class={FIELD + ' py-2'} rows={3} maxLength={500} value={f.obs} onInput={set('obs')} /></Lbl></div>
      </div>
      <div class="mt-4 flex justify-end gap-2"><button class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy} onClick={save}>Guardar</button></div>
    </Modal>
  )
}

function DestinoMasivo({ o, ciclo, filas, onClose, onDone }: { o: Origen; ciclo: number; filas: Egresante[]; onClose(): void; onDone(): void }) {
  const [destino, setDestino] = useState('')
  const [nombre, setNombre] = useState('')
  const [reemplazar, setReemplazar] = useState(false)
  const [busy, setBusy] = useState(false)
  const objetivo = filas.filter((r) => !confirmada(r) && (reemplazar || !r.destino_nombre))
  const save = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('egresantes_destino_masivo', { p_ciclo: ciclo, p_ids: objetivo.map((r) => r.id), p_destino: destino, p_nombre: nombre, p_reemplazar: reemplazar })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.ok(`${data} registros actualizados`); onDone(); onClose()
  }
  return (
    <Modal title="Asignar destino a los egresantes" onClose={onClose}>
      <p class="mb-3 text-sm text-slate-600">Se aplica a los egresantes del listado filtrado que aún no confirmaron ingreso.</p>
      <div class="space-y-3">
        <DestinoFields codigo={o.codigo} destino={destino} nombre={nombre} onDestino={setDestino} onNombre={setNombre} />
        <Toggle checked={reemplazar} onChange={setReemplazar} label="Reemplazar destinos ya cargados" />
        <p class="text-sm">Se actualizarán <b>{objetivo.length}</b> registros.</p>
      </div>
      <div class="mt-4 flex justify-end gap-2"><button class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy || !destino || !objetivo.length} onClick={save}>Aplicar</button></div>
    </Modal>
  )
}

function Trayectorias({ o }: { o: Origen }) {
  const [ciclo, setCiclo] = useState(cicloActual())
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ k: 'nueva' | 'ver' | 'ext'; r: Egresante } | null>(null)
  const lista = useLista(o, ciclo, 'origen')
  const filas = useMemo(() => {
    const n = norm(q)
    return (lista.data ?? []).filter((r) => (!estado || (estado === 'pend') === !confirmada(r)) && (!n || norm(`${r.dni} ${r.nombre} ${destinoTxt(r)}`).includes(n)))
  }, [lista.data, q, estado])
  const pend = (lista.data ?? []).filter((r) => !confirmada(r)).length
  const vista = filas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const tabla = async (): Promise<Table> => ({
    title: `Trayectorias · Ciclo ${ciclo}`, subtitle: `${o.nombre} (${o.clave}) · ${filas.length} registros`,
    headers: ['DNI', 'Estudiante', 'Curso', 'Escuela destino', 'Estado'], widths: [10, 26, 7, 34, 20],
    rows: filas.map((r) => [r.dni, r.nombre, r.curso, destinoTxt(r) || 'Sin completar', estadoTxt(r)]),
  })
  return (
    <>
      <Filtros ciclo={ciclo} setCiclo={(n) => { setCiclo(n); setPage(1) }} q={q} setQ={(s) => { setQ(s); setPage(1) }} lista={ciclos()}>
        <select class={FIELD + ' lg:w-40'} aria-label="Estado" value={estado} onChange={(e) => { setEstado(e.currentTarget.value); setPage(1) }}>
          <option value="">Estado: todos</option><option value="pend">Pendientes</option><option value="conf">Confirmados</option>
        </select>
        <Exportar build={tabla} name={`trayectorias-${o.clave}-${ciclo}`} />
      </Filtros>
      <p class="mb-2 text-sm text-slate-600">{pend ? <><Badge tone="amber">{pend}</Badge> trayectorias pendientes de confirmación.</> : 'No hay trayectorias pendientes.'}</p>
      <Card>
        {lista.loading ? <Spinner /> : !filas.length ? <EmptyState title="Sin trayectorias" /> : (
          <ul class="-my-4 divide-y divide-slate-200">
            {vista.map((r) => (
              <li key={r.id} class="flex items-start gap-3 py-3">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">{r.nombre}</p>
                  <p class="text-xs text-slate-500">DNI {r.dni} · Curso {r.curso}</p>
                  <p class="mt-1 text-xs text-slate-600"><span class="font-medium">Destino:</span> {destinoTxt(r) || 'Sin completar'}</p>
                  <div class="mt-1"><EstadoBadge r={r} /></div>
                </div>
                <RowMenu items={[
                  { label: 'Agregar intervención', onClick: () => setModal({ k: 'nueva', r }) },
                  { label: 'Ver intervenciones', onClick: () => setModal({ k: 'ver', r }) },
                  { label: 'Inscripto fuera del distrito', sep: true, hidden: confirmada(r), onClick: () => setModal({ k: 'ext', r }) },
                ]} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pager page={page} total={filas.length} onPage={setPage} />
      {modal?.k === 'nueva' && <NuevaIntervencion r={modal.r} onClose={() => setModal(null)} onDone={lista.reload} />}
      {modal?.k === 'ver' && <VerIntervenciones r={modal.r} onClose={() => setModal(null)} />}
      {modal?.k === 'ext' && <ExternaModal r={modal.r} onClose={() => setModal(null)} onDone={lista.reload} />}
    </>
  )
}

interface Hit { id: number; dni: string; nombre: string; curso: string; origen_nombre: string; estado: 'mine' | 'enrolled' | 'free' }

function Ingresantes({ o }: { o: Origen }) {
  const [ciclo, setCiclo] = useState(Math.min(cicloActual(), ciclosIngreso().slice(-1)[0]))
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [dni, setDni] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const lista = useLista(o, ciclo, 'destino')
  const filas = useMemo(() => {
    const n = norm(q)
    return (lista.data ?? []).filter((r) => !n || norm(`${r.dni} ${r.nombre}`).includes(n))
  }, [lista.data, q])
  const vista = filas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const buscar = async () => {
    const { data, error } = await supabase.rpc('ingresante_buscar', { p_ciclo: ciclo, p_dni: dni })
    if (error) return toast.error(error.message)
    setHits(data as Hit[])
  }
  const asignar = async (h: Hit) => {
    const { error } = await supabase.rpc('ingresante_asignar', { p_id: h.id })
    if (error) return toast.error(error.message)
    toast.ok('Estudiante asignado a tu escuela'); setHits(null); setDni(''); lista.reload()
  }
  const marcar = async (r: Egresante, campo: 'doc_completa' | 'ingresado') => {
    const { error } = await supabase.rpc('ingresante_marcar', { p_id: r.id, p_campo: campo })
    if (error) return toast.error(error.message)
    lista.reload()
  }
  const tabla = async (): Promise<Table> => ({
    title: `Ingresantes · Ciclo ${ciclo}`, subtitle: `${o.nombre} (${o.clave}) · ${filas.length} registros`,
    headers: ['DNI', 'Estudiante', 'Curso de origen', 'Documentación', 'Ingresó'], widths: [10, 30, 12, 16, 10],
    rows: filas.map((r) => [r.dni, r.nombre, r.curso, r.doc_completa ? 'Completa' : 'Pendiente', r.ingresado ? 'Sí' : 'No']),
  })
  return (
    <>
      <Filtros ciclo={ciclo} setCiclo={(n) => { setCiclo(n); setPage(1); setHits(null) }} q={q} setQ={(s) => { setQ(s); setPage(1) }} lista={ciclosIngreso()}>
        <Exportar build={tabla} name={`ingresantes-${o.clave}-${ciclo}`} />
      </Filtros>
      <p class="mb-2 text-xs text-slate-500">Estudiantes egresados en el ciclo {ciclo - 1} con destino a tu escuela.</p>
      <Card title="Buscar estudiante por DNI" class="mb-3">
        <div class="flex gap-2">
          <input class={FIELD} inputMode="numeric" placeholder="DNI" maxLength={9} value={dni} onInput={(e) => setDni(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && buscar()} />
          <button class={BTN_PRIMARY} disabled={!/^\d{6,9}$/.test(dni)} onClick={buscar}>Buscar</button>
        </div>
        {hits && (!hits.length ? <p class="mt-3 text-sm text-slate-500">No hay estudiantes con ese DNI egresados de una escuela de origen.</p> : (
          <ul class="mt-3 space-y-2">{hits.map((h) => (
            <li key={h.id} class="flex items-center gap-3 rounded-md border border-slate-200 p-3 text-sm">
              <div class="flex-1"><p class="font-semibold">{h.nombre}</p><p class="text-xs text-slate-500">DNI {h.dni} · {h.origen_nombre} · Curso {h.curso}</p></div>
              {h.estado === 'free' ? <button class={BTN_PRIMARY} onClick={() => asignar(h)}>Asignar a mi escuela</button>
                : h.estado === 'mine' ? <Badge tone="green">Ya es de tu escuela</Badge> : <Badge tone="amber">Asignado a otra escuela</Badge>}
            </li>
          ))}</ul>
        ))}
      </Card>
      <Card>
        {lista.loading ? <Spinner /> : !filas.length ? <EmptyState title="Sin ingresantes" /> : (
          <ul class="-my-4 divide-y divide-slate-200">{vista.map((r) => (
            <li key={r.id} class="flex flex-wrap items-center gap-3 py-3">
              <div class="min-w-0 flex-1"><p class="font-semibold">{r.nombre}</p><p class="text-xs text-slate-500">DNI {r.dni} · Curso {r.curso}{r.ext_at ? ` · ${fmtFecha(r.ext_at)}` : ''}</p></div>
              <div class="flex gap-2">
                {r.doc_completa ? <Badge tone="green">Documentación completa</Badge> : <button class={BTN_SECONDARY} onClick={() => marcar(r, 'doc_completa')}>Marcar documentación</button>}
                {r.ingresado ? <Badge tone="green">Ingresó</Badge> : <button class={BTN_SECONDARY} onClick={() => marcar(r, 'ingresado')}>Confirmar ingreso</button>}
              </div>
            </li>
          ))}</ul>
        )}
      </Card>
      <Pager page={page} total={filas.length} onPage={setPage} />
    </>
  )
}
