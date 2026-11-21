import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/hooks'
import { ROLE_LABELS, type Role } from '../modules'
import { Alert, Card, BTN_PRIMARY, BTN_SECONDARY, FIELD, Lbl, Modal, RowMenu, Spinner, confirmar, toast } from './kit'
import { Icon, iconOr } from './Icon'
import { leerPaginas, sinEventosDeSalidas, type FuenteCalendario, type RegistroCalendario } from '../lib/calendarioDistrital'
import { cargarCalendarioDistrital } from '../lib/calendarioDistritalDatos'
import { href } from '../lib/router'

export interface TipoEvento { id: number; nombre: string; icono: string; color: string; rol: Role; activo: boolean }
export interface Evento {
  id: number; fecha: string; tipo_id: number; nombre: string; descripcion: string | null; lugar?: string | null; hora?: string | null; agenda_historica?: boolean
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
const FUENTES: Record<FuenteCalendario, { nombre: string; color: string; icono: string }> = {
  acreditacion: { nombre: 'Acreditación', color: 'violet', icono: 'check' },
  salida: { nombre: 'Salida Educativa', color: 'green', icono: 'bus' },
  labor: { nombre: 'Labor', color: 'cyan', icono: 'clipboard' },
  disposicion: { nombre: 'Disposición', color: 'amber', icono: 'clipboard' },
  matricula: { nombre: 'Matrícula', color: 'orange', icono: 'chart' },
  posesion: { nombre: 'Toma de posesión', color: 'slate', icono: 'users' },
}
type Entrada = { clase: 'evento'; evento: Evento } | { clase: 'registro'; registro: RegistroCalendario }
const fechaEntrada = (e: Entrada) => e.clase === 'evento' ? e.evento.fecha : e.registro.fecha
const nombreEntrada = (e: Entrada) => e.clase === 'evento' ? e.evento.nombre : e.registro.nombre
const idEntrada = (e: Entrada) => e.clase === 'evento' ? `evento-${e.evento.id}` : e.registro.id

const pad = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const mesLabel = (y: number, m: number) => new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(y, m, 1))
const diaLabel = (k: string) => new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(k + 'T00:00:00'))

export interface CalendarioCtl {
  ym: { y: number; m: number }
  setYm(v: { y: number; m: number }): void
  /** Si se indica, muestra solo ese tipo de evento y sin alta ni edición desde el calendario. */
  tipoNombre?: string
  filtro?(e: Evento): boolean
  version?: number
}

