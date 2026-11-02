import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync, useDebounced } from '../lib/hooks'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, RowMenu, Spinner, confirmar, toast } from '../ui/kit'

interface Item { id: number; fecha: string; nombre: string; descripcion: string | null; lugar: string | null; user_id: string; autor: string }

const fmt = (d: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'))
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())

/** Agenda Anticipada: el inspector gestiona sus eventos; el distrito los lista (solo lectura). */
export function Agenda() {
  const { user } = useAuth()
  const distrito = user?.role === 'distrital'
  const [q, setQ] = useState('')
  const [pasados, setPasados] = useState(false)
  const [edit, setEdit] = useState<Partial<Item> | null>(null)
  const [ver, setVer] = useState<Item | null>(null)
  const dq = useDebounced(q)

  const { data, loading, error, reload } = useAsync(async () => {
    const { data: tipo, error: e1 } = await supabase.from('evento_tipos').select('id').eq('nombre', 'Agenda Anticipada').maybeSingle()
    if (e1) throw e1
    if (!tipo) return [] as Item[]
    const { data, error } = await supabase.from('eventos').select('id,fecha,nombre,descripcion,lugar,user_id,autor').eq('tipo_id', tipo.id).order('fecha').order('id')
    if (error) throw error
    return data as Item[]
  })

  const t = dq.trim().toLowerCase()
  const h = hoy()
  const rows = (data ?? []).filter((i) =>
    (pasados || i.fecha >= h) && (!t || `${i.nombre} ${i.lugar ?? ''} ${i.autor}`.toLowerCase().includes(t)))

  const eliminar = async (i: Item) => {
    if (!(await confirmar('Eliminar evento', { text: `Se elimina “${i.nombre}” de la agenda y del calendario.`, ok: 'Eliminar', danger: true }))) return
    const { error } = await supabase.rpc('evento_eliminar', { p_id: i.id })
    if (error) toast.error(error.message)
    else { toast.ok('Evento eliminado'); reload() }
  }
  const menu = (i: Item) => [
    { label: 'Editar', onClick: () => setEdit(i) },
    { label: 'Eliminar', onClick: () => eliminar(i), danger: true },
  ]

  const fila = (i: Item) => (
    <li key={i.id} class="flex items-center gap-2 p-3">
      <button type="button" class="min-w-0 flex-1 text-left" onClick={() => setVer(i)}>
        <span class="block truncate font-medium text-slate-900">{i.nombre}</span>
        <span class="block truncate text-xs text-slate-500">{fmt(i.fecha)} · {i.lugar ?? 'Sin lugar'}{distrito ? ` · ${i.autor}` : ''}</span>
      </button>
      {!distrito && <RowMenu items={menu(i)} />}
    </li>
  )

  return (
    <>
      <PageHeader title="Agenda Anticipada" subtitle={distrito ? 'Eventos cargados por los inspectores.' : 'Tus eventos próximos; también se ven en el calendario del Home.'}
        actions={!distrito && <button class={BTN_PRIMARY} onClick={() => setEdit({})}>Nuevo evento</button>} />
      <div class="grid gap-2 sm:grid-cols-2">
        <input type="search" class={FIELD} placeholder={distrito ? 'Título, lugar o inspector' : 'Título o lugar'} value={q} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Buscar" />
        <label class="flex min-h-11 items-center gap-2 text-sm text-slate-700"><input type="checkbox" class="size-4" checked={pasados} onChange={(e) => setPasados(e.currentTarget.checked)} />Incluir eventos pasados</label>
      </div>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      <Card class="mt-3">
        {loading && !data ? <Spinner /> : rows.length === 0 ? <EmptyState title="Sin eventos" text={distrito ? 'Los inspectores todavía no cargaron eventos.' : 'Cargá el primero con “Nuevo evento”.'} /> : <ul class="divide-y divide-slate-100">{rows.map(fila)}</ul>}
      </Card>
      {edit && <Formulario item={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload() }} />}
      {ver && (
        <Modal title={ver.nombre} onClose={() => setVer(null)}>
          <dl class="space-y-2 text-sm">
            <div><dt class="text-xs uppercase text-slate-500">Fecha</dt><dd>{fmt(ver.fecha)}</dd></div>
            <div><dt class="text-xs uppercase text-slate-500">Lugar</dt><dd>{ver.lugar ?? '—'}</dd></div>
            <div><dt class="text-xs uppercase text-slate-500">Inspector</dt><dd>{ver.autor}</dd></div>
            <div><dt class="text-xs uppercase text-slate-500">Descripción</dt><dd class="whitespace-pre-line">{ver.descripcion || 'Sin descripción'}</dd></div>
          </dl>
        </Modal>
      )}
    </>
  )
}

function Formulario({ item, onClose, onDone }: { item: Partial<Item>; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ titulo: item.nombre ?? '', fecha: item.fecha ?? '', lugar: item.lugar ?? '', desc: item.descripcion ?? '' })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value })
  const submit = async (e: Event) => {
    e.preventDefault()
    const { error } = await supabase.rpc('agenda_guardar', { p_id: item.id ?? null, p_titulo: f.titulo, p_fecha: f.fecha, p_lugar: f.lugar, p_desc: f.desc })
    if (error) setErr(error.message)
    else { toast.ok(item.id ? 'Evento actualizado' : 'Evento creado'); onDone() }
  }
  return (
    <Modal title={item.id ? 'Editar evento' : 'Nuevo evento'} onClose={onClose}>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Título"><input class={FIELD} value={f.titulo} onInput={set('titulo')} required minLength={3} maxLength={150} /></Lbl>
        <div class="grid gap-3 sm:grid-cols-2">
          <Lbl label="Fecha"><input class={FIELD} type="date" value={f.fecha} onInput={set('fecha')} required /></Lbl>
          <Lbl label="Lugar"><input class={FIELD} value={f.lugar} onInput={set('lugar')} required minLength={2} maxLength={200} /></Lbl>
        </div>
        <Lbl label="Descripción"><textarea class={`${FIELD} min-h-24 py-2`} value={f.desc} onInput={set('desc')} maxLength={2000} /></Lbl>
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Guardar</button></div>
      </form>
    </Modal>
  )
}
