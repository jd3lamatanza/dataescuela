import { useState } from 'preact/hooks'
import { supabase, check, checkOpt } from '../lib/supabase'
import { useAsync, useDebounced } from '../lib/hooks'
import { setParams, useRoute } from '../lib/router'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Badge, Card, EmptyState, FIELD, PageHeader, Pager, PAGE_SIZE, RowMenu, Spinner, Toggle, confirmar, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { useAuth } from '../lib/auth'

const MAX = 99
export const fmtDia = (s?: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '')

/** Escuela propia (primera escuela del CUE) de la cuenta escolar */
export function useMiEscuela() {
  return useAsync(async () => {
    const id = check(await supabase.rpc('mi_escuela'))
    if (!id) throw new Error('Tu cuenta no tiene una escuela asociada')
    return Number(id)
  })
}

interface Datos {
  esc: { id: number; clave: string; nivel: string | null; modalidad: string | null }
  planta: { id: number; editable: boolean; total_secciones: number; confirmada_at: string } | null
  global: boolean
  turnos: { id: number; nombre: string }[]
  planes: { id: number; nombre: string; cursos: { id: number; nombre: string }[] }[]
  sel: number[]
  cells: { plan_id: number; curso_id: number; turno_id: number; secciones: number }[]
}

async function cargar(escuelaId: number): Promise<Datos> {
  const [e, pl, tu, aj, pe, pc, cat] = await Promise.all([
    supabase.from('escuelas').select('id,clave,nivel,modalidad').eq('id', escuelaId).single(),
    supabase.from('plantas').select('id,editable,total_secciones,confirmada_at').eq('escuela_id', escuelaId).maybeSingle(),
    supabase.from('turnos').select('id,nombre,activo,hora_desde').order('hora_desde').order('nombre'),
    supabase.from('ajustes').select('valor').eq('clave', 'planta_edicion').maybeSingle(),
    supabase.from('planes_estudio').select('id,nombre,activo,nivel_id,modalidad_id').order('nombre'),
    supabase.from('planes_cursos').select('id,plan_id,nombre,orden').order('orden'),
    supabase.from('catalogos').select('id,coleccion,nombre').in('coleccion', ['nivel', 'modalidad']),
  ])
  const esc = check(e); const planta = check(pl)
  const sel = planta ? check(await supabase.from('planta_turnos').select('turno_id').eq('planta_id', planta.id)).map((x) => x.turno_id) : []
  const cells = planta ? check(await supabase.from('planta_secciones').select('plan_id,curso_id,turno_id,secciones').eq('planta_id', planta.id)) : []
  const cats = check(cat)
  const ids = (col: string, nombre: string | null) => cats.filter((c) => c.coleccion === col && c.nombre === nombre).map((c) => c.id)
  const nv = ids('nivel', esc.nivel); const md = ids('modalidad', esc.modalidad)
  const usados = new Set(cells.map((c) => c.plan_id))
  const cursos = check(pc)
  const planes = check(pe)
    .filter((p) => usados.has(p.id) || (p.activo && nv.includes(p.nivel_id as number) && md.includes(p.modalidad_id as number)))
    .map((p) => ({ id: p.id, nombre: p.nombre, cursos: cursos.filter((c) => c.plan_id === p.id).map((c) => ({ id: c.id, nombre: c.nombre })) }))
  const turnos = check(tu).filter((t) => t.activo || sel.includes(t.id)).map((t) => ({ id: t.id, nombre: t.nombre }))
  return { esc, planta, global: aj.data?.valor === '1', turnos, planes, sel, cells }
}