export function Calendario({ ctl }: { ctl?: CalendarioCtl } = {}) {
  const { user } = useAuth()
  const hoy = key(new Date())
  const [ymLocal, setYmLocal] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }))
  const ym = ctl?.ym ?? ymLocal
  const setYm = ctl?.setYm ?? setYmLocal
  const [dia, setDia] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<Evento | null>(null)
  const [detalleRegistro, setDetalleRegistro] = useState<RegistroCalendario | null>(null)
  const [edit, setEdit] = useState<Partial<Evento> | null>(null)

  const celdas = useMemo(() => {
    const offset = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7
    const dias = new Date(ym.y, ym.m + 1, 0).getDate()
    const n = Math.ceil((offset + dias) / 7) * 7
    return Array.from({ length: n }, (_, i) => new Date(ym.y, ym.m, 1 - offset + i))
  }, [ym])
  const desde = key(celdas[0]); const hasta = key(celdas[celdas.length - 1])

  const { data, error, reload } = useAsync(async () => {
    const [eventos, t, resultadoExtra] = await Promise.all([
      leerPaginas<Evento>((a, b) => supabase.from('eventos').select('*').gte('fecha', desde).lte('fecha', hasta).order('id').range(a, b)),
      supabase.from('evento_tipos').select('*').order('id'),
      !ctl && user?.role === 'distrital'
        ? cargarCalendarioDistrital(desde, hasta).then((datos) => ({ datos, error: '' })).catch((e: unknown) => ({ datos: null, error: e instanceof Error ? e.message : 'Error desconocido' }))
        : Promise.resolve({ datos: null, error: '' }),
    ])
    if (t.error) throw t.error
    return { desde, hasta, usuario: user?.id, rol: user?.role, controlado: !!ctl, eventos: sinEventosDeSalidas(eventos, resultadoExtra.datos?.eventosSalidas ?? []), tipos: t.data as TipoEvento[], registros: resultadoExtra.datos?.registros ?? [], errorExtra: resultadoExtra.error }
  }, [desde, hasta, ctl?.version, user?.id, user?.role, !!ctl])

  const dataActual = data?.desde === desde && data.hasta === hasta && data.usuario === user?.id && data.rol === user?.role && data.controlado === !!ctl ? data : null
  const tipoFijo = ctl?.tipoNombre
  const tipos = (dataActual?.tipos ?? []).filter((t) => (t.activo || (!ctl && user?.role === 'distrital')) && (!tipoFijo || t.nombre === tipoFijo))
  const tipoDe = (id: number) => tipos.find((t) => t.id === id)
  const propios = ctl?.tipoNombre ? [] : tipos.filter((t) => t.activo && t.rol === user?.role)
  const porDia = useMemo(() => {
    const m = new Map<string, Entrada[]>()
    const agregar = (e: Entrada) => { const fecha = fechaEntrada(e); const lista = m.get(fecha); if (lista) lista.push(e); else m.set(fecha, [e]) }
    for (const e of dataActual?.eventos ?? []) if (tipos.some((t) => t.id === e.tipo_id) && (!ctl?.filtro || ctl.filtro(e))) agregar({ clase: 'evento', evento: e })
    for (const r of dataActual?.registros ?? []) agregar({ clase: 'registro', registro: r })
    return m
  }, [dataActual, ctl?.filtro, tipoFijo])
  const tipoEntrada = (e: Entrada) => e.clase === 'evento' ? tipoDe(e.evento.tipo_id) : FUENTES[e.registro.fuente]
  const resumen = (evs: Entrada[]) => {
    const m = new Map<string, { nombre: string; icono: string; color: string; n: number }>()
    evs.forEach((e) => {
      const tipo = tipoEntrada(e)
      if (!tipo) return
      const id = e.clase === 'evento' ? `evento-${e.evento.tipo_id}` : e.registro.fuente
      const actual = m.get(id)
      if (actual) actual.n++
      else m.set(id, { nombre: tipo.nombre, icono: tipo.icono, color: tipo.color, n: 1 })
    })
    return [...m.entries()]
  }
  const delDia = useMemo(() => [...(dia ? porDia.get(dia) ?? [] : [])].sort((a, b) => nombreEntrada(a).localeCompare(nombreEntrada(b), 'es')), [dia, porDia])

  const ir = (delta: number) => {
    const d = new Date(ym.y, ym.m + delta, 1)
    setYm({ y: d.getFullYear(), m: d.getMonth() })
  }
  const irHoy = () => { const d = new Date(); setYm({ y: d.getFullYear(), m: d.getMonth() }) }
  const esAutor = (e: Evento) => !ctl?.tipoNombre && e.user_id === user?.id

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
      {(error || dataActual?.errorExtra) && <div class="mb-2 space-y-2"><Alert tone="error">{error ? `No se pudo cargar el calendario: ${error}` : `No se pudieron cargar todos los registros distritales: ${dataActual?.errorExtra}`}</Alert><button type="button" class={BTN_SECONDARY} onClick={reload}>Reintentar</button></div>}
      {!dataActual && !error && <p class="mb-2 text-sm text-slate-500">Cargando calendario…</p>}

      <div class="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-center">
        {DIAS.map((d, i) => <div key={i} class="bg-slate-50 py-1.5 text-xs font-medium text-slate-500">{d}</div>)}
        {celdas.map((d) => {
          const k = key(d)
          const evs = porDia.get(k) ?? []
          const fuera = d.getMonth() !== ym.m
          return (
            <button key={k} type="button" onClick={() => { setDia(k); setDetalle(null); setDetalleRegistro(null) }} aria-label={`${diaLabel(k)}${evs.length ? `, ${evs.length} eventos` : ''}`}
              class={`flex min-h-14 flex-col items-center gap-1 p-1 text-sm sm:min-h-20 sm:items-start ${fuera ? 'bg-slate-50 text-slate-400' : 'bg-white text-slate-800'} hover:bg-sky-50`}>
              <span class={`flex size-7 items-center justify-center rounded-full text-xs font-medium ${k === hoy ? 'bg-sky-600 text-white' : ''}`}>{d.getDate()}</span>
              <span class="flex flex-wrap justify-center gap-0.5 sm:justify-start">
                {resumen(evs).map(([id, t]) => (
                  <span key={id} title={`${t.nombre}: ${t.n}`} class={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold leading-none ${col(t.color).chip}`}>
                    <Icon name={iconOr(t.icono)} class="size-3.5" />{t.n}
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>

      {(tipos.length > 0 || (!ctl && user?.role === 'distrital')) && (
        <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600" aria-label="Referencias">
          {tipos.map((t) => <li key={t.id} class="flex items-center gap-1.5"><span class={`size-2.5 rounded-full ${col(t.color).dot}`} />{t.nombre}</li>)}
          {!ctl && user?.role === 'distrital' && Object.entries(FUENTES).filter(([fuente]) => fuente !== 'salida' || !tipos.some((t) => t.nombre === 'Salida Educativa')).map(([fuente, t]) => <li key={fuente} class="flex items-center gap-1.5"><span class={`size-2.5 rounded-full ${col(t.color).dot}`} />{t.nombre}</li>)}
        </ul>
      )}

    {dia && !edit && (
        <Modal title={detalle?.nombre ?? detalleRegistro?.nombre ?? diaLabel(dia).replace(/^./, (c) => c.toUpperCase())} onClose={() => { setDia(null); setDetalle(null); setDetalleRegistro(null) }}>
          {detalleRegistro ? <div class="space-y-4">
            <div class="flex items-center gap-3"><span class={`flex size-12 shrink-0 items-center justify-center rounded-lg border ${col(FUENTES[detalleRegistro.fuente].color).card}`}><Icon name={iconOr(FUENTES[detalleRegistro.fuente].icono)} class="size-6" /></span>
              <div><span class={`rounded px-1.5 py-0.5 text-xs font-medium ${col(FUENTES[detalleRegistro.fuente].color).chip}`}>{FUENTES[detalleRegistro.fuente].nombre}</span><p class="mt-1 text-sm capitalize text-slate-600">{diaLabel(detalleRegistro.fecha)}</p></div></div>
            <dl class="space-y-2 text-sm">
              {detalleRegistro.estado && <div><dt class="text-xs uppercase text-slate-500">Estado</dt><dd>{detalleRegistro.estado}</dd></div>}
              {detalleRegistro.lugar && <div><dt class="text-xs uppercase text-slate-500">Lugar o destino</dt><dd>{detalleRegistro.lugar}</dd></div>}
              <div><dt class="text-xs uppercase text-slate-500">Detalle</dt><dd class="whitespace-pre-line">{detalleRegistro.descripcion}</dd></div>
            </dl>
            <div class="flex flex-wrap justify-between gap-2"><button type="button" class={BTN_SECONDARY} onClick={() => setDetalleRegistro(null)}>Volver</button><a class={BTN_PRIMARY} href={href(detalleRegistro.enlace)}>Abrir módulo</a></div>
          </div> : detalle ? (() => {
            const t = tipoDe(detalle.tipo_id); const c = col(t?.color)
            return (
              <div class="space-y-4">
                <div class="flex items-center gap-3">
                  <span class={`flex size-12 shrink-0 items-center justify-center rounded-lg border ${c.card}`}><Icon name={iconOr(t?.icono)} class="size-6" /></span>
                  <div><span class={`rounded px-1.5 py-0.5 text-xs font-medium ${c.chip}`}>{t?.nombre ?? 'Evento'}</span><p class="mt-1 text-sm capitalize text-slate-600">{diaLabel(detalle.fecha)}</p></div>
                </div>
                <dl class="space-y-2 text-sm">
                  <div><dt class="text-xs uppercase text-slate-500">Autor</dt><dd>{detalle.autor} · {ROLE_LABELS[detalle.rol]}</dd></div>
                  {detalle.hora && <div><dt class="text-xs uppercase text-slate-500">Hora</dt><dd>{detalle.hora.slice(0, 5)}</dd></div>}
                  {detalle.para_roles.length > 0 && <div><dt class="text-xs uppercase text-slate-500">Asignado a</dt><dd>{detalle.para_roles.map((r) => (r === 'areal' ? 'Areales' : 'Escuelas')).join(' y ')}</dd></div>}
                  {detalle.lugar && <div><dt class="text-xs uppercase text-slate-500">Lugar</dt><dd>{detalle.lugar}</dd></div>}
                  <div><dt class="text-xs uppercase text-slate-500">Descripción</dt><dd class="whitespace-pre-line">{detalle.descripcion || 'Sin descripción'}</dd></div>
                </dl>
                <div class="flex flex-wrap justify-between gap-2">
                  <button type="button" class={BTN_SECONDARY} onClick={() => setDetalle(null)}>Volver</button>
                  {esAutor(detalle) && (
                    <div class="flex gap-2">
                      <button type="button" class="min-h-11 rounded-md border border-red-300 px-4 text-sm font-medium text-red-600 hover:bg-red-50" onClick={() => eliminar(detalle)}>Eliminar</button>
                      {detalle.agenda_historica && detalle.nombre.trim().length < 3
                        ? <a class={BTN_PRIMARY} href={href('/agenda-areal')}>Editar en Agenda</a>
                        : <button type="button" class={BTN_PRIMARY} onClick={() => setEdit(detalle)}>Editar</button>}
                    </div>
                  )}
                </div>
              </div>
            )
          })() : (
            <div class="space-y-3">
              {!dataActual ? error ? <Alert tone="error">No se pudieron cargar los eventos de este mes.</Alert> : <Spinner /> : delDia.length === 0 ? <p class="text-sm text-slate-500">Sin eventos este día.</p> : (
                <ul class="space-y-2">
                  {delDia.map((entrada) => {
                    const t = tipoEntrada(entrada); const c = col(t?.color)
                    const autor = entrada.clase === 'evento' ? entrada.evento.autor : entrada.registro.estado
                    return (
                      <li key={idEntrada(entrada)}>
                        <button type="button" onClick={() => entrada.clase === 'evento' ? setDetalle(entrada.evento) : setDetalleRegistro(entrada.registro)} class="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-sky-300 hover:bg-sky-50">
                          <span class={`flex size-10 shrink-0 items-center justify-center rounded-lg border ${c.card}`}><Icon name={iconOr(t?.icono)} /></span>
                          <span class="min-w-0 flex-1"><span class="block truncate font-medium text-slate-900">{nombreEntrada(entrada)}</span><span class="block truncate text-xs text-slate-500">{t?.nombre ?? 'Evento'}{autor ? ` · ${autor}` : ''}</span></span>
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
