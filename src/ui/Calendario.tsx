import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/hooks'
import { ROLE_LABELS, type Role } from '../modules'
import { Alert, Card, BTN_PRIMARY, BTN_SECONDARY, FIELD, Lbl, Modal, RowMenu, Spinner, confirmar, toast } from './kit'
import { Icon, iconOr } from './Icon'

export interface TipoEvento { id: number; nombre: string; icono: string; color: string; rol: Role; activo: boolean }
export interface Evento {
  id: number; fecha: string; tipo_id: number; nombre: string; descripcion: string | null
  user_id: string; rol: Role; autor: string; para_roles: Role[]
}

// Clases completas para que Tailwind las detecte
const COLORS: Record<string, { dot: string; chip: string; card: string }> = {
  green: { dot: 'bg-green-500', chip: 'bg-green-100 text-green-800', card: 'border-green-200 bg-green-50 text-green-700' },
  blue: { dot: 'bg-blue-500', chip: 'bg-blue-100 text-blue-800', card: 'border-blue-200 bg-blue-50 text-blue-700' },
  orange: { dot: 'bg-orange-500', chip: 'bg-orange-100 text-orange-800', card: 'border-orange-200 bg-orange-50 text-orange-700' },
  red: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-800', card: 'border-red-200 bg-red-50 text-red-700' },
  cyan: { dot: 'bg-cyan-500', chip: 'bg-cyan-100 text-cyan-800', card: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  violet: { dot: 'bg-violet-500', chip: 'bg-violet-100 text-violet-800', card: 'border-violet-200 bg-violet-50 text-violet-700' },
  amber: { dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800', card: 'border-amber-200 bg-amber-50 text-amber-700' },
  slate: { dot: 'bg-slate-500', chip: 'bg-slate-100 text-slate-800', card: 'border-slate-200 bg-slate-50 text-slate-700' },
}
export const col = (c?: string) => COLORS[c ?? ''] ?? COLORS.slate

const pad = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const mesLabel = (y: number, m: number) => new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(y, m, 1))
const diaLabel = (k: string) => new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(k + 'T00:00:00'))