/** Planta de una escuela: editor o vista bloqueada, según corresponda */
export function PlantaPanel({ escuelaId, volver }: { escuelaId: number; volver?: () => void }) {
  const { data, error, loading, reload } = useAsync(() => cargar(escuelaId), [escuelaId])
  if (loading && !data) return <Spinner />
  if (error || !data) return <Alert tone="error">{error ?? 'No se pudo cargar'}</Alert>
  const bloqueada = !!data.planta && !data.planta.editable && !data.global
  return (
    <>
      {volver && <button class="mb-1 inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline" onClick={volver}>← Plantas</button>}
      <PageHeader title={volver ? `Planta de ${data.esc.clave}` : 'Mi Planta'} subtitle={`${data.esc.clave} · ${[data.esc.nivel, data.esc.modalidad].filter(Boolean).join(' · ')}`} />
      {bloqueada ? <Bloqueada d={data} propia={!volver} /> : <Editor key={String(data.planta?.confirmada_at)} d={data} onSaved={reload} />}
    </>
  )
}

function Bloqueada({ d, propia }: { d: Datos; propia: boolean }) {
  const n = (c: number, t: number) => d.cells.find((x) => x.curso_id === c && x.turno_id === t)?.secciones ?? 0
  const planes = d.planes.filter((p) => d.cells.some((c) => c.plan_id === p.id))
  const turnos = d.turnos.filter((t) => d.sel.includes(t.id))
  return (
    <>
      <div class="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        <Icon name="shield" class="mt-0.5 size-5 shrink-0" />
        <p>Planta confirmada el {fmtDia(d.planta!.confirmada_at)} · <strong>{d.planta!.total_secciones}</strong> secciones. {propia ? 'Para modificarla, el Inspector o la Jefatura debe habilitar la edición.' : 'Podés habilitar la edición desde el listado de Plantas.'}</p>
      </div>
      <div class="mt-4 space-y-4">
        {planes.map((p) => (
          <Card key={p.id} title={`${p.nombre} · Secciones por turno`}>
            <div class="-mx-4 overflow-x-auto px-4">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th class="py-2 pr-3">Curso</th>{turnos.map((t) => <th key={t.id} class="px-3 py-2 text-center">{t.nombre}</th>)}<th class="px-3 py-2 text-center">Total</th></tr></thead>
                <tbody class="divide-y divide-slate-100">
                  {p.cursos.map((c) => (
                    <tr key={c.id}><td class="py-2 pr-3 font-medium">{c.nombre}</td>{turnos.map((t) => <td key={t.id} class="px-3 py-2 text-center">{n(c.id, t.id)}</td>)}<td class="px-3 py-2 text-center font-semibold">{turnos.reduce((a, t) => a + n(c.id, t.id), 0)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
        {planes.length === 0 && <EmptyState title="Sin secciones" />}
      </div>
    </>
  )
}

function Editor({ d, onSaved }: { d: Datos; onSaved(): void }) {
  const [turnos, setTurnos] = useState<Set<number>>(new Set(d.sel))
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries(d.cells.map((c) => [`${c.curso_id}:${c.turno_id}`, c.secciones])))
  const [agregados, setAgregados] = useState<number[]>(() => d.planes.filter((p) => d.cells.some((c) => c.plan_id === p.id)).map((p) => p.id))
  const [nuevo, setNuevo] = useState('')
  const [saving, setSaving] = useState(false)

  const activos = d.turnos.filter((t) => turnos.has(t.id))
  const n = (c: number, t: number) => vals[`${c}:${t}`] || 0
  const totalPlan = (p: Datos['planes'][number]) => p.cursos.reduce((a, c) => a + activos.reduce((b, t) => b + n(c.id, t.id), 0), 0)
  const planes = agregados.map((id) => d.planes.find((p) => p.id === id)!).filter(Boolean)
  const total = planes.reduce((a, p) => a + totalPlan(p), 0)
  const disp = d.planes.filter((p) => !agregados.includes(p.id))

  const guardar = async () => {
    if (!turnos.size) return toast.error('Seleccioná al menos un turno')
    if (!planes.length) return toast.error('Agregá al menos un plan de estudio')
    if (total < 1) return toast.error('Cargá al menos una sección')
    if (!(await confirmar('Verificá el total', { text: `Cargaste ${total} secciones en total. ¿Es el total de las secciones de la escuela?`, ok: 'Sí, es el total' }))) return toast.info('Revisá la información cargada')
    if (!(await confirmar('Advertencia', { text: 'Una vez cargada la planta no se puede modificar. Solo el Inspector o la Jefatura pueden habilitar la edición.', ok: 'Confirmar y guardar' }))) return
    setSaving(true)
    const { error } = await supabase.rpc('planta_guardar', {
      p_escuela: d.esc.id, p_total: total, p_turnos: [...turnos],
      p_planes: planes.map((p) => ({ plan_id: p.id, secciones: p.cursos.flatMap((c) => activos.map((t) => ({ curso_id: c.id, turno_id: t.id, n: n(c.id, t.id) }))) })),
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.ok('Planta confirmada')
    onSaved()
  }

  if (!d.turnos.length || !d.planes.length) return <Card class="mt-4"><EmptyState title="Todavía no se puede configurar" text="Faltan turnos activos o planes de estudio para el nivel y la modalidad de la escuela. Consultá con la Jefatura." /></Card>
  return (
    <div class="space-y-4">
      <Card title="1. Turnos de la escuela">
        <p class="-mt-1 mb-3 text-sm text-slate-500">Marcá los turnos en los que funciona la escuela.</p>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {d.turnos.map((t) => (
            <label key={t.id} class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-slate-300 px-3 hover:bg-slate-50">
              <input type="checkbox" class="size-5 rounded border-slate-300 text-blue-600" checked={turnos.has(t.id)}
                onChange={(e) => { const s = new Set(turnos); e.currentTarget.checked ? s.add(t.id) : s.delete(t.id); setTurnos(s) }} />
              <span class="text-sm font-medium">{t.nombre}</span>
            </label>
          ))}
        </div>
      </Card>
      <Card title="2. Planes de estudio y secciones">
        {!turnos.size ? <p class="text-sm text-slate-500">Primero seleccioná al menos un turno.</p> : (
          <>
            <div class="flex flex-col gap-2 sm:flex-row">
              <select class={FIELD + ' sm:max-w-md'} aria-label="Plan de estudio" value={nuevo} onChange={(e) => setNuevo(e.currentTarget.value)}>
                <option value="">{disp.length ? 'Elegí un plan de estudio' : 'No hay más planes disponibles'}</option>
                {disp.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <button type="button" class={BTN_PRIMARY} onClick={() => { if (!nuevo) return toast.error('Elegí un plan de estudio'); setAgregados([...agregados, Number(nuevo)]); setNuevo('') }}>Agregar plan</button>
            </div>
            {planes.map((p) => (
              <div key={p.id} class="mt-4 rounded-md border border-slate-200">
                <div class="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <h3 class="text-sm font-semibold">{p.nombre}</h3>
                  <button type="button" class="min-h-9 text-sm font-medium text-rose-700 hover:underline" onClick={() => setAgregados(agregados.filter((x) => x !== p.id))}>Quitar</button>
                </div>
                <p class="border-b border-slate-200 px-3 py-2 text-sm text-slate-600">Escribí cuántas secciones (divisiones) tiene cada curso en cada turno. Dejá en blanco o en 0 si no hay.</p>
                <div class="overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead class="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th class="px-3 py-2">Curso</th>{activos.map((t) => <th key={t.id} class="px-3 py-2 text-center">{t.nombre}</th>)}<th class="px-3 py-2 text-center">Total</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">
                      {p.cursos.map((c) => (
                        <tr key={c.id}>
                          <td class="whitespace-nowrap px-3 py-2 font-medium">{c.nombre}</td>
                          {activos.map((t) => (
                            <td key={t.id} class="px-2 py-1.5 text-center">
                              <input type="number" min={0} max={MAX} inputMode="numeric" aria-label={`${c.nombre} ${t.nombre}`} class="min-h-11 w-20 rounded-md border border-slate-300 px-2 text-center text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 sm:text-sm"
                                value={vals[`${c.id}:${t.id}`] ?? ''} onInput={(e) => setVals({ ...vals, [`${c.id}:${t.id}`]: Math.min(Math.max(parseInt(e.currentTarget.value, 10) || 0, 0), MAX) })} />
                            </td>
                          ))}
                          <td class="px-3 py-2 text-center font-semibold">{activos.reduce((a, t) => a + n(c.id, t.id), 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div class="flex justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-sm"><span class="text-slate-600">Total de secciones del plan</span><strong>{totalPlan(p)}</strong></div>
              </div>
            ))}
          </>
        )}
      </Card>
      <Card class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-slate-600">Total de secciones: <strong class="text-2xl text-slate-900">{total}</strong></p>
        <button type="button" class={BTN_PRIMARY} disabled={saving} onClick={guardar}>Guardar planta</button>
      </Card>
    </div>
  )
}

/** Escolar: Mi Planta */
export function Planta() {
  const { data, error, loading } = useMiEscuela()
  if (loading) return <Spinner />
  if (error || !data) return <Alert tone="error">{error ?? 'Sin escuela'}</Alert>
  return <PlantaPanel escuelaId={data} />
}

/** Distrital: listado de plantas */
export function Plantas() {
  const { params } = useRoute()
  const { user } = useAuth()
  const ver = Number(params.get('e')) || 0
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q)
  const nivel = params.get('nivel') ?? ''
  const modalidad = params.get('modalidad') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const puede = user?.role === 'distrital' || user?.role === 'admin' || user?.role === 'regional'

  const { data, loading, error, reload } = useAsync(async () => {
    const [es, pl, aj] = await Promise.all([
      supabase.from('escuelas').select('id,clave,cue,codigo,numero,nivel,modalidad,localidad').order('clave').order('numero'),
      supabase.from('plantas').select('escuela_id,editable,total_secciones,confirmada_at'),
      supabase.from('ajustes').select('valor').eq('clave', 'planta_edicion').maybeSingle(),
    ])
    const min = new Map<string, number>()
    for (const e of check(es)) min.set(e.cue, Math.min(min.get(e.cue) ?? Infinity, e.id))
    const plantas = new Map(check(pl).map((p) => [p.escuela_id, p]))
    const rows = check(es).filter((e) => min.get(e.cue) === e.id).map((e) => ({ ...e, planta: plantas.get(e.id) ?? null }))
    return { rows, global: aj.data?.valor === '1' }
  })

  if (ver) return <PlantaPanel escuelaId={ver} volver={() => setParams({ e: null })} />

  const t = dq.trim().toLowerCase()
  const filtradas = (data?.rows ?? []).filter((r) => (!nivel || r.nivel === nivel) && (!modalidad || r.modalidad === modalidad)
    && (!t || [r.clave, r.cue, r.codigo, r.numero, r.nivel, r.modalidad, r.localidad].some((v) => String(v ?? '').toLowerCase().includes(t))))
  const lista = filtradas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const uniq = (k: 'nivel' | 'modalidad') => [...new Set((data?.rows ?? []).map((r) => r[k]).filter(Boolean) as string[])].sort()

  const toggleGlobal = async (v: boolean) => {
    const { error } = await supabase.from('ajustes').update({ valor: v ? '1' : '0' }).eq('clave', 'planta_edicion')
    if (error) return toast.error(error.message)
    toast.ok(v ? 'Edición de plantas habilitada para todas las escuelas' : 'Edición de plantas deshabilitada')
    reload()
  }
  const edicion = async (id: number) => {
    const { data: on, error } = await supabase.rpc('planta_edicion', { p_escuela: id })
    if (error) return toast.error(error.message)
    toast.ok(on ? 'Edición habilitada' : 'Edición deshabilitada')
    reload()
  }
  const Estado = ({ r }: { r: (typeof lista)[number] }) => !r.planta ? <span class="font-semibold text-rose-700">Sin planta</span> : (
    <span class="text-slate-700">{fmtDia(r.planta.confirmada_at)} · {r.planta.total_secciones} secc. {(data!.global || r.planta.editable) && <Badge tone="green">Edición habilitada</Badge>}</span>
  )
  const Acc = ({ r }: { r: (typeof lista)[number] }) => (
    <RowMenu items={[
      { label: r.planta ? 'Ver planta' : 'Crear planta', icon: r.planta ? 'eye' : 'plus', onClick: () => setParams({ e: r.id }) },
      { label: r.planta?.editable ? 'Deshabilitar edición' : 'Habilitar edición', icon: 'edit', hidden: !r.planta || !puede, onClick: () => edicion(r.id) },
    ]} />
  )

  return (
    <>
      <PageHeader title="Plantas" subtitle={`Planta de cada escuela · ${filtradas.length} en el listado`} />
      {puede && (
        <div class="max-w-xl">
          <Toggle checked={!!data?.global} onChange={toggleGlobal} label="Período de carga y edición de plantas (todas las escuelas)" />
          <p class="mt-1 text-xs text-slate-500">Activado: todas las escuelas pueden crear y modificar su planta. Desactivado: solo las que tengan la edición habilitada individualmente.</p>
        </div>
      )}
      <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]">
        <input type="search" class={FIELD} placeholder="Clave, CUE, código, número o localidad" value={q} maxLength={80} aria-label="Buscar" onInput={(e) => { setQ(e.currentTarget.value); setParams({ page: null }) }} />
        <select class={FIELD} aria-label="Nivel" value={nivel} onChange={(e) => setParams({ nivel: e.currentTarget.value, page: null })}><option value="">Todos los niveles</option>{uniq('nivel').map((v) => <option key={v}>{v}</option>)}</select>
        <select class={FIELD} aria-label="Modalidad" value={modalidad} onChange={(e) => setParams({ modalidad: e.currentTarget.value, page: null })}><option value="">Todas las modalidades</option>{uniq('modalidad').map((v) => <option key={v}>{v}</option>)}</select>
        <button class={BTN_SECONDARY} onClick={() => { setQ(''); setParams({ nivel: null, modalidad: null, page: null }) }}>Limpiar</button>
      </div>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      <Card class="mt-3">
        {loading && !data ? <Spinner /> : !lista.length ? <EmptyState title="Sin resultados" text="Probá con otros filtros." /> : (
          <>
            <div class="-m-4 hidden overflow-x-auto md:block">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Clave', 'CUE', 'Nivel', 'Modalidad', 'Planta', ''].map((h) => <th key={h} class="px-3 py-2">{h}</th>)}</tr></thead>
                <tbody class="divide-y divide-slate-100">
                  {lista.map((r) => (
                    <tr key={r.id} class={r.planta ? 'hover:bg-slate-50' : 'bg-rose-50 hover:bg-rose-100/60'}>
                      <td class={'whitespace-nowrap px-3 py-2.5 font-mono text-xs font-medium ' + (r.planta ? '' : 'text-rose-800')}>{r.clave}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{r.cue}</td>
                      <td class="px-3 py-2.5 text-xs">{r.nivel}</td><td class="px-3 py-2.5 text-xs">{r.modalidad}</td>
                      <td class="px-3 py-2.5 text-xs"><Estado r={r} /></td>
                      <td class="px-3 py-2.5"><Acc r={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul class="-my-4 divide-y divide-slate-200 md:hidden">
              {lista.map((r) => (
                <li key={r.id} class={'space-y-0.5 py-3 ' + (r.planta ? '' : '-mx-4 bg-rose-50 px-4')}>
                  <div class="flex items-start justify-between gap-2"><p class={'font-mono text-sm font-semibold ' + (r.planta ? '' : 'text-rose-800')}>{r.clave}</p><Acc r={r} /></div>
                  <p class="text-xs text-slate-600">{[r.nivel, r.modalidad].filter(Boolean).join(' · ')}</p>
                  <p class="text-xs"><Estado r={r} /></p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Pager page={page} total={filtradas.length} onPage={(p) => setParams({ page: p > 1 ? p : null })} />
    </>
  )
}
