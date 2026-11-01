import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, RowMenu, Spinner, confirmar, toast } from '../ui/kit'

interface Agr { id: number; nombre: string; codigos: string[] }
interface Cod { codigo: string; n: number }

export function Agrupamientos() {
  const [edit, setEdit] = useState<Partial<Agr> | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const [a, k, c] = await Promise.all([
      supabase.from('agrupamientos_matricula').select('id,nombre').order('nombre'),
      supabase.from('agrupamiento_codigos').select('agrupamiento_id,codigo'),
      supabase.rpc('codigos_escuela'),
    ])
    if (a.error) throw a.error
    if (c.error) throw c.error
    const cods = c.data as Cod[]
    const rows: Agr[] = (a.data ?? []).map((g) => ({ ...g, codigos: (k.data ?? []).filter((x) => x.agrupamiento_id === g.id).map((x) => x.codigo).sort() }))
    return { rows, cods }
  })

  const cant = (a: Agr) => a.codigos.reduce((s, k) => s + (data?.cods.find((c) => c.codigo === k)?.n ?? 0), 0)
  const del = async (a: Agr) => {
    if (!(await confirmar('Eliminar agrupamiento', { text: `Se elimina "${a.nombre}".`, ok: 'Eliminar', danger: true }))) return
    const { error } = await supabase.from('agrupamientos_matricula').delete().eq('id', a.id)
    if (error) return toast.error(error.message)
    toast.ok('Agrupamiento eliminado'); reload()
  }

  return (
    <>
      <PageHeader title="Agrupamiento de Matrículas" subtitle="Agrupá tipos de escuela por código para la carga distrital de matrícula"
        actions={<button class={BTN_PRIMARY} onClick={() => setEdit({ codigos: [] })}>Nuevo agrupamiento</button>} />
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        {loading && !data ? <Spinner /> : !data?.rows.length ? <EmptyState title="Sin agrupamientos" text="Creá el primero." /> : (
          <ul class="-my-4 divide-y divide-slate-100">
            {data.rows.map((a) => (
              <li key={a.id} class="flex items-start justify-between gap-3 py-3">
                <div class="min-w-0 space-y-1.5">
                  <p class="font-semibold text-slate-900">{a.nombre}</p>
                  <div class="flex flex-wrap gap-1">{a.codigos.map((k) => <Badge key={k} tone="blue">{k}</Badge>)}</div>
                  <p class="text-xs text-slate-500">{cant(a)} escuelas</p>
                </div>
                <RowMenu items={[{ label: 'Editar', onClick: () => setEdit(a) }, { label: 'Eliminar', danger: true, onClick: () => del(a) }]} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && data && <Form a={edit} all={data.rows} cods={data.cods} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload() }} />}
    </>
  )
}

function Form({ a, all, cods, onClose, onDone }: { a: Partial<Agr>; all: Agr[]; cods: Cod[]; onClose(): void; onDone(): void }) {
  const [nombre, setNombre] = useState(a.nombre ?? '')
  const [sel, setSel] = useState<string[]>(a.codigos ?? [])
  const [err, setErr] = useState<string | null>(null)
  const dueno = (k: string) => all.find((g) => g.id !== a.id && g.codigos.includes(k))
  const toggle = (k: string) => setSel(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k])

  const submit = async (e: Event) => {
    e.preventDefault()
    const { error } = await supabase.rpc('agrupamiento_guardar', { p_id: a.id ?? null, p_nombre: nombre, p_codigos: sel })
    if (error) return setErr(error.message)
    toast.ok(a.id ? 'Agrupamiento actualizado' : 'Agrupamiento creado'); onDone()
  }

  return (
    <Modal title={a.id ? 'Editar agrupamiento' : 'Nuevo agrupamiento'} onClose={onClose}>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Nombre"><input class={FIELD} value={nombre} required maxLength={80} onInput={(e) => setNombre(e.currentTarget.value)} /></Lbl>
        <div>
          <p class="mb-2 text-sm font-medium text-slate-700">Códigos de escuela</p>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {cods.map((c) => {
              const d = dueno(c.codigo)
              return (
                <label key={c.codigo} class={`flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm ${d ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-slate-300'}`} title={d ? `En "${d.nombre}"` : ''}>
                  <input type="checkbox" checked={sel.includes(c.codigo)} disabled={!!d} onChange={() => toggle(c.codigo)} />
                  <span class="font-medium">{c.codigo}</span><span class="text-xs text-slate-400">{c.n}</span>
                </label>
              )
            })}
          </div>
        </div>
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Guardar</button></div>
      </form>
    </Modal>
  )
}