export function Calendario() {
  const { user } = useAuth()
  const hoy = key(new Date())
  const [ym, setYm] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }))
  const [dia, setDia] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Evento | null>(null)
  const [edit, setEdit] = useState<Partial<Evento> | null>(null)

  const celdas = useMemo(() => {
    const offset = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7
    const dias = new Date(ym.y, ym.m + 1, 0).getDate()
    const n = Math.ceil((offset + dias) / 7) * 7
    return Array.from({ length: n }, (_, i) => new Date(ym.y, ym.m, 1 - offset + i))
  }, [ym])
  const desde = key(celdas[0]); const hasta = key(celdas[celdas.length - 1])

  const { data, loading, error, reload } = useAsync(async () => {
    const [e, t] = await Promise.all([
      supabase.from('eventos').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha').order('id'),
      supabase.from('evento_tipos').select('*').eq('activo', true).order('id'),
    ])
    if (e.error) throw e.error
    if (t.error) throw t.error
    return { eventos: e.data as Evento[], tipos: t.data as TipoEvento[] }
  }, [desde, hasta])

  const tipos = data?.tipos ?? []
  const tipoDe = (id: number) => tipos.find((t) => t.id === id)
  const propios = tipos.filter((t) => t.rol === user?.role)
  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>()
    for (const e of data?.eventos ?? []) m.set(e.fecha, [...(m.get(e.fecha) ?? []), e])
    return m
  }, [data])
  const resumen = (evs: Evento[]) => {
    const m = new Map<number, number>()
    evs.forEach((e) => m.set(e.tipo_id, (m.get(e.tipo_id) ?? 0) + 1))
    return [...m.entries()].sort(([a], [b]) => a - b).map(([id, n]) => [tipoDe(id), n] as const)
  }
  const delDia = useMemo(() => [...(dia ? porDia.get(dia) ?? [] : [])].sort((a, b) => a.tipo_id - b.tipo_id || a.id - b.id), [dia, porDia])

  const ir = (delta: number) => {
    const d = new Date(ym.y, ym.m + delta, 1)
    setYm({ y: d.getFullYear(), m: d.getMonth() })
  }
  const irHoy = () => { const d = new Date(); setYm({ y: d.getFullYear(), m: d.getMonth() }) }
  const esAutor = (e: Evento) => e.user_id === user?.id

  const eliminar = async (e: Evento) => {
    if (!(await confirmar('Eliminar evento', { text: `Se eliminará "${e.nombre}".`, ok: 'Eliminar', danger: true }))) return
    const { error } = await supabase.rpc('evento_eliminar', { p_id: e.id })
    if (error) toast.error(error.message)
    else { toast.ok('Evento eliminado'); setDetalle(null); reload() }
  }

  return (
    <Card>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <h2 class="text-base font-semibold capitalize text-slate-900">{mesLabel(ym.y, ym.m)}</h2>
        <div class="ml-auto flex items-center gap-1.5">
          <button type="button" class="flex size-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100" aria-label="Mes anterior" onClick={() => ir(-1)}><Icon name="chevl" /></button>
          <button type="button" class="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-100" onClick={irHoy}>Hoy</button>
          <button type="button" class="flex size-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100" aria-label="Mes siguiente" onClick={() => ir(1)}><Icon name="chevr" /></button>
          {propios.length > 0 && <button type="button" class={BTN_PRIMARY} onClick={() => setEdit({ fecha: hoy })}>Nuevo evento</button>}
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      <div class="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-center">
        {DIAS.map((d, i) => <div key={i} class="bg-slate-50 py-1.5 text-xs font-medium text-slate-500">{d}</div>)}
        {celdas.map((d) => {
          const k = key(d)
          const evs = porDia.get(k) ?? []
          const fuera = d.getMonth() !== ym.m
          return (
            <button key={k} type="button" onClick={() => { setDia(k); setDetalle(null) }} aria-label={`${diaLabel(k)}${evs.length ? `, ${evs.length} eventos` : ''}`}
              class={`flex min-h-14 flex-col items-center gap-1 p-1 text-sm sm:min-h-20 sm:items-start ${fuera ? 'bg-slate-50 text-slate-400' : 'bg-white text-slate-800'} hover:bg-sky-50`}>
              <span class={`flex size-7 items-center justify-center rounded-full text-xs font-medium ${k === hoy ? 'bg-sky-600 text-white' : ''}`}>{d.getDate()}</span>
              <span class="flex flex-wrap justify-center gap-0.5 sm:justify-start">
                {resumen(evs).map(([t, n]) => (
                  <span key={t?.id ?? 0} title={`${t?.nombre ?? 'Evento'}: ${n}`} class={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold leading-none ${col(t?.color).chip}`}>
                    <Icon name={iconOr(t?.icono)} class="size-3.5" />{n}
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>

      {tipos.length > 0 && (
        <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600" aria-label="Referencias">
          {tipos.map((t) => <li key={t.id} class="flex items-center gap-1.5"><span class={`size-2.5 rounded-full ${col(t.color).dot}`} />{t.nombre}</li>)}
        </ul>
      )}

    {dia && !edit && (
        <Modal title={detalle ? detalle.nombre : diaLabel(dia).replace(/^./, (c) => c.toUpperCase())} onClose={() => { setDia(null); setDetalle(null) }}>
          {detalle ? (() => {
            const t = tipoDe(detalle.tipo_id); const c = col(t?.color)
            return (
              <div class="space-y-4">
                <div class="flex items-center gap-3">
                  <span class={`flex size-12 shrink-0 items-center justify-center rounded-lg border ${c.card}`}><Icon name={iconOr(t?.icono)} class="size-6" /></span>
                  <div><span class={`rounded px-1.5 py-0.5 text-xs font-medium ${c.chip}`}>{t?.nombre ?? 'Evento'}</span><p class="mt-1 text-sm capitalize text-slate-600">{diaLabel(detalle.fecha)}</p></div>
                </div>
                <dl class="space-y-2 text-sm">
                  <div><dt class="text-xs uppercase text-slate-500">Autor</dt><dd>{detalle.autor} · {ROLE_LABELS[detalle.rol]}</dd></div>
                  {detalle.para_roles.length > 0 && <div><dt class="text-xs uppercase text-slate-500">Asignado a</dt><dd>{detalle.para_roles.map((r) => (r === 'areal' ? 'Areales' : 'Escuelas')).join(' y ')}</dd></div>}
                  <div><dt class="text-xs uppercase text-slate-500">Descripción</dt><dd class="whitespace-pre-line">{detalle.descripcion || 'Sin descripción'}</dd></div>
                </dl>
                <div class="flex flex-wrap justify-between gap-2">
                  <button type="button" class={BTN_SECONDARY} onClick={() => setDetalle(null)}>Volver</button>
                  {esAutor(detalle) && (
                    <div class="flex gap-2">
                      <button type="button" class="min-h-11 rounded-md border border-red-300 px-4 text-sm font-medium text-red-600 hover:bg-red-50" onClick={() => eliminar(detalle)}>Eliminar</button>
                      <button type="button" class={BTN_PRIMARY} onClick={() => setEdit(detalle)}>Editar</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })() : (
            <div class="space-y-3">
              {loading && !data ? <Spinner /> : delDia.length === 0 ? <p class="text-sm text-slate-500">Sin eventos este día.</p> : (
                <ul class="space-y-2">
                  {delDia.map((e) => {
                    const t = tipoDe(e.tipo_id); const c = col(t?.color)
                    return (
                      <li key={e.id}>
                        <button type="button" onClick={() => setDetalle(e)} class="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-sky-300 hover:bg-sky-50">
                          <span class={`flex size-10 shrink-0 items-center justify-center rounded-lg border ${c.card}`}><Icon name={iconOr(t?.icono)} /></span>
                          <span class="min-w-0 flex-1"><span class="block truncate font-medium text-slate-900">{e.nombre}</span><span class="block truncate text-xs text-slate-500">{t?.nombre ?? 'Evento'} · {e.autor}</span></span>
                          <Icon name="chevr" class="size-4 shrink-0 text-slate-400" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {propios.length > 0 && <button type="button" class={`${BTN_PRIMARY} w-full`} onClick={() => setEdit({ fecha: dia })}>Nuevo evento en esta fecha</button>}
            </div>
          )}
        </Modal>
      )}
      {edit && <Form e={edit} tipos={propios} rol={user!.role} onClose={() => setEdit(null)} onDone={() => { setEdit(null); setDetalle(null); reload() }} />}
    </Card>
  )
}

function Form({ e, tipos, rol, onClose, onDone }: { e: Partial<Evento>; tipos: TipoEvento[]; rol: Role; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ fecha: e.fecha ?? key(new Date()), tipo: String(e.tipo_id ?? (tipos.length === 1 ? tipos[0].id : '')), nombre: e.nombre ?? '', desc: e.descripcion ?? '' })
  const [para, setPara] = useState<Role[]>(e.para_roles ?? [])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tipo = tipos.find((t) => String(t.id) === f.tipo)
  const togglePara = (r: Role) => setPara(para.includes(r) ? para.filter((x) => x !== r) : [...para, r])

  const submit = async (ev: Event) => {
    ev.preventDefault()
    if (!f.tipo) return setErr('Elegí el tipo de evento')
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('evento_guardar', { p_id: e.id ?? null, p_fecha: f.fecha, p_tipo: Number(f.tipo), p_nombre: f.nombre, p_desc: f.desc, p_para: para })
    setBusy(false)
    if (error) return setErr(error.message)
    toast.ok(e.id ? 'Evento actualizado' : 'Evento creado'); onDone()
  }

  return (
    <Modal title={e.id ? 'Editar evento' : 'Nuevo evento'} onClose={onClose}>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Tipo de evento">
          <select class={FIELD} value={f.tipo} onChange={(ev) => setF({ ...f, tipo: ev.currentTarget.value })} required>
            <option value="">Elegir…</option>
            {tipos.map((t) => <option value={t.id}>{t.nombre}</option>)}
          </select>
        </Lbl>
        {tipo && <p class="-mt-2 flex items-center gap-2 text-xs text-slate-500"><span class={`flex size-7 items-center justify-center rounded-md border ${col(tipo.color).card}`}><Icon name={iconOr(tipo.icono)} class="size-4" /></span>Así se verá en el calendario</p>}
        <Lbl label="Fecha"><input class={FIELD} type="date" value={f.fecha} onInput={(ev) => setF({ ...f, fecha: ev.currentTarget.value })} required /></Lbl>
        <Lbl label="Nombre"><input class={FIELD} value={f.nombre} onInput={(ev) => setF({ ...f, nombre: ev.currentTarget.value })} required minLength={3} maxLength={150} /></Lbl>
        <Lbl label="Descripción"><textarea class={`${FIELD} min-h-24 py-2`} value={f.desc} onInput={(ev) => setF({ ...f, desc: ev.currentTarget.value })} maxLength={2000} /></Lbl>
        {rol === 'distrital' && (
          <fieldset>
            <legend class="mb-1 text-sm font-medium text-slate-700">Asignar a</legend>
            <div class="flex flex-wrap gap-4">
              {(['areal', 'escolar'] as const).map((r) => (
                <label key={r} class="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" class="size-5" checked={para.includes(r)} onChange={() => togglePara(r)} />{r === 'areal' ? 'Areales (inspectores)' : 'Escuelas'}</label>
              ))}
            </div>
            <p class="text-xs text-slate-500">Si no marcás ninguno, solo lo ve el distrito.</p>
          </fieldset>
        )}
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
      </form>
    </Modal>
  )
}
