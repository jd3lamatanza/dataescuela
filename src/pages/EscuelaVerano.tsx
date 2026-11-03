import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync, useDebounced } from '../lib/hooks'
import { go, setParams, useRoute } from '../lib/router'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Modal, PAGE_SIZE, PageHeader, Pager, RowMenu, Spinner, TabBar, Toggle, confirmar, toast, type TabItem } from '../ui/kit'

const TABS = [
  { id: 'escuelas', label: 'Escuelas', icon: 'school', color: 'amber' },
  { id: 'config', label: 'Configuración', icon: 'settings', color: 'indigo' },
] as const satisfies readonly TabItem[]

interface Esc { id: number; clave: string | null; cue: string; codigo: string | null; numero: number | null; nivel: string | null; modalidad: string | null; localidad: string | null }
const COLS = 'id,clave,cue,codigo,numero,nivel,modalidad,localidad'
const nombre = (e: Esc) => [e.codigo, e.numero].filter(Boolean).join(' ') || e.cue
const buscar = (s: any, texto: string) => {
  const t = texto.trim().slice(0, 80).replace(/[,()%*\\]/g, ' ')
  return t ? s.or(['clave', 'cue', 'codigo', 'nivel', 'modalidad', 'localidad'].map((k) => `${k}.ilike.%${t}%`).concat(/^\d+$/.test(t) ? [`numero.eq.${t}`] : []).join(',')) : s
}
const marcar = async (e: Esc, on: boolean) => {
  const { error } = await supabase.from('escuelas').update({ eav: on ? 'Sí' : 'No' }).eq('id', e.id)
  if (error) { toast.error(error.message); return false }
  return true
}

/** Escuela de Verano (EAV): módulo del distrito organizado en pestañas. */
export function EscuelaVerano() {
  const { params } = useRoute()
  const tab = TABS.some((t) => t.id === params.get('t')) ? params.get('t')! : 'escuelas'
  return (
    <>
      <PageHeader title="Escuela de Verano" subtitle="EAV" />
      <TabBar label="Escuela de Verano" class="" items={[...TABS]} active={tab} onChange={(id) => setParams({ t: id === 'escuelas' ? null : id, page: null, q: null, c: null, col: null })} />
      <div class="mt-4">{tab === 'escuelas' && <Escuelas />}{tab === 'config' && <Configuracion />}</div>
    </>
  )
}

