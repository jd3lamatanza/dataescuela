import { useEffect, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync, useDebounced } from '../lib/hooks'
import { setParams, useRoute } from '../lib/router'
import { descargarProbanza, eliminarLabor, previsualizable, quitarArchivo, sincronizarLabor, subirProbanza, urlVistaPrevia } from '../lib/labores'
import { descargarListado } from '../lib/laboresExport'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Badge, Card, EmptyState, FIELD, Lbl, Modal, PAGE_SIZE, PageHeader, Pager, RowMenu, Spinner, Toggle, confirmar, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'

export interface Archivo { id: number; nombre: string; mime: string | null; bytes: number | null; drive_file_id: string }
export interface Labor {
  id: number; user_id: string; autor: string; fecha: string; motivo: string; acuerdos: string | null; equipo: boolean
  lugar: { nombre: string } | null; tipo: { nombre: string } | null; dimension: { nombre: string } | null; evento: { nombre: string } | null
  archivos: Archivo[]; participantes: { user_id: string; nombre: string }[]
}
interface Cat { id: number; nombre: string }
interface Insp { user_id: string; nombre: string }

export const SELECT = 'id,user_id,autor,fecha,motivo,acuerdos,equipo,lugar:catalogos!labores_lugar_id_fkey(nombre),tipo:catalogos!labores_tipo_id_fkey(nombre),dimension:catalogos!labores_dimension_id_fkey(nombre),evento:catalogos!labores_evento_id_fkey(nombre),archivos:labor_archivos(id,nombre,mime,bytes,drive_file_id),participantes:labor_inspectores(user_id,nombre)'
const fmt = (d: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'))
const tam = (b: number | null) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
const COLS = [['lugar', 'labor_lugar', 'Lugar'], ['tipo', 'labor_tipo', 'Tipo'], ['dimension', 'labor_dimension', 'Dimensión'], ['evento', 'labor_evento', 'Evento']] as const

interface Filtros { q: string; insp: string; lugar: string; tipo: string; dimension: string; evento: string; desde: string; hasta: string }
const VACIO: Filtros = { q: '', insp: '', lugar: '', tipo: '', dimension: '', evento: '', desde: '', hasta: '' }

/** Construye la consulta filtrada (sin rango); la usan el listado paginado y la exportación. */
async function consulta(f: Filtros) {
  let q = supabase.from('labores').select(SELECT, { count: 'exact' }).order('fecha', { ascending: false }).order('id', { ascending: false })
  if (f.q) { const t = f.q.replace(/[,()%*]/g, ' ').trim(); if (t) q = q.or(`motivo.ilike.%${t}%,autor.ilike.%${t}%`) }
  if (f.insp) {
    const { data } = await supabase.from('labor_inspectores').select('labor_id').eq('user_id', f.insp)
    const ids = (data ?? []).map((r) => r.labor_id)
    q = q.or(ids.length ? `user_id.eq.${f.insp},id.in.(${ids.join(',')})` : `user_id.eq.${f.insp}`)
  }
  for (const [k] of COLS) if (f[k]) q = q.eq(`${k}_id`, Number(f[k]))
  if (f.desde) q = q.gte('fecha', f.desde)
  if (f.hasta) q = q.lte('fecha', f.hasta)
  return (a: number, b: number) => q.range(a, b)
}

/** Labores: el inspector gestiona las suyas; el distrito las lista con filtros y exportación. */
export function Labores() {
  const { user } = useAuth()
  const distrito = user?.role === 'distrital'
  const { params } = useRoute()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [f, setF] = useState<Filtros>(VACIO)
  const q = useDebounced(f.q)
  const [edit, setEdit] = useState<Partial<Labor> | null>(null)
  const [ver, setVer] = useState<Labor | null>(null)
  const [exp, setExp] = useState(false)
  const set = (k: keyof Filtros) => (e: Event) => { setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value }); setParams({ page: null }) }
  const filtros = { ...f, q }

  const cats = useAsync(async () => {
    const { data } = await supabase.from('catalogos').select('id,nombre,coleccion').in('coleccion', COLS.map((c) => c[1])).order('orden')
    return data as (Cat & { coleccion: string })[]
  })
  const insps = useAsync(async () => (distrito ? ((await supabase.rpc('labor_inspectores_lista')).data as Insp[]) : []), [distrito])
  const catDe = (c: string) => (cats.data ?? []).filter((x) => x.coleccion === c)

  const lista = useAsync(async () => {
    const { data, error, count } = await (await consulta(filtros))((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (error) throw error
    return { rows: data as unknown as Labor[], total: count ?? 0 }
  }, [page, JSON.stringify(filtros)])

  // Apertura directa desde la alerta del distrito
  const laborId = Number(params.get('labor')) || null
  useEffect(() => {
    if (!laborId) return
    supabase.from('labores').select(SELECT).eq('id', laborId).maybeSingle().then(({ data }) => data && setVer(data as unknown as Labor))
  }, [laborId])

  const abrir = (l: Labor) => {
    setVer(l)
    if (distrito) supabase.from('notifications').delete().eq('url', `/labores-distrito?labor=${l.id}`).then(() => dispatchEvent(new Event('notifs-changed')))
  }
  useEffect(() => { if (ver && laborId === ver.id && distrito) abrir(ver) }, [ver?.id])
  const cerrar = () => { setVer(null); if (laborId) setParams({ labor: null }) }

  const eliminar = async (l: Labor) => {
    if (!(await confirmar('Eliminar labor', { text: `Se elimina “${l.motivo}” y su carpeta en Drive pasa a la papelera.`, ok: 'Eliminar', danger: true }))) return
    try { await eliminarLabor(l.id); toast.ok('Labor eliminada'); lista.reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo eliminar') }
  }
  const bajar = async (tipo: 'xlsx' | 'pdf') => {
    setExp(true)
    try {
      const todas: Labor[] = []
      for (let i = 0; ; i += 500) {
        const { data, error } = await (await consulta(filtros))(i, i + 499)
        if (error) throw error
        todas.push(...(data as unknown as Labor[]))
        if ((data ?? []).length < 500) break
      }
      await descargarListado(tipo, todas, filtros.desde || filtros.hasta ? `${filtros.desde || '…'} a ${filtros.hasta || '…'}` : '')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo generar el archivo') }
    setExp(false)
  }
  const menu = (l: Labor) => [{ label: 'Editar', onClick: () => setEdit(l) }, { label: 'Eliminar', onClick: () => eliminar(l), danger: true }]
  const sel = (k: 'lugar' | 'tipo' | 'dimension' | 'evento', c: string, label: string) => (
    <select class={FIELD} value={f[k]} onChange={set(k)} aria-label={label}><option value="">{label}: todos</option>{catDe(c).map((o) => <option value={o.id}>{o.nombre}</option>)}</select>
  )
  const data = lista.data

  return (
    <>
      <PageHeader title="Labores" subtitle={distrito ? 'Registro de labores de los inspectores.' : 'Tus labores y las de equipo en las que participás.'}
        actions={!distrito && <button class={BTN_PRIMARY} onClick={() => setEdit({})}>Nueva labor</button>} />
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input class={FIELD} type="search" placeholder="Buscar motivo o inspector" value={f.q} onInput={set('q')} aria-label="Buscar" />
        {distrito && <select class={FIELD} value={f.insp} onChange={set('insp')} aria-label="Inspector"><option value="">Inspector: todos</option>{(insps.data ?? []).map((i) => <option value={i.user_id}>{i.nombre}</option>)}</select>}
        {COLS.map(([k, c, l]) => sel(k, c, l))}
        <Lbl label="Desde"><input class={FIELD} type="date" value={f.desde} onInput={set('desde')} /></Lbl>
        <Lbl label="Hasta"><input class={FIELD} type="date" value={f.hasta} onInput={set('hasta')} /></Lbl>
        {distrito && (
          <div class="flex items-end gap-2">
            <button type="button" class={`${BTN_SECONDARY} flex-1`} disabled={exp || !data?.total} onClick={() => bajar('xlsx')}><Icon name="download" class="size-5" />Excel</button>
            <button type="button" class={`${BTN_SECONDARY} flex-1`} disabled={exp || !data?.total} onClick={() => bajar('pdf')}><Icon name="download" class="size-5" />PDF</button>
          </div>
        )}
      </div>
      {lista.error && <div class="mt-3"><Alert tone="error">{lista.error}</Alert></div>}
      <Card class="mt-3">
        {lista.loading && !data ? <Spinner /> : !data?.rows.length ? <EmptyState title="Sin labores" text="No hay labores con esos criterios." /> : (
          <ul class="divide-y divide-slate-100">
            {data.rows.map((l) => (
              <li key={l.id} class="flex items-center gap-2 p-3">
                <button type="button" class="min-w-0 flex-1 text-left" onClick={() => abrir(l)}>
                  <span class="block truncate font-medium text-slate-900">{l.motivo}</span>
                  <span class="block truncate text-xs text-slate-500">{fmt(l.fecha)} · {l.evento?.nombre} · {l.lugar?.nombre}{distrito || l.user_id !== user?.id ? ` · ${l.autor}` : ''}</span>
                  <span class="mt-1 flex flex-wrap gap-1"><Badge tone={l.tipo?.nombre === 'Emergente' ? 'red' : 'blue'}>{l.tipo?.nombre}</Badge>{l.equipo && <Badge tone="amber">Equipo</Badge>}{l.archivos.length > 0 && <Badge>{l.archivos.length} archivo(s)</Badge>}</span>
                </button>
                {!distrito && l.user_id === user?.id && <RowMenu items={menu(l)} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pager page={page} total={data?.total ?? 0} onPage={(p) => setParams({ page: p > 1 ? p : null })} />
      {edit && <Formulario item={edit} cats={cats.data ?? []} onClose={() => setEdit(null)} onDone={() => { setEdit(null); lista.reload() }} />}
      {ver && <Detalle l={ver} propia={ver.user_id === user?.id} onClose={cerrar} />}
    </>
  )
}

function Detalle({ l, propia, onClose }: { l: Labor; propia: boolean; onClose(): void }) {
  const [prev, setPrev] = useState<{ nombre: string; url: string; img: boolean } | null>(null)
  useEffect(() => () => { if (prev) URL.revokeObjectURL(prev.url) }, [prev])
  const ver = async (a: Archivo) => {
    try { setPrev({ nombre: a.nombre, url: await urlVistaPrevia(a.id, a.mime), img: !!a.mime?.startsWith('image/') }) } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo abrir el archivo') }
  }
  const bajar = async (a: Archivo) => { try { await descargarProbanza(a.id, a.nombre, a.mime) } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo descargar') } }
  const dato = (t: string, v?: string | null) => <div><dt class="text-xs uppercase text-slate-500">{t}</dt><dd>{v || '—'}</dd></div>
  return (
    <>
      <Modal title={l.motivo} onClose={onClose} wide>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          {dato('Fecha', fmt(l.fecha))}{dato('Inspector', l.autor)}{dato('Evento', l.evento?.nombre)}{dato('Lugar', l.lugar?.nombre)}{dato('Tipo', l.tipo?.nombre)}{dato('Dimensión', l.dimension?.nombre)}
          {l.equipo && <div class="sm:col-span-2"><dt class="text-xs uppercase text-slate-500">Labor de Equipo Supervisivo · participantes</dt><dd>{l.participantes.map((p) => p.nombre).join(', ') || 'Ninguno'}</dd></div>}
          <div class="sm:col-span-2"><dt class="text-xs uppercase text-slate-500">Acuerdos</dt><dd class="whitespace-pre-line">{l.acuerdos || 'Sin acuerdos'}</dd></div>
        </dl>
        <h3 class="mb-1 mt-4 text-sm font-semibold text-slate-700">Probanza</h3>
        {l.archivos.length === 0 ? <p class="text-sm text-slate-500">Sin archivos.</p> : (
          <ul class="divide-y divide-slate-100 rounded-md border border-slate-200">
            {l.archivos.map((a) => (
              <li key={a.id} class="flex items-center gap-2 p-2 text-sm">
                <span class="min-w-0 flex-1 truncate">{a.nombre} <span class="text-xs text-slate-400">{tam(a.bytes)}</span></span>
                {previsualizable(a.mime) && <button type="button" class={BTN_SECONDARY} aria-label={`Ver ${a.nombre}`} onClick={() => ver(a)}><Icon name="eye" class="size-5" /></button>}
                <button type="button" class={BTN_SECONDARY} aria-label={`Descargar ${a.nombre}`} onClick={() => bajar(a)}><Icon name="download" class="size-5" /></button>
              </li>
            ))}
          </ul>
        )}
        {propia && <p class="mt-3 text-xs text-slate-400">Podés editarla o eliminarla desde el menú de la lista.</p>}
      </Modal>
      {prev && (
        <Modal title={prev.nombre} onClose={() => setPrev(null)} wide>
          {prev.img ? <img src={prev.url} alt={prev.nombre} class="mx-auto max-h-[70vh] rounded" /> : <iframe src={prev.url} title={prev.nombre} class="h-[70vh] w-full rounded border border-slate-200" />}
        </Modal>
      )}
    </>
  )
}

function Formulario({ item, cats, onClose, onDone }: { item: Partial<Labor>; cats: (Cat & { coleccion: string })[]; onClose(): void; onDone(): void }) {
  const hoy = new Date().toISOString().slice(0, 10)
  const idDe = (c: string, n?: string) => String(cats.find((x) => x.coleccion === c && x.nombre === n)?.id ?? '')
  const [v, setV] = useState({
    fecha: item.fecha ?? hoy, lugar: idDe('labor_lugar', item.lugar?.nombre), tipo: idDe('labor_tipo', item.tipo?.nombre),
    dimension: idDe('labor_dimension', item.dimension?.nombre), evento: idDe('labor_evento', item.evento?.nombre), motivo: item.motivo ?? '', acuerdos: item.acuerdos ?? '',
  })
  const [equipo, setEquipo] = useState(item.equipo ?? false)
  const [part, setPart] = useState<string[]>((item.participantes ?? []).map((p) => p.user_id))
  const [nuevos, setNuevos] = useState<File[]>([])
  const [existentes, setExistentes] = useState<Archivo[]>(item.archivos ?? [])
  const [busy, setBusy] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const insps = useAsync(async () => (await supabase.rpc('labor_inspectores_lista')).data as Insp[])
  const set = (k: keyof typeof v) => (e: Event) => setV({ ...v, [k]: (e.currentTarget as HTMLInputElement).value })
  const sel = (k: 'lugar' | 'tipo' | 'dimension' | 'evento', c: string, label: string) => (
    <Lbl label={label}><select class={FIELD} value={v[k]} onChange={set(k)} required><option value="">Elegir…</option>{cats.filter((x) => x.coleccion === c).map((o) => <option value={o.id}>{o.nombre}</option>)}</select></Lbl>
  )

  const quitar = async (a: Archivo) => {
    if (!(await confirmar('Quitar archivo', { text: `Se quita “${a.nombre}” de la labor.`, ok: 'Quitar', danger: true }))) return
    try { await quitarArchivo(a.id); setExistentes(existentes.filter((x) => x.id !== a.id)) } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo quitar') }
  }
  const submit = async (e: Event) => {
    e.preventDefault(); setErr(null)
    if (equipo && part.length === 0) return setErr('Elegí al menos un inspector participante')
    setBusy('Guardando…')
    const { data: id, error } = await supabase.rpc('labor_guardar', {
      p_id: item.id ?? null, p_fecha: v.fecha, p_lugar: Number(v.lugar), p_tipo: Number(v.tipo), p_dimension: Number(v.dimension),
      p_motivo: v.motivo, p_evento: Number(v.evento), p_acuerdos: v.acuerdos, p_equipo: equipo, p_participantes: equipo ? part : [],
    })
    if (error) { setBusy(null); return setErr(error.message) }
    try {
      await sincronizarLabor(id as number)
      for (let i = 0; i < nuevos.length; i++) {
        setBusy(`Subiendo ${i + 1} de ${nuevos.length}: ${nuevos[i].name}`); setPct(0)
        await subirProbanza(id as number, nuevos[i], setPct)
      }
      if (nuevos.length) await sincronizarLabor(id as number)
      toast.ok(item.id ? 'Labor actualizada' : 'Labor creada'); onDone()
    } catch (ex) {
      setBusy(null); setErr(`La labor se guardó, pero falló Drive: ${ex instanceof Error ? ex.message : 'error'}. Abrila desde la lista para reintentar.`)
    }
  }

  return (
    <Modal title={item.id ? 'Editar labor' : 'Nueva labor'} onClose={busy ? () => {} : onClose} wide>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <div class="grid gap-3 sm:grid-cols-2">
          <Lbl label="Fecha"><input class={FIELD} type="date" value={v.fecha} onInput={set('fecha')} required /></Lbl>
          {sel('evento', 'labor_evento', 'Evento')}{sel('lugar', 'labor_lugar', 'Lugar')}{sel('tipo', 'labor_tipo', 'Tipo')}{sel('dimension', 'labor_dimension', 'Dimensión')}
        </div>
        <Lbl label="Motivo"><input class={FIELD} value={v.motivo} onInput={set('motivo')} required minLength={3} maxLength={200} /></Lbl>
        <Lbl label="Acuerdos"><textarea class={`${FIELD} min-h-24 py-2`} value={v.acuerdos} onInput={set('acuerdos')} maxLength={4000} /></Lbl>
        <Toggle checked={equipo} onChange={setEquipo} label="Labor de Equipo Supervisivo" />
        {equipo && (
          <fieldset class="rounded-md border border-slate-200 p-3">
            <legend class="px-1 text-sm font-medium text-slate-700">Inspectores que participaron</legend>
            {insps.loading ? <Spinner /> : (
              <div class="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
                {(insps.data ?? []).map((i) => (
                  <label class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" class="size-5" checked={part.includes(i.user_id)} onChange={(e) => setPart(e.currentTarget.checked ? [...part, i.user_id] : part.filter((x) => x !== i.user_id))} />{i.nombre}</label>
                ))}
              </div>
            )}
          </fieldset>
        )}
        <div>
          <h3 class="mb-1 text-sm font-medium text-slate-700">Probanza</h3>
          <label class="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-center text-sm text-slate-600 hover:border-sky-400 hover:bg-sky-50">
            <Icon name="download" class="size-6 rotate-180 text-slate-400" />
            Tocá para elegir archivos (cualquier tipo, sin límite de cantidad ni peso)
            <input type="file" multiple class="sr-only" onChange={(e) => { setNuevos([...nuevos, ...Array.from(e.currentTarget.files ?? [])]); e.currentTarget.value = '' }} />
          </label>
          <ul class="mt-2 space-y-1 text-sm">
            {existentes.map((a) => <li class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate">{a.nombre}</span><button type="button" class="text-red-600 hover:underline" onClick={() => quitar(a)}>Quitar</button></li>)}
            {nuevos.map((a, i) => <li class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate">{a.name} <span class="text-xs text-slate-400">nuevo · {tam(a.size)}</span></span><button type="button" class="text-red-600 hover:underline" onClick={() => setNuevos(nuevos.filter((_, j) => j !== i))}>Sacar</button></li>)}
          </ul>
        </div>
        {busy && <div class="space-y-1 text-sm text-slate-600"><p>{busy}</p><div class="h-2 overflow-hidden rounded bg-slate-200"><div class="h-full bg-sky-600 transition-all" style={{ width: `${pct}%` }} /></div></div>}
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={!!busy} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={!!busy}>Guardar</button></div>
      </form>
    </Modal>
  )
}
