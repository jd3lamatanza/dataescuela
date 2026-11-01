import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useAsync, useDebounced } from '../../lib/hooks'
import type { Table } from '../../lib/export'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, confirmar, EmptyState, FIELD, Modal, PageHeader, Pager, PAGE_SIZE, RowMenu, Spinner, toast, TabBar } from '../../ui/kit'
import {
  ARTICULACION_CODIGOS, ciclos, cicloActual, confirmada, destinoTxt, DestinoFields, EstadoBadge, estadoTxt, Exportar, ExternaModal, limpiarBusqueda,
  NuevaIntervencion, puedeEgresar, puedeIngresar, VerIntervenciones, type Egresante,
} from './common'

interface Resumen { clave: string; nombre: string; cue: string; codigo: string; eg_total: number; eg_conf: number; ing_total: number; ing_conf: number }

/** Vista de supervisión: areal (sus escuelas), distrital (todas) y regional (solo lectura). La RLS limita lo visible. */
export function ArticulacionSupervision() {
  const { user } = useAuth()
  const [tab, setTab] = useState('trayectorias')
  const rol = user?.role
  return (
    <>
      <PageHeader title="Articulación" subtitle={rol === 'areal' ? 'Escuelas asignadas a tu área' : rol === 'regional' ? 'Vista regional' : 'Vista distrital'} />
      <TabBar items={[{ id: 'trayectorias', label: 'Trayectorias', icon: 'route', color: 'violet' }, { id: 'escuelas', label: 'Escuelas', icon: 'school', color: 'sky' }]} active={tab} onChange={setTab} />
      {tab === 'trayectorias' ? <ListaTrayectorias rol={rol} /> : <EscuelasResumen />}
    </>
  )
}

