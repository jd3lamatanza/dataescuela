import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync, useDebounced } from '../lib/hooks'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, PAGE_SIZE, RowMenu, Spinner, toast } from '../ui/kit'

interface Cat { id: number; nombre: string; activo: boolean }
interface Plan { id: number; nombre: string; cantidad_cursos: number; activo: boolean; nivel_id: number; modalidad_id: number; nivel: { nombre: string }; modalidad: { nombre: string } }

export function Planes() {
  const [q, setQ] = useState('')
  const [nivel, setNivel] = useState('')
  const [modalidad, setModalidad] = useState('')
  const [estado, setEstado] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState<{ plan?: Plan; dup?: boolean } | null>(null)
  const dq = useDebounced(q)

  const cats = useAsync(async () => {
    const r = await supabase.from('catalogos').select('id,nombre,activo,coleccion').in('coleccion', ['nivel', 'modalidad']).order('orden')
    if (r.error) throw r.error
    const d = r.data as (Cat & { coleccion: string })[]
    return { niveles: d.filter((x) => x.coleccion === 'nivel'), modalidades: d.filter((x) => x.coleccion === 'modalidad') }
  })

  const { data, loading, error, reload } = useAsync(async () => {
    let s = supabase.from('planes_estudio').select('id,nombre,cantidad_cursos,activo,nivel_id,modalidad_id,nivel:catalogos!nivel_id(nombre),modalidad:catalogos!modalidad_id(nombre)', { count: 'exact' })
    if (dq.trim()) s = s.ilike('nombre', `%${dq.trim()}%`)
    if (nivel) s = s.eq('nivel_id', Number(nivel))
    if (modalidad) s = s.eq('modalidad_id', Number(modalidad))
    if (estado) s = s.eq('activo', estado === '1')
    const r = await s.order('nombre').range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (r.error) throw r.error
    return { rows: r.data as unknown as Plan[], total: r.count ?? 0 }
  }, [dq, nivel, modalidad, estado, page])

  const toggle = async (p: Plan) => {
    const { error } = await supabase.rpc('plan_estado', { p_id: p.id })
    if (error) return toast.error(error.message)
    toast.ok(p.activo ? 'Plan desactivado' : 'Plan activado'); reload()
  }
  const f = (fn: () => void) => { fn(); setPage(1) }

  return (
    <>
      <PageHeader title="Planes de Estudio" subtitle="Planes por nivel y modalidad, con sus cursos" actions={<button class={BTN_PRIMARY} onClick={() => setForm({})}>Nuevo plan</button>} />
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input type="search" class={FIELD} placeholder="Buscar plan" value={q} onInput={(e) => f(() => setQ(e.currentTarget.value))} aria-label="Buscar" />
        <select class={FIELD} value={nivel} onChange={(e) => f(() => setNivel(e.currentTarget.value))} aria-label="Nivel"><option value="">Todos los niveles</option>{cats.data?.niveles.map((n) => <option value={n.id}>{n.nombre}</option>)}</select>
        <select class={FIELD} value={modalidad} onChange={(e) => f(() => setModalidad(e.currentTarget.value))} aria-label="Modalidad"><option value="">Todas las modalidades</option>{cats.data?.modalidades.map((n) => <option value={n.id}>{n.nombre}</option>)}</select>
        <select class={FIELD} value={estado} onChange={(e) => f(() => setEstado(e.currentTarget.value))} aria-label="Estado"><option value="">Estado: todos</option><option value="1">Activos</option><option value="0">Inactivos</option></select>
      </div>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      <Card class="mt-3">
        {loading && !data ? <Spinner /> : !data?.rows.length ? <EmptyState title="Sin planes" text="Probá con otros filtros o creá uno nuevo." /> : (
          <ul class="-my-4 divide-y divide-slate-100">
            {data.rows.map((p) => (
              <li key={p.id} class="flex items-center justify-between gap-3 py-3">
                <div class="min-w-0">
                  <p class="font-medium text-slate-900">{p.nombre}</p>
                  <p class="text-xs text-slate-500">{p.nivel.nombre} · {p.modalidad.nombre} · {p.cantidad_cursos} cursos</p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <Badge tone={p.activo ? 'green' : 'slate'}>{p.activo ? 'Activo' : 'Inactivo'}</Badge>
                  <RowMenu items={[{ label: 'Editar', onClick: () => setForm({ plan: p }) }, { label: 'Duplicar', onClick: () => setForm({ plan: p, dup: true }) }, { label: p.activo ? 'Desactivar' : 'Activar', onClick: () => toggle(p) }]} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pager page={page} total={data?.total ?? 0} onPage={setPage} />
      {form && cats.data && <PlanForm {...form} cats={cats.data} onClose={() => setForm(null)} onDone={() => { setForm(null); reload() }} />}
    </>
  )
}

function PlanForm({ plan, dup, cats, onClose, onDone }: { plan?: Plan; dup?: boolean; cats: { niveles: Cat[]; modalidades: Cat[] }; onClose(): void; onDone(): void }) {
  const [nombre, setNombre] = useState(plan ? plan.nombre : '')
  const [nivel, setNivel] = useState(plan ? String(plan.nivel_id) : '')
  const [modalidad, setModalidad] = useState(plan ? String(plan.modalidad_id) : '')
  const [cursos, setCursos] = useState<string[]>([])
  const [loaded, setLoaded] = useState(!plan)
  const [err, setErr] = useState<string | null>(null)

  useAsync(async () => {
    if (!plan) return null
    const r = await supabase.from('planes_cursos').select('nombre,orden').eq('plan_id', plan.id).order('orden')
    setCursos((r.data ?? []).map((c) => c.nombre)); setLoaded(true)
    return null
  }, [plan?.id])

  const cant = cursos.length
  const setCant = (n: number) => setCursos(Array.from({ length: Math.min(20, Math.max(0, n)) }, (_, i) => cursos[i] ?? ''))

  const submit = async (e: Event) => {
    e.preventDefault()
    if (dup && plan && nombre.trim().toLowerCase() === plan.nombre.toLowerCase()) return setErr('Para duplicar el plan tenés que cambiar el nombre')
    const { error } = await supabase.rpc('plan_guardar', { p_id: dup ? null : plan?.id ?? null, p_nombre: nombre, p_nivel: Number(nivel), p_modalidad: Number(modalidad), p_cursos: cursos, p_activo: dup ? true : plan?.activo ?? true })
    if (error) return setErr(error.message)
    toast.ok(dup ? 'Plan duplicado' : plan ? 'Plan actualizado' : 'Plan creado'); onDone()
  }

  return (
    <Modal title={dup ? 'Duplicar plan' : plan ? 'Editar plan' : 'Nuevo plan'} onClose={onClose}>
      {!loaded ? <Spinner /> : (
        <form onSubmit={submit} class="space-y-4">
          {err && <Alert tone="error">{err}</Alert>}
          <Lbl label="Nombre"><input class={FIELD} value={nombre} required maxLength={150} onInput={(e) => setNombre(e.currentTarget.value)} /></Lbl>
          <div class="grid gap-3 sm:grid-cols-2">
            <Lbl label="Nivel"><select class={FIELD} required value={nivel} onChange={(e) => setNivel(e.currentTarget.value)}><option value="">Elegir…</option>{cats.niveles.filter((n) => n.activo || String(n.id) === nivel).map((n) => <option value={n.id}>{n.nombre}</option>)}</select></Lbl>
            <Lbl label="Modalidad"><select class={FIELD} required value={modalidad} onChange={(e) => setModalidad(e.currentTarget.value)}><option value="">Elegir…</option>{cats.modalidades.filter((n) => n.activo || String(n.id) === modalidad).map((n) => <option value={n.id}>{n.nombre}</option>)}</select></Lbl>
          </div>
          <Lbl label="Cantidad de cursos (1 a 20)"><input class={FIELD} type="number" min={1} max={20} value={cant || ''} onInput={(e) => setCant(Number(e.currentTarget.value))} required /></Lbl>
          {cant > 0 && (
            <div class="grid gap-2 sm:grid-cols-2">
              {cursos.map((c, i) => <input key={i} class={FIELD} placeholder={`Curso ${i + 1}`} value={c} maxLength={80} required aria-label={`Curso ${i + 1}`} onInput={(e) => setCursos(cursos.map((x, j) => (j === i ? e.currentTarget.value : x)))} />)}
            </div>
          )}
          <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Guardar</button></div>
        </form>
      )}
    </Modal>
  )
}
