import { useState } from 'preact/hooks'
import { supabase, check } from '../../lib/supabase'
import { useAsync } from '../../lib/hooks'
import { setParams, useRoute } from '../../lib/router'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, RowMenu, Spinner, confirmar, toast } from '../../ui/kit'
import { Icon } from '../../ui/Icon'
import { FormCarga, MESES, VistaCarga, bajarCarga, cargaFilas, fdia, hoyAR, nombrePeriodo, type Periodo } from './common'

type Estado = 'activo' | 'programado' | 'vencido' | 'finalizado'
const estadoDe = (p: Periodo, hoy: string): Estado => (!p.carga ? 'finalizado' : hoy < p.fecha_apertura ? 'programado' : hoy > p.fecha_cierre ? 'vencido' : 'activo')
const ESTADO: Record<Estado, [string, string]> = {
  activo: ['Período activo', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  programado: ['Programado', 'bg-sky-50 text-sky-700 ring-sky-200'],
  vencido: ['Cerrado por fecha', 'bg-slate-100 text-slate-600 ring-slate-200'],
  finalizado: ['Finalizado', 'bg-slate-100 text-slate-600 ring-slate-200'],
}

interface Esc { id: number; clave: string; cue: string; codigo: string | null; numero: number | null; nombre: string | null; localidad: string | null }
interface Carga { id: number; escuela_id: number; ciclo: number; mes: number; habilitada: boolean; confirmada_at: string | null }
interface Grupo { id: number; nombre: string; codigos: string[] }
interface Datos { periodos: Periodo[]; grupos: Grupo[]; escuelas: Esc[]; cargas: Carga[] }
const num = (e: Esc) => `${e.codigo ?? ''} ${e.numero ?? ''}`.trim()
const TAMANOS = [15, 30, 50, 100]

export function Matriculas() {
  const { params } = useRoute()
  const ver = Number(params.get('ver')) || 0
  const edit = Number(params.get('edit')) || 0
  const { data, error, loading, reload } = useAsync<Datos>(async () => {
    const [ps, gs, cs, es, ks] = await Promise.all([
      supabase.from('carga_activa').select('id,ciclo,mes,fecha_apertura,fecha_cierre,carga').order('ciclo', { ascending: false }).order('mes', { ascending: false }),
      supabase.from('agrupamientos_matricula').select('id,nombre').order('nombre'),
      supabase.from('agrupamiento_codigos').select('agrupamiento_id,codigo'),
      supabase.from('escuelas').select('id,clave,cue,codigo,numero,nombre,localidad').order('clave').order('cue'),
      supabase.from('matricula_cargas').select('id,escuela_id,ciclo,mes,habilitada,confirmada_at'),
    ])
    const cods = check(cs)
    const todas = check(es) as Esc[]
    const min = new Map<string, number>()
    for (const e of todas) min.set(e.cue, Math.min(min.get(e.cue) ?? Infinity, e.id))
    return {
      periodos: check(ps) as Periodo[],
      grupos: check(gs).map((g) => ({ ...g, codigos: cods.filter((c) => c.agrupamiento_id === g.id).map((c) => c.codigo) })),
      escuelas: todas.filter((e) => min.get(e.cue) === e.id),
      cargas: check(ks) as Carga[],
    }
  })

  if (ver) return <VistaCarga cargaId={ver} volver={() => setParams({ ver: null })} />
  if (loading && !data) return <Spinner />
  if (error || !data) return <Alert tone="error">{error}</Alert>
  const per = data.periodos.find((p) => String(p.id) === params.get('periodo')) ?? data.periodos[0]
  if (edit && per) return <Editar escuela={data.escuelas.find((e) => e.id === edit)} per={per} onDone={() => { setParams({ edit: null }); reload() }} />
  return <Listado d={data} per={per} reload={reload} />
}

function Editar({ escuela, per, onDone }: { escuela?: Esc; per: Periodo; onDone(): void }) {
  if (!escuela) return <Alert tone="error">Escuela no encontrada</Alert>
  return (
    <>
      <button class="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline" onClick={() => setParams({ edit: null })}>← Volver</button>
      <PageHeader title={`Matrícula ${nombrePeriodo(per)}`} subtitle={`${num(escuela)} · ${escuela.nombre ?? ''} · Clave ${escuela.clave}`} />
      <FormCarga escuelaId={escuela.id} ciclo={per.ciclo} mes={per.mes} editable clave={escuela.clave} onSaved={onDone} />
    </>
  )
}

function Listado({ d, per, reload }: { d: Datos; per?: Periodo; reload(): void }) {
  const { params } = useRoute()
  const hoy = hoyAR()
  const [nuevo, setNuevo] = useState(false)
  const [mover, setMover] = useState<{ modo: 'copiar' | 'mover'; carga: Carga; esc: Esc } | null>(null)
  const { grupos, periodos, cargas } = d
  const grupo = grupos.find((g) => String(g.id) === params.get('grupo')) ?? grupos[0]
  const lim = TAMANOS.includes(Number(params.get('n'))) ? Number(params.get('n')) : 0
  const page = Math.max(1, Number(params.get('page')) || 1)

  const head = (body: any) => (
    <>
      <PageHeader title="Matrícula" subtitle="Estado de carga por agrupamiento" actions={<button class={BTN_PRIMARY} onClick={() => setNuevo(true)}><Icon name="plus" class="size-5" />Nuevo período</button>} />
      {body}
      {nuevo && <NuevoPeriodo existentes={periodos} onClose={() => setNuevo(false)} onDone={() => { setNuevo(false); reload() }} />}
    </>
  )
  if (!per) return head(<Card><EmptyState title="Sin períodos de carga" text="Creá un período para comenzar." /></Card>)
  if (!grupo) return head(<Card><EmptyState title="Sin agrupamientos" text="El administrador debe crear agrupamientos de matrícula." /></Card>)

  const est = estadoDe(per, hoy)
  const kDe = (e: Esc, p: Periodo) => cargas.find((k) => k.escuela_id === e.id && k.ciclo === p.ciclo && k.mes === p.mes)
  const deGrupo = (g: Grupo) => d.escuelas.filter((e) => e.codigo && g.codigos.includes(e.codigo))
  const resumen = (g: Grupo) => { const es = deGrupo(g); return { total: es.length, cargadas: es.filter((e) => kDe(e, per)?.confirmada_at).length } }
  const rows = deGrupo(grupo)
  const size = lim || Math.max(rows.length, 1)
  const lista = rows.slice((page - 1) * size, page * size)

  const finalizar = async (on: boolean) => {
    if (!(await confirmar(on ? 'Reactivar período' : 'Finalizar período', { text: on ? `Se reactiva ${nombrePeriodo(per)}.` : `Las escuelas ya no podrán cargar ${nombrePeriodo(per)}, salvo habilitación puntual.`, ok: on ? 'Reactivar' : 'Finalizar', danger: !on }))) return
    const { error } = await supabase.from('carga_activa').update({ carga: on }).eq('id', per.id)
    if (error) return toast.error(error.message)
    toast.ok(on ? 'Período reactivado' : 'Período finalizado')
    reload()
  }
  const habilitar = async (e: Esc) => {
    const { data: on, error } = await supabase.rpc('matricula_habilitar', { p_escuela: e.id, p_ciclo: per.ciclo, p_mes: per.mes })
    if (error) return toast.error(error.message)
    toast.ok(on ? 'Edición activada para la escuela' : 'Edición desactivada')
    reload()
  }
  const eliminar = async (e: Esc, k: Carga) => {
    if (!(await confirmar('Eliminar carga', { text: `Se elimina la carga de ${num(e)} en ${nombrePeriodo(per)}. No se puede deshacer.`, ok: 'Eliminar', danger: true }))) return
    const { error } = await supabase.rpc('matricula_eliminar', { p_carga: k.id })
    if (error) return toast.error(error.message)
    toast.ok('Carga eliminada')
    reload()
  }
  const bajar = async (e: Esc, k: Carga, t: 'xlsx' | 'pdf') => bajarCarga(t, await cargaFilas(k.id), k, e.clave, k.confirmada_at)

  const Acc = ({ e }: { e: Esc }) => {
    const k = kDe(e, per)
    const c = !!k?.confirmada_at
    return (
      <RowMenu items={[
        { label: 'Ver carga', icon: 'eye', hidden: !c, onClick: () => setParams({ ver: k!.id }) },
        { label: 'Descargar Excel', icon: 'download', hidden: !c, onClick: () => bajar(e, k!, 'xlsx') },
        { label: 'Descargar PDF', icon: 'download', hidden: !c, onClick: () => bajar(e, k!, 'pdf') },
        { label: k?.habilitada ? 'Desactivar edición' : 'Activar edición', icon: 'unlock', sep: c, onClick: () => habilitar(e) },
        { label: c ? 'Editar carga' : 'Cargar matrícula', icon: 'edit', onClick: () => setParams({ edit: e.id }) },
        { label: 'Copiar carga en otro período', icon: 'copy', hidden: !c, sep: true, onClick: () => setMover({ modo: 'copiar', carga: k!, esc: e }) },
        { label: 'Mover carga a otro período', icon: 'move', hidden: !c, onClick: () => setMover({ modo: 'mover', carga: k!, esc: e }) },
        { label: 'Eliminar carga', icon: 'trash', danger: true, hidden: !c, sep: true, onClick: () => eliminar(e, k!) },
      ]} />
    )
  }
  const Est = ({ e }: { e: Esc }) => {
    const k = kDe(e, per)
    return <>{k?.confirmada_at ? <span class="text-emerald-700">Cargada · {fdia(k.confirmada_at)}</span> : <span class="font-medium text-rose-700">Sin cargar</span>}{k?.habilitada && <span class="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Edición activa</span>}</>
  }

  return head(
    <>
      <div class="grid gap-3 sm:grid-cols-3">
        <Lbl label="Período de carga">
          <select class={FIELD} value={per.id} onChange={(e) => setParams({ periodo: e.currentTarget.value, page: null })}>
            {periodos.map((p) => <option key={p.id} value={p.id}>{nombrePeriodo(p)} · {fdia(p.fecha_apertura)} al {fdia(p.fecha_cierre)}{p.id === periodos[0].id ? ' (último)' : ''}</option>)}
          </select>
        </Lbl>
        <Lbl label="Agrupamiento">
          <select class={FIELD} value={grupo.id} onChange={(e) => setParams({ grupo: e.currentTarget.value, page: null })}>
            {grupos.map((g) => { const r = resumen(g); return <option key={g.id} value={g.id}>{g.nombre} ({r.cargadas}/{r.total})</option> })}
          </select>
        </Lbl>
        <Lbl label="Registros a mostrar">
          <select class={FIELD} value={lim} onChange={(e) => setParams({ n: e.currentTarget.value === '0' ? null : e.currentTarget.value, page: null })}>
            <option value={0}>Todos</option>{TAMANOS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Lbl>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-slate-200 bg-white p-3 text-sm">
        <span class={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ' + ESTADO[est][1]}>
          {est === 'activo' && <span class="size-2 animate-pulse rounded-full bg-emerald-500" />}{ESTADO[est][0]}
        </span>
        <span class="text-slate-600">{fdia(per.fecha_apertura)} al {fdia(per.fecha_cierre)}</span>
        {(est === 'activo' || est === 'programado') && <button class="ml-auto min-h-9 rounded-md border border-rose-300 px-3 text-xs font-medium text-rose-700 hover:bg-rose-50" onClick={() => finalizar(false)}>Finalizar período</button>}
        {est === 'finalizado' && hoy <= per.fecha_cierre && <button class="ml-auto min-h-9 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => finalizar(true)}>Reactivar período</button>}
      </div>
      <h2 class="mt-4 text-lg font-semibold text-slate-900">{grupo.nombre}</h2>
      <Card class="mt-2">
        {!rows.length ? <EmptyState title="Sin escuelas" text="Este agrupamiento no tiene escuelas con sus códigos." /> : (
          <>
            <div class="-m-4 hidden overflow-x-auto md:block">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Clave', 'CUE', 'Escuela', 'Nombre', 'Estado de carga', ''].map((h) => <th key={h} class="px-3 py-2">{h}</th>)}</tr></thead>
                <tbody class="divide-y divide-slate-100">
                  {lista.map((e) => (
                    <tr key={e.id} class={kDe(e, per)?.confirmada_at ? 'hover:bg-slate-50' : 'bg-rose-50 hover:bg-rose-100/60'}>
                      <td class="px-3 py-2.5 font-medium text-slate-900">{e.clave}</td><td class="px-3 py-2.5">{e.cue}</td><td class="px-3 py-2.5 font-medium">{num(e)}</td>
                      <td class="px-3 py-2.5">{e.nombre}<span class="block text-xs text-slate-500">{e.localidad}</span></td>
                      <td class="px-3 py-2.5 text-xs"><Est e={e} /></td><td class="px-3 py-2.5"><Acc e={e} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul class="-my-4 divide-y divide-slate-200 md:hidden">
              {lista.map((e) => (
                <li key={e.id} class={'space-y-0.5 py-3 ' + (kDe(e, per)?.confirmada_at ? '' : '-mx-4 bg-rose-50 px-4')}>
                  <div class="flex items-start justify-between gap-2"><p class="font-semibold">{num(e)} <span class="font-normal text-slate-500">· {e.nombre}</span></p><Acc e={e} /></div>
                  <p class="text-xs text-slate-500">Clave {e.clave} · CUE {e.cue}</p>
                  <p class="text-xs"><Est e={e} /></p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {lim ? <Pager page={page} size={lim} total={rows.length} onPage={(p) => setParams({ page: p > 1 ? p : null })} /> : <p class="mt-3 text-sm text-slate-600">{rows.length} {rows.length === 1 ? 'registro' : 'registros'}</p>}
      {mover && <Trasladar {...mover} periodos={periodos} cargas={cargas} onClose={() => setMover(null)} onDone={() => { setMover(null); reload() }} />}
    </>,
  )
}

function NuevoPeriodo({ existentes, onClose, onDone }: { existentes: Periodo[]; onClose(): void; onDone(): void }) {
  const hoy = hoyAR()
  const [f, setF] = useState({ mes: Number(hoy.slice(5, 7)), ciclo: Number(hoy.slice(0, 4)), ini: '', fin: '' })
  const [busy, setBusy] = useState(false)
  const crear = async (ev: Event) => {
    ev.preventDefault()
    if (!f.ini || !f.fin) return toast.error('Completá las fechas de apertura y cierre')
    if (f.ini > f.fin) return toast.error('La apertura debe ser anterior o igual al cierre')
    if (existentes.some((p) => p.ciclo === f.ciclo && p.mes === f.mes)) return toast.error(`Ya existe un período para ${MESES[f.mes]} ${f.ciclo}`)
    setBusy(true)
    const { error } = await supabase.from('carga_activa').insert({ ciclo: f.ciclo, mes: f.mes, fecha_apertura: f.ini, fecha_cierre: f.fin, carga: true })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.ok('Período creado')
    onDone()
  }
  return (
    <Modal title="Nuevo período de carga" onClose={onClose}>
      <form class="space-y-4" onSubmit={crear} autocomplete="off">
        <div class="grid grid-cols-2 gap-3">
          <Lbl label="Mes"><select class={FIELD} value={f.mes} onChange={(e) => setF({ ...f, mes: Number(e.currentTarget.value) })}>{MESES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Lbl>
          <Lbl label="Ciclo lectivo"><input class={FIELD} type="number" min={2020} max={2100} value={f.ciclo} onInput={(e) => setF({ ...f, ciclo: Number(e.currentTarget.value) })} /></Lbl>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <Lbl label="Fecha de apertura"><input class={FIELD} type="date" required value={f.ini} onInput={(e) => setF({ ...f, ini: e.currentTarget.value })} /></Lbl>
          <Lbl label="Fecha de cierre"><input class={FIELD} type="date" required value={f.fin} onInput={(e) => setF({ ...f, fin: e.currentTarget.value })} /></Lbl>
        </div>
        <p class="text-xs text-slate-500">El período se inicia automáticamente en la fecha de apertura y se cierra al llegar la fecha de cierre.</p>
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy}>Crear período</button></div>
      </form>
    </Modal>
  )
}

function Trasladar({ modo, carga, esc, periodos, cargas, onClose, onDone }: { modo: 'copiar' | 'mover'; carga: Carga; esc: Esc; periodos: Periodo[]; cargas: Carga[]; onClose(): void; onDone(): void }) {
  const libres = periodos.filter((p) => !(p.ciclo === carga.ciclo && p.mes === carga.mes) && !cargas.some((k) => k.escuela_id === esc.id && k.ciclo === p.ciclo && k.mes === p.mes && k.confirmada_at))
  const [dest, setDest] = useState(libres[0]?.id ?? 0)
  const [busy, setBusy] = useState(false)
  const ok = async (ev: Event) => {
    ev.preventDefault()
    const p = periodos.find((x) => x.id === dest)
    if (!p) return
    setBusy(true)
    const { error } = await supabase.rpc('matricula_trasladar', { p_carga: carga.id, p_ciclo: p.ciclo, p_mes: p.mes, p_mover: modo === 'mover' })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.ok(modo === 'mover' ? 'Carga movida' : 'Carga copiada')
    onDone()
  }
  return (
    <Modal title={modo === 'mover' ? 'Mover carga a otro período' : 'Copiar carga en otro período'} onClose={onClose}>
      <form class="space-y-4" onSubmit={ok}>
        <p class="text-sm text-slate-600">{num(esc)} · {nombrePeriodo(carga)}</p>
        {libres.length ? (
          <Lbl label="Período de destino"><select class={FIELD} value={dest} onChange={(e) => setDest(Number(e.currentTarget.value))}>{libres.map((p) => <option key={p.id} value={p.id}>{nombrePeriodo(p)} · {fdia(p.fecha_apertura)} al {fdia(p.fecha_cierre)}</option>)}</select></Lbl>
        ) : <Alert tone="warning">La escuela ya tiene carga en todos los períodos.</Alert>}
        <p class="text-xs text-slate-500">Solo se pueden elegir períodos en los que la escuela no tiene carga.</p>
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy || !libres.length}>Aceptar</button></div>
      </form>
    </Modal>
  )
}
