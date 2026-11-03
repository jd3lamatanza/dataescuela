import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync, useDebounced } from '../lib/hooks'
import { setParams, useRoute } from '../lib/router'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Modal, PAGE_SIZE, PageHeader, Pager, Spinner, TabBar, Toggle, confirmar, toast, type TabItem } from '../ui/kit'

const TABS = [{ id: 'escuelas', label: 'Escuelas', icon: 'school', color: 'amber' }] as const satisfies readonly TabItem[]

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
      <TabBar label="Escuela de Verano" class="" items={[...TABS]} active={tab} onChange={(id) => setParams({ t: id === 'escuelas' ? null : id, page: null })} />
      <div class="mt-4">{tab === 'escuelas' && <Escuelas />}</div>
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
                <Toggle checked onChange={() => quitar(e)} label="Escuela de verano" />
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