function EscuelasResumen() {
  const [ciclo, setCiclo] = useState(cicloActual())
  const [codigo, setCodigo] = useState('')
  const [estado, setEstado] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const { data, loading, error } = useAsync(async () => {
    const r = await supabase.rpc('articulacion_resumen', { p_ciclo: ciclo })
    if (r.error) throw r.error
    return r.data as Resumen[]
  }, [ciclo])
  const filas = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (data ?? []).filter((r) => (!codigo || r.codigo === codigo) && (!estado || (r.eg_total + r.ing_total > 0) === (estado === 'con')) &&
      (!n || `${r.clave} ${r.nombre} ${r.cue}`.toLowerCase().includes(n)))
  }, [data, codigo, estado, q])
  const con = (data ?? []).filter((r) => r.eg_total + r.ing_total > 0).length
  const Cell = ({ n, c, ok }: { n: number; c: number; ok: boolean }) => !ok ? <span class="text-slate-300">—</span> : <Badge tone={n ? 'green' : 'red'}>{n} ({c} conf.)</Badge>
  const tabla = async (): Promise<Table> => ({
    title: `Articulación por escuela · Ciclo ${ciclo}`, subtitle: `${filas.length} escuelas`,
    headers: ['Clave', 'Escuela', 'CUE', 'Egresantes', 'Egr. confirmados', 'Ingresantes', 'Ing. confirmados'], widths: [10, 34, 10, 10, 10, 10, 10],
    rows: filas.map((r) => [r.clave, r.nombre, r.cue ?? '', puedeEgresar(r.codigo) ? String(r.eg_total) : '—', puedeEgresar(r.codigo) ? String(r.eg_conf) : '—', puedeIngresar(r.codigo) ? String(r.ing_total) : '—', puedeIngresar(r.codigo) ? String(r.ing_conf) : '—']),
  })
  return (
    <>
      <div class="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_1fr_auto_auto_auto]">
        <select class={FIELD + ' lg:w-40'} aria-label="Ciclo" value={ciclo} onChange={(e) => { setCiclo(Number(e.currentTarget.value)); setPage(1) }}>{ciclos().slice().reverse().map((y) => <option key={y} value={y}>Ciclo {y}</option>)}</select>
        <input type="search" class={FIELD} placeholder="Escuela, clave o CUE" value={q} maxLength={80} onInput={(e) => { setQ(e.currentTarget.value); setPage(1) }} aria-label="Buscar" />
        <select class={FIELD} aria-label="Nivel" value={codigo} onChange={(e) => { setCodigo(e.currentTarget.value); setPage(1) }}><option value="">Todos los niveles</option>{ARTICULACION_CODIGOS.map((k) => <option key={k}>{k}</option>)}</select>
        <select class={FIELD} aria-label="Registros" value={estado} onChange={(e) => { setEstado(e.currentTarget.value); setPage(1) }}><option value="">Registros: todos</option><option value="con">Con registros</option><option value="sin">Sin registros</option></select>
        <Exportar build={tabla} name={`articulacion-escuelas-${ciclo}`} />
      </div>
      <p class="mb-2 text-xs text-slate-500">Ingresantes = egresados del ciclo {ciclo - 1} · <b class="text-emerald-700">{con} con registros</b> · <b class="text-rose-700">{(data?.length ?? 0) - con} sin registros</b></p>
      <Card>
        {loading ? <Spinner /> : error ? <Alert tone="error">{error}</Alert> : !filas.length ? <EmptyState title="Sin resultados" /> : (
          <div class="-m-4 overflow-x-auto"><table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-3 py-2">Clave</th><th class="px-3 py-2">Escuela</th><th class="px-3 py-2">Egresantes</th><th class="px-3 py-2">Ingresantes</th></tr></thead>
            <tbody class="divide-y divide-slate-100">{filas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => (
              <tr key={r.clave} class="hover:bg-slate-50">
                <td class="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{r.clave}</td>
                <td class="px-3 py-2.5 font-medium">{r.nombre}<span class="block text-xs font-normal text-slate-400">CUE {r.cue}</span></td>
                <td class="px-3 py-2.5"><Cell n={r.eg_total} c={r.eg_conf} ok={puedeEgresar(r.codigo)} /></td>
                <td class="px-3 py-2.5"><Cell n={r.ing_total} c={r.ing_conf} ok={puedeIngresar(r.codigo)} /></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      <Pager page={page} total={filas.length} onPage={setPage} />
    </>
  )
}

const ORDEN: Record<string, string> = { reciente: 'Ciclo (más reciente)', nombre: 'Estudiante (A-Z)', dni: 'DNI', escuela: 'Escuela de origen', estado: 'Estado (pendientes primero)' }

function ListaTrayectorias({ rol }: { rol?: string }) {
  const [ciclo, setCiclo] = useState(0)
  const [codigo, setCodigo] = useState('')
  const [estado, setEstado] = useState('')
  const [orden, setOrden] = useState('reciente')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ k: 'nueva' | 'ver' | 'ext' | 'dest'; r: Egresante } | null>(null)
  const nombres = useAsync(async () => {
    const r = await supabase.rpc('articulacion_resumen', { p_ciclo: cicloActual() })
    return new Map(((r.data ?? []) as Resumen[]).map((x) => [x.clave, x.nombre]))
  })

  const consulta = (count: boolean) => {
    let s = supabase.from('egresantes').select('*', count ? { count: 'exact' } : undefined)
    if (ciclo) s = s.eq('ciclo', ciclo)
    if (codigo) s = s.eq('origen_codigo', codigo)
    if (estado === 'pend') s = s.eq('ingresado', false).is('ext_escuela', null)
    if (estado === 'conf') s = s.or('ingresado.eq.true,ext_escuela.not.is.null')
    const t = limpiarBusqueda(dq)
    if (t) s = s.or(['dni', 'nombre', 'curso', 'destino_nombre', 'ext_escuela', 'origen_clave', 'origen_cue'].map((k) => `${k}.ilike.%${t}%`).join(','))
    if (orden === 'nombre') s = s.order('nombre')
    else if (orden === 'dni') s = s.order('dni')
    else if (orden === 'escuela') s = s.order('origen_clave').order('nombre')
    else if (orden === 'estado') s = s.order('ingresado').order('ciclo', { ascending: false }).order('nombre')
    else s = s.order('ciclo', { ascending: false }).order('origen_clave').order('nombre')
    return s
  }
  const lista = useAsync(async () => {
    const r = await consulta(true).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (r.error) throw r.error
    return { rows: r.data as Egresante[], total: r.count ?? 0 }
  }, [ciclo, codigo, estado, orden, dq, page])
  const pend = useAsync(async () => {
    const r = await supabase.from('egresantes').select('id', { count: 'exact', head: true }).eq('ingresado', false).is('ext_escuela', null)
    return r.count ?? 0
  }, [lista.data])

  const nom = (r: Egresante) => nombres.data?.get(r.origen_clave) ?? r.origen_clave
  const tabla = async (): Promise<Table> => {
    const r = await consulta(false).limit(5000)
    if (r.error) throw r.error
    const rows = r.data as Egresante[]
    return {
      title: 'Trayectorias', subtitle: `${ciclo ? `Ciclo ${ciclo}` : 'Todos los ciclos'}${codigo ? ` · Nivel ${codigo}` : ''} · ${rows.length} registros`,
      headers: ['Ciclo', 'DNI', 'Estudiante', 'Curso', 'Escuela de origen', 'Escuela destino', 'Estado'], widths: [6, 10, 24, 7, 28, 28, 14],
      rows: rows.map((x) => [String(x.ciclo), x.dni, x.nombre, x.curso, `${nom(x)} (${x.origen_clave})`, destinoTxt(x) || 'Sin completar', estadoTxt(x)]),
    }
  }
  const eliminar = async (r: Egresante) => {
    if (!(await confirmar('Eliminar registro', { text: `${r.nombre} (DNI ${r.dni}) y sus intervenciones.`, ok: 'Eliminar', danger: true }))) return
    const { error } = await supabase.rpc('distrito_eliminar_egresante', { p_id: r.id })
    if (error) return toast.error(error.message)
    toast.ok('Registro eliminado'); lista.reload()
  }
  const rows = lista.data?.rows ?? []
  const puedeActuar = rol === 'distrital' || rol === 'areal'
  return (
    <>
      <p class="mb-2 text-sm text-slate-600">{pend.data ? <><Badge tone="red">{pend.data}</Badge> trayectorias pendientes de inscripción.</> : 'No hay trayectorias pendientes.'} <span class="text-slate-400">· {lista.data?.total ?? 0} en el listado</span></p>
      <div class="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto_auto]">
        <input type="search" class={FIELD} placeholder="DNI, estudiante, escuela, CUE o curso" value={q} maxLength={80} onInput={(e) => { setQ(e.currentTarget.value); setPage(1) }} aria-label="Buscar" />
        <select class={FIELD} aria-label="Ciclo" value={ciclo} onChange={(e) => { setCiclo(Number(e.currentTarget.value)); setPage(1) }}><option value="0">Todos los ciclos</option>{ciclos().slice().reverse().map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <select class={FIELD} aria-label="Nivel" value={codigo} onChange={(e) => { setCodigo(e.currentTarget.value); setPage(1) }}><option value="">Todos los niveles</option>{ARTICULACION_CODIGOS.filter(puedeEgresar).map((k) => <option key={k}>{k}</option>)}</select>
        <select class={FIELD} aria-label="Estado" value={estado} onChange={(e) => { setEstado(e.currentTarget.value); setPage(1) }}><option value="">Estado: todos</option><option value="pend">Pendientes</option><option value="conf">Confirmados</option></select>
        <select class={FIELD} aria-label="Orden" value={orden} onChange={(e) => setOrden(e.currentTarget.value)}>{Object.entries(ORDEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <Exportar build={tabla} name="trayectorias" />
      </div>
      <Card>
        {lista.loading ? <Spinner /> : lista.error ? <Alert tone="error">{lista.error}</Alert> : !rows.length ? <EmptyState title="Sin trayectorias" text="Probá con otros filtros." /> : (
          <ul class="-my-4 divide-y divide-slate-200">{rows.map((r) => (
            <li key={r.id} class="flex items-start gap-3 py-3">
              <span class={`mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${confirmada(r) ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>{confirmada(r) ? '✓' : '✗'}</span>
              <div class="min-w-0 flex-1">
                <p class="font-semibold">{r.nombre}</p>
                <p class="text-xs text-slate-500">DNI {r.dni} · Curso {r.curso} · Ciclo {r.ciclo}</p>
                <p class="mt-1 text-xs text-slate-600"><span class="font-medium">Origen:</span> {nom(r)} ({r.origen_clave})</p>
                <p class="text-xs text-slate-600"><span class="font-medium">Destino:</span> {destinoTxt(r) || 'Sin completar'}</p>
                <div class="mt-1"><EstadoBadge r={r} /></div>
              </div>
              {puedeActuar && <RowMenu items={[
                { label: 'Agregar intervención', onClick: () => setModal({ k: 'nueva', r }) },
                { label: 'Ver intervenciones', onClick: () => setModal({ k: 'ver', r }) },
                { label: 'Confirmar inscripción en escuela destino', sep: true, hidden: rol !== 'distrital' || confirmada(r), onClick: () => setModal({ k: 'dest', r }) },
                { label: 'Confirmar inscripción fuera de la distrital', hidden: confirmada(r), onClick: () => setModal({ k: 'ext', r }) },
                { label: 'Eliminar registro', danger: true, sep: true, hidden: rol !== 'distrital', onClick: () => eliminar(r) },
              ]} />}
            </li>
          ))}</ul>
        )}
      </Card>
      <Pager page={page} total={lista.data?.total ?? 0} onPage={setPage} />
      {modal?.k === 'nueva' && <NuevaIntervencion r={modal.r} onClose={() => setModal(null)} onDone={lista.reload} />}
      {modal?.k === 'ver' && <VerIntervenciones r={modal.r} onClose={() => setModal(null)} />}
      {modal?.k === 'ext' && <ExternaModal r={modal.r} onClose={() => setModal(null)} onDone={lista.reload} />}
      {modal?.k === 'dest' && <ConfirmarDestino r={modal.r} onClose={() => setModal(null)} onDone={lista.reload} />}
    </>
  )
}

function ConfirmarDestino({ r, onClose, onDone }: { r: Egresante; onClose(): void; onDone(): void }) {
  const [destino, setDestino] = useState(r.destino_manual ? '' : r.destino_clave ?? '')
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('distrito_confirmar_destino', { p_id: r.id, p_destino: destino, p_nombre: nombre })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.ok('Inscripción confirmada'); onDone(); onClose()
  }
  return (
    <Modal title="Confirmar inscripción en escuela destino" onClose={onClose}>
      <p class="mb-3 text-sm text-slate-600">{r.nombre} · DNI {r.dni}</p>
      <div class="space-y-3"><DestinoFields codigo={r.origen_codigo} destino={destino} nombre={nombre} onDestino={setDestino} onNombre={setNombre} /></div>
      <div class="mt-4 flex justify-end gap-2"><button class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy || !destino} onClick={save}>Confirmar</button></div>
    </Modal>
  )
}