function Escuelas() {
  const { params } = useRoute()
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q)
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [agregar, setAgregar] = useState(false)
  const { data, loading, error, reload } = useAsync(async () => {
    let s = supabase.from('escuelas').select(COLS, { count: 'exact' }).eq('eav', 'Sí')
    s = buscar(s, dq).order('clave').order('numero')
    const r = await s.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (r.error) throw r.error
    return { rows: r.data as Esc[], total: r.count ?? 0 }
  }, [dq, page])

  const quitar = async (e: Esc) => {
    if (!(await confirmar('Quitar de Escuela de Verano', { text: `${nombre(e)} (${e.clave}) deja de figurar como escuela de verano.`, ok: 'Quitar', danger: true }))) return
    if (await marcar(e, false)) { toast.ok('Escuela quitada'); reload() }
  }

  return (
    <>
      <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input type="search" class={FIELD} placeholder="Clave, CUE, código, número, nivel o localidad" value={q} maxLength={80} aria-label="Buscar"
          onInput={(e) => { setQ(e.currentTarget.value); setParams({ q: e.currentTarget.value, page: null }) }} />
        <button class={BTN_SECONDARY} onClick={() => { setQ(''); setParams({ q: null, page: null }) }}>Limpiar</button>
        <button class={BTN_PRIMARY} onClick={() => setAgregar(true)}>Agregar escuela</button>
      </div>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      <Card class="mt-3">
        {loading && !data ? <Spinner /> : !data?.rows.length ? <EmptyState title="Sin escuelas de verano" text={dq ? 'Probá con otra búsqueda.' : 'Usá “Agregar escuela” para sumar la primera.'} /> : (
          <ul class="-my-4 divide-y divide-slate-200">
            {data.rows.map((e) => (
              <li key={e.id} class="flex items-center justify-between gap-2 py-3">
                <div class="min-w-0">
                  <p class="font-semibold">{nombre(e)}</p>
                  <p class="font-mono text-xs text-slate-500">{e.clave} · CUE {e.cue}</p>
                  <p class="text-xs text-slate-600">{[e.nivel, e.modalidad, e.localidad].filter(Boolean).join(' · ')}</p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <Toggle checked onChange={() => quitar(e)} label="Escuela de verano" />
                  <RowMenu items={[
                    { label: 'Ficha de Escuela', onClick: () => go(`/escuelas?e=${e.id}&from=eav`) },
                    { label: 'Cargos', onClick: () => toast.info('La lista de cargos todavía no está implementada.') },
                    { label: 'Inscriptos', onClick: () => toast.info('La lista de inscriptos todavía no está implementada.') },
                  ]} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pager page={page} total={data?.total ?? 0} onPage={(p) => setParams({ page: p > 1 ? p : null })} />
      {agregar && <Agregar onClose={() => { setAgregar(false); reload() }} />}
    </>
  )
}

/** Buscador de todas las escuelas; el toggle de cada una la marca o desmarca como EAV. */
function Agregar({ onClose }: { onClose(): void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [marcadas, setMarcadas] = useState<Record<number, boolean>>({})
  const { data, loading, error } = useAsync(async () => {
    if (dq.trim().length < 2) return [] as (Esc & { eav: string | null })[]
    const r = await buscar(supabase.from('escuelas').select(COLS + ',eav'), dq).order('clave').limit(20)
    if (r.error) throw r.error
    return r.data as unknown as (Esc & { eav: string | null })[]
  }, [dq])
  const on = (e: Esc & { eav: string | null }) => marcadas[e.id] ?? e.eav === 'Sí'
  const cambiar = async (e: Esc & { eav: string | null }, v: boolean) => {
    if (await marcar(e, v)) { setMarcadas({ ...marcadas, [e.id]: v }); toast.ok(v ? `${nombre(e)} agregada` : `${nombre(e)} quitada`) }
  }
  return (
    <Modal title="Agregar escuela de verano" onClose={onClose} wide>
      <input type="search" class={FIELD} placeholder="Buscar por clave, CUE, código, número o localidad" value={q} maxLength={80} autoFocus aria-label="Buscar escuela" onInput={(e) => setQ(e.currentTarget.value)} />
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      <div class="mt-3 max-h-[60vh] overflow-y-auto">
        {loading ? <Spinner /> : dq.trim().length < 2 ? <p class="py-6 text-center text-sm text-slate-500">Escribí al menos 2 caracteres para buscar.</p> : !data?.length ? <EmptyState title="Sin resultados" /> : (
          <ul class="divide-y divide-slate-200">
            {data.map((e) => (
              <li key={e.id} class="flex items-center justify-between gap-2 py-3">
                <div class="min-w-0"><p class="font-semibold">{nombre(e)}</p><p class="font-mono text-xs text-slate-500">{e.clave} · CUE {e.cue}</p><p class="text-xs text-slate-600">{[e.nivel, e.localidad].filter(Boolean).join(' · ')}</p></div>
                <Toggle checked={on(e)} onChange={(v) => cambiar(e, v)} label="Escuela de verano" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

const SUBTABS = [{ id: 'colecciones', label: 'Colecciones de Datos', icon: 'list', color: 'sky' }] as const satisfies readonly TabItem[]
const COLECCIONES = [{ id: 'eav_cargo', label: 'Cargos', singular: 'cargo' }, { id: 'eav_predio', label: 'Predios', singular: 'predio' }] as const

function Configuracion() {
  const { params } = useRoute()
  const sub = SUBTABS.some((t) => t.id === params.get('c')) ? params.get('c')! : 'colecciones'
  return (
    <>
      <TabBar label="Configuración" items={[...SUBTABS]} active={sub} onChange={(id) => setParams({ c: id === 'colecciones' ? null : id })} />
      {sub === 'colecciones' && <Colecciones />}
    </>
  )
}

interface Item { id: number; nombre: string; activo: boolean }

/** Listas de datos (cargos, predios) que luego se cargan en las escuelas. */
function Colecciones() {
  const { params } = useRoute()
  const col = COLECCIONES.find((c) => c.id === params.get('col')) ?? COLECCIONES[0]
  const [nuevo, setNuevo] = useState('')
  const [edit, setEdit] = useState<Item | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const r = await supabase.from('catalogos').select('id,nombre,activo').eq('coleccion', col.id).order('nombre')
    if (r.error) throw r.error
    return r.data as Item[]
  }, [col.id])
  const fallo = (e: { code?: string; message: string }) => toast.error(e.code === '23505' ? 'Ya existe un elemento con ese nombre' : e.message)

  const agregar = async (e: Event) => {
    e.preventDefault()
    const nombre = nuevo.trim().replace(/\s+/g, ' ')
    if (!nombre) return
    const { error } = await supabase.from('catalogos').insert({ coleccion: col.id, nombre })
    if (error) return fallo(error)
    setNuevo(''); toast.ok('Agregado'); reload()
  }
  const activar = async (i: Item, v: boolean) => {
    const { error } = await supabase.from('catalogos').update({ activo: v }).eq('id', i.id)
    if (error) return toast.error(error.message)
    reload()
  }
  const eliminar = async (i: Item) => {
    if (!(await confirmar(`Eliminar ${col.singular}`, { text: `Se elimina “${i.nombre}” de la lista.`, ok: 'Eliminar', danger: true }))) return
    const { error } = await supabase.from('catalogos').delete().eq('id', i.id)
    if (error) return toast.error(error.code === '23503' ? 'Está en uso: desactivalo en lugar de eliminarlo' : error.message)
    toast.ok('Eliminado'); reload()
  }

  return (
    <>
      <div class="mb-3 flex gap-2" role="tablist" aria-label="Colección">
        {COLECCIONES.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === col.id} onClick={() => setParams({ col: c.id === COLECCIONES[0].id ? null : c.id })}
            class={`min-h-11 rounded-full border px-4 text-sm font-medium ${c.id === col.id ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>{c.label}</button>
        ))}
      </div>
      <form onSubmit={agregar} class="flex gap-2">
        <input class={FIELD} value={nuevo} onInput={(e) => setNuevo(e.currentTarget.value)} maxLength={120} placeholder={`Nuevo ${col.singular}`} aria-label={`Nuevo ${col.singular}`} />
        <button class={BTN_PRIMARY} disabled={!nuevo.trim()}>Agregar</button>
      </form>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      <Card class="mt-3">
        {loading && !data ? <Spinner /> : !data?.length ? <EmptyState title={`Sin ${col.label.toLowerCase()}`} text="Agregá el primero con el campo de arriba." /> : (
          <ul class="-my-4 divide-y divide-slate-200">
            {data.map((i) => (
              <li key={i.id} class="flex items-center gap-2 py-2.5">
                <span class={`min-w-0 flex-1 truncate ${i.activo ? '' : 'text-slate-400 line-through'}`}>{i.nombre}</span>
                <Toggle checked={i.activo} onChange={(v) => activar(i, v)} label="Activo" />
                <RowMenu items={[{ label: 'Editar', onClick: () => setEdit(i) }, { label: 'Eliminar', onClick: () => eliminar(i), danger: true }]} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <Renombrar item={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload() }} fallo={fallo} />}
    </>
  )
}

function Renombrar({ item, onClose, onDone, fallo }: { item: Item; onClose(): void; onDone(): void; fallo(e: { code?: string; message: string }): void }) {
  const [n, setN] = useState(item.nombre)
  const submit = async (e: Event) => {
    e.preventDefault()
    const { error } = await supabase.from('catalogos').update({ nombre: n.trim().replace(/\s+/g, ' ') }).eq('id', item.id)
    if (error) fallo(error); else { toast.ok('Actualizado'); onDone() }
  }
  return (
    <Modal title="Editar nombre" onClose={onClose}>
      <form onSubmit={submit} class="space-y-4">
        <input class={FIELD} value={n} onInput={(e) => setN(e.currentTarget.value)} required maxLength={120} autoFocus aria-label="Nombre" />
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Guardar</button></div>
      </form>
    </Modal>
  )
}
