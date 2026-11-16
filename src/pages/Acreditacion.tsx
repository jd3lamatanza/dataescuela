import { useEffect, useRef, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync, useDebounced } from '../lib/hooks'
import { cargarEscuelas, fechaEvento, linkEvento, personaVacia, registrarManual, type Evento, type Persona, type Progreso } from '../lib/acreditacion'
import { estadoConstancia, tablaAcreditados } from '../lib/acreditacionListado'
import { buildListadoXlsx } from '../lib/escuelasListado'
import { buildPdf } from '../lib/export'
import { descargar, XLSX_MIME } from '../lib/download'
import { BRAND } from '../modules'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, TabBar, confirmar, toast, type TabItem } from '../ui/kit'
import { Icon, type IconKey } from '../ui/Icon'
import { CamposAcreditacion } from './RegistroAcreditacion'
import { etiquetaEscuela } from './PreinscripcionEav'

const TABS: TabItem[] = [
  { id: 'evento', label: 'Evento', icon: 'calendar', color: 'sky' },
  { id: 'acreditacion', label: 'Acreditación', icon: 'check', color: 'emerald' },
  { id: 'constancias', label: 'Constancias', icon: 'note', color: 'indigo' },
]
const errorText = (e: unknown) => e instanceof Error ? e.message : typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : 'No se pudo completar la operación.'
const datosEvento = () => ({ nombre: '', lugar: '', fecha: '', hora_inicio: '', hora_fin: '', descripcion: '' })
const ICON_BUTTON = 'inline-flex size-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50'

function AccionIcono({ icon, label, onClick, disabled = false, danger = false }: { icon: IconKey; label: string; onClick(): void; disabled?: boolean; danger?: boolean }) {
  return <button type="button" class={`${ICON_BUTTON} ${danger ? 'hover:border-red-300 hover:bg-red-50 hover:text-red-700' : ''}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}><Icon name={icon} /></button>
}

async function eventos(): Promise<Evento[]> {
  const { data, error } = await supabase.from('acreditacion_eventos').select('id,nombre,lugar,fecha,hora_inicio,hora_fin,descripcion,estado').order('fecha', { ascending: false })
  if (error) throw error
  return data as Evento[]
}

export function Acreditacion() {
  const [tab, setTab] = useState('evento')
  const { data, error, loading, reload } = useAsync(eventos, [])
  return <>
    <PageHeader title="Acreditación" subtitle="Asistencia y constancias de eventos distritales" />
    <TabBar label="Acreditación" items={TABS} active={tab} onChange={setTab} />
    {error && <Alert tone="error">{error}</Alert>}
    {loading && !data ? <Spinner /> : data && <>
      {tab === 'evento' && <Eventos eventos={data} reload={reload} />}
      {tab === 'acreditacion' && <Listado eventos={data} />}
      {tab === 'constancias' && <Constancias eventos={data} reloadEventos={reload} />}
    </>}
  </>
}

function Eventos({ eventos: lista, reload }: { eventos: Evento[]; reload(): void }) {
  const [editando, setEditando] = useState<Evento | 'nuevo' | null>(null)
  const [qr, setQr] = useState<Evento | null>(null)
  const cambiarEstado = async (e: Evento, estado: 'activo' | 'finalizado') => {
    const texto = estado === 'finalizado' ? 'Se cerrará la acreditación por QR. Podrás agregar personas manualmente y enviar constancias.' : 'Se habilitará nuevamente la acreditación mediante el QR.'
    if (!(await confirmar(estado === 'finalizado' ? 'Finalizar evento' : 'Iniciar acreditación', { text: texto }))) return
    const r = await supabase.rpc('acreditacion_estado_evento', { p_id: e.id, p_estado: estado })
    if (r.error) toast.error(r.error.message); else { toast.ok('Estado actualizado'); reload() }
  }
  const eliminar = async (e: Evento) => {
    if (!(await confirmar('Eliminar evento', { text: `¿Eliminar ${e.nombre}? No es posible eliminar eventos con acreditados.`, danger: true }))) return
    const r = await supabase.rpc('acreditacion_eliminar_evento', { p_id: e.id })
    if (r.error) toast.error(r.error.message); else { toast.ok('Evento eliminado'); reload() }
  }
  return <>
    <div class="mb-3 flex justify-end"><button class={BTN_PRIMARY} onClick={() => setEditando('nuevo')}><Icon name="plus" />Crear evento</button></div>
    {!lista.length ? <EmptyState title="Todavía no hay eventos" text="Creá un evento para comenzar." /> : <div class="space-y-3">{lista.map((e) => <Card key={e.id}>
      <div class="flex flex-wrap items-start justify-between gap-4"><div class="min-w-0 flex-1"><h2 class="font-semibold text-slate-900">{e.nombre}</h2><p class="mt-1 flex items-start gap-1.5 text-sm text-slate-600"><Icon name="calendar" class="mt-0.5 size-4 shrink-0" />{fechaEvento(e)} · {e.lugar}</p><p class="mt-1 text-sm text-slate-600">{e.descripcion}</p><div class="mt-2"><Badge tone={e.estado === 'activo' ? 'green' : e.estado === 'finalizado' ? 'slate' : 'amber'}><Icon name={e.estado === 'activo' ? 'check' : e.estado === 'finalizado' ? 'lock' : 'clock'} class="mr-1 size-4" />{e.estado === 'activo' ? 'Acreditación activa' : e.estado === 'finalizado' ? 'Finalizado' : 'Sin iniciar'}</Badge></div></div>
      <div class="flex flex-wrap gap-2"><AccionIcono icon="grid" label={`Compartir QR de ${e.nombre}`} onClick={() => setQr(e)} />
        {e.estado !== 'finalizado' && <><AccionIcono icon="edit" label={`Editar ${e.nombre}`} onClick={() => setEditando(e)} /><AccionIcono icon="trash" label={`Eliminar ${e.nombre}`} danger onClick={() => eliminar(e)} /></>}
        <AccionIcono icon={e.estado === 'activo' ? 'lock' : 'power'} label={`${e.estado === 'activo' ? 'Finalizar evento' : e.estado === 'finalizado' ? 'Reabrir evento' : 'Iniciar acreditación'}: ${e.nombre}`} onClick={() => cambiarEstado(e, e.estado === 'activo' ? 'finalizado' : 'activo')} />
      </div></div>
    </Card>)}</div>}
    {editando && <EventoForm evento={editando === 'nuevo' ? null : editando} onClose={() => setEditando(null)} onDone={() => { setEditando(null); reload() }} />}
    {qr && <EventoQr evento={qr} onClose={() => setQr(null)} />}
  </>
}

function EventoForm({ evento, onClose, onDone }: { evento: Evento | null; onClose(): void; onDone(): void }) {
  const [form, setForm] = useState(() => evento ? { nombre: evento.nombre, lugar: evento.lugar, fecha: evento.fecha, hora_inicio: evento.hora_inicio.slice(0, 5), hora_fin: evento.hora_fin.slice(0, 5), descripcion: evento.descripcion } : datosEvento())
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const set = (k: keyof typeof form) => (e: Event) => setForm((v) => ({ ...v, [k]: (e.currentTarget as HTMLInputElement).value }))
  const guardar = async (e: Event) => {
    e.preventDefault(); setError('')
    if (form.hora_inicio >= form.hora_fin) { setError('La hora de finalización debe ser posterior al inicio.'); return }
    setBusy(true)
    const r = await supabase.rpc('acreditacion_guardar_evento', { p_id: evento?.id ?? null, p_nombre: form.nombre, p_lugar: form.lugar, p_fecha: form.fecha, p_inicio: form.hora_inicio, p_fin: form.hora_fin, p_descripcion: form.descripcion })
    setBusy(false)
    if (r.error) setError(r.error.message); else { toast.ok('Evento guardado'); onDone() }
  }
  return <Modal title={evento ? 'Editar evento' : 'Crear evento'} onClose={onClose}><form class="space-y-4" onSubmit={guardar}>
    {error && <Alert tone="error">{error}</Alert>}
    <Lbl label="Nombre"><input class={FIELD} required minLength={3} maxLength={200} value={form.nombre} onInput={set('nombre')} /></Lbl>
    <Lbl label="Lugar"><input class={FIELD} required minLength={3} maxLength={200} value={form.lugar} onInput={set('lugar')} /></Lbl>
    <Lbl label="Fecha"><input class={FIELD} type="date" required value={form.fecha} onInput={set('fecha')} /></Lbl>
    <div class="grid grid-cols-2 gap-3"><Lbl label="Hora de inicio"><input class={FIELD} type="time" required value={form.hora_inicio} onInput={set('hora_inicio')} /></Lbl><Lbl label="Hora de finalización"><input class={FIELD} type="time" required value={form.hora_fin} onInput={set('hora_fin')} /></Lbl></div>
    <Lbl label="Descripción breve"><textarea class={FIELD} required maxLength={1000} value={form.descripcion} onInput={set('descripcion')} /></Lbl>
    <button class={BTN_PRIMARY} disabled={busy}><Icon name="check" />{busy ? 'Guardando…' : 'Guardar evento'}</button>
  </form></Modal>
}

function EventoQr({ evento, onClose }: { evento: Evento; onClose(): void }) {
  const [qr, setQr] = useState(''), [error, setError] = useState('')
  const url = linkEvento(evento.id)
  useEffect(() => {
    let vivo = true
    import('qrcode').then(({ default: q }) => q.toDataURL(url, { width: 512, margin: 2 })).then((data) => { if (vivo) setQr(data) }).catch((e) => { if (vivo) setError(errorText(e)) })
    return () => { vivo = false }
  }, [url])
  return <Modal title="Compartir acreditación" onClose={onClose}><div class="space-y-3 text-center">
    <p>{evento.nombre}</p>{error && <Alert tone="error">{error}</Alert>}
    {qr ? <img src={qr} alt="Código QR de acreditación" class="mx-auto w-64 max-w-full" /> : !error && <Spinner />}
    <a class="block break-all text-sm text-sky-700 underline" href={url}>{url}</a>
    {qr && <a class={BTN_PRIMARY} href={qr} download={`qr-acreditacion-${evento.id}.png`}><Icon name="download" />Descargar QR</a>}
  </div></Modal>
}

function Listado({ eventos: lista }: { eventos: Evento[] }) {
  const activos = lista.filter((e) => e.estado === 'activo')
  const [id, setId] = useState('')
  const evento = activos.find((e) => e.id === id)
  return <>
    <Lbl label="Evento activo"><select class={FIELD} value={id} onChange={(e) => setId(e.currentTarget.value)}><option value="">Seleccioná un evento</option>{activos.map((e) => <option value={e.id}>{e.nombre} · {fechaEvento(e)}</option>)}</select></Lbl>
    {evento && <Personas key={id} evento={evento} manual />}
  </>
}

function Personas({ evento, manual, refreshKey = 0 }: { evento: Evento; manual?: boolean; refreshKey?: number }) {
  const [q, setQ] = useState(''), [page, setPage] = useState(1), [abrir, setAbrir] = useState(false)
  const [exportando, setExportando] = useState(false)
  const filtro = q.trim().replace(/[,()%*\\]/g, ' ').slice(0, 80)
  const query = useDebounced(filtro)
  const consulta = (busqueda: string) => {
    let request = supabase.from('acreditacion_personas').select('id,nombre,dni,cargo,escuela_id,email,constancia_enviada_en,envio_estado,escuela:escuelas(id,nombre,tipo,numero,codigo,localidad,eav)', { count: 'exact' }).eq('evento_id', evento.id)
    if (busqueda) request = request.or(`nombre.ilike.%${busqueda}%,dni.ilike.%${busqueda}%,cargo.ilike.%${busqueda}%,email.ilike.%${busqueda}%`)
    return request.order('id', { ascending: false })
  }
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await consulta(query).range((page - 1) * 15, page * 15 - 1)
    if (r.error) throw r.error
    const personas: Persona[] = r.data.map((p) => ({ ...p, escuela: Array.isArray(p.escuela) ? p.escuela[0] ?? null : p.escuela }))
    return { personas, total: r.count ?? 0 }
  }, [evento.id, query, page, refreshKey])
  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    setExportando(true)
    try {
      const personas: Persona[] = []
      for (let offset = 0; ; offset += 500) {
        const r = await consulta(filtro).range(offset, offset + 499)
        if (r.error) throw r.error
        personas.push(...r.data.map((p) => ({ ...p, escuela: Array.isArray(p.escuela) ? p.escuela[0] ?? null : p.escuela })))
        if (r.data.length < 500) break
      }
      if (!personas.length) { toast.info('No hay acreditados para exportar con esta búsqueda.'); return }
      const tabla = tablaAcreditados(evento, personas, filtro, BRAND.org)
      const nombre = `acreditados-${evento.fecha}-${evento.id}`
      if (tipo === 'xlsx') descargar(await buildListadoXlsx(tabla, BRAND.name, 'Acreditados'), `${nombre}.xlsx`, XLSX_MIME)
      else {
        const respuesta = await fetch(`${import.meta.env.BASE_URL}icon-192.png`)
        if (!respuesta.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        descargar(await buildPdf(tabla, { brand: { name: BRAND.name, logo: new Uint8Array(await respuesta.arrayBuffer()) }, maxCellLines: 60 }), `${nombre}.pdf`, 'application/pdf')
      }
    } catch (e) { toast.error(`No se pudo exportar el listado: ${errorText(e)}`) }
    finally { setExportando(false) }
  }
  return <div class="mt-4"><div class="mb-3 flex flex-wrap items-center gap-2"><div class="relative min-w-0 flex-1 basis-64"><Icon name="search" class="pointer-events-none absolute left-3 top-3 size-5 text-slate-400" /><input class={`${FIELD} pl-10`} aria-label="Buscar acreditados" type="search" placeholder="Buscar por nombre, DNI, cargo o correo" value={q} onInput={(e) => { setQ(e.currentTarget.value); setPage(1) }} /></div>
    {manual && <button class={BTN_PRIMARY} onClick={() => setAbrir(true)}><Icon name="plus" />Agregar acreditado</button>}
    <button type="button" class={BTN_SECONDARY} aria-label="Exportar acreditados a Excel" disabled={exportando || loading || !!error || query !== filtro || !data?.total} onClick={() => exportar('xlsx')}><Icon name="download" />Excel</button>
    <button type="button" class={BTN_SECONDARY} aria-label="Exportar acreditados a PDF" disabled={exportando || loading || !!error || query !== filtro || !data?.total} onClick={() => exportar('pdf')}><Icon name="download" />PDF</button>
    </div>
    <p class="mb-3 text-xs text-slate-500">{exportando ? 'Preparando exportación…' : 'Las exportaciones incluyen todos los resultados de la búsqueda, no solo esta página.'}</p>
    {error && <Alert tone="error">{error}</Alert>}{loading && !data ? <Spinner /> : !data?.personas.length ? <EmptyState title="Sin acreditados" text={query ? 'No hay resultados para esta búsqueda.' : 'Todavía no hay personas acreditadas en este evento.'} /> : <div class="space-y-2">{data.personas.map((p) => { const estado = estadoConstancia(p); return <article key={p.id} class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="flex flex-wrap items-start justify-between gap-2"><div class="flex min-w-0 gap-3"><span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-700"><Icon name="users" /></span><div class="min-w-0"><h3 class="break-words font-semibold text-slate-900">{p.nombre}</h3><p class="text-sm text-slate-500">DNI {p.dni} · {p.cargo}</p></div></div><Badge tone={estado.tone}><Icon name={estado.icon} class="mr-1 size-4" />Constancia {estado.texto.toLowerCase()}</Badge></div>
      <div class="mt-3 grid gap-1.5 text-sm text-slate-600 sm:ml-13"><p class="flex items-start gap-2"><Icon name="school" class="mt-0.5 size-4 shrink-0" /><span class="break-words">{p.escuela ? etiquetaEscuela(p.escuela) : `Escuela ${p.escuela_id}`}</span></p><p class="flex items-start gap-2"><Icon name="mail" class="mt-0.5 size-4 shrink-0" /><span class="break-all">{p.email}</span></p>{estado.detalle && <p class="flex items-start gap-2 text-xs"><Icon name={estado.icon} class="size-4 shrink-0" />{estado.detalle}</p>}</div>
    </article> })}</div>}
    <Pager page={page} total={data?.total ?? 0} onPage={setPage} />
    {abrir && <RegistroManual evento={evento.id} onClose={() => setAbrir(false)} onDone={() => { setAbrir(false); reload() }} />}
  </div>
}

function RegistroManual({ evento, onClose, onDone }: { evento: string; onClose(): void; onDone(): void }) {
  const escuelas = useAsync(cargarEscuelas, [])
  const [form, setForm] = useState(personaVacia), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const guardar = async (e: Event) => {
    e.preventDefault(); setError(''); setBusy(true)
    try { await registrarManual(evento, form); toast.ok('Acreditación registrada'); onDone() }
    catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }
  return <Modal title="Agregar acreditado" onClose={onClose}><div class="eav-public" style="min-height:0;padding:0;background:white">
    {escuelas.error && <Alert tone="error">{escuelas.error}</Alert>}
    {!escuelas.data ? <Spinner /> : <form onSubmit={guardar} class="space-y-4">{error && <Alert tone="error">{error}</Alert>}<CamposAcreditacion form={form} setForm={setForm} escuelas={escuelas.data} /><button class={BTN_PRIMARY} disabled={busy}><Icon name="check" />{busy ? 'Guardando…' : 'Guardar acreditación'}</button></form>}
  </div></Modal>
}

function Constancias({ eventos: lista, reloadEventos }: { eventos: Evento[]; reloadEventos(): void }) {
  const [id, setId] = useState('')
  const evento = lista.find((e) => e.id === id)
  return <div class="space-y-4">
    <Firmas />
    <Lbl label="Evento"><select class={FIELD} value={id} onChange={(e) => setId(e.currentTarget.value)}><option value="">Seleccioná un evento</option>{lista.map((e) => <option value={e.id}>{e.nombre} · {fechaEvento(e)}</option>)}</select></Lbl>
    {evento && <Envios key={evento.id} evento={evento} reloadEventos={reloadEventos} />}
  </div>
}

function Firmas() {
  const { data, error, reload } = useAsync(async () => {
    const r = await supabase.from('acreditacion_firmas').select('id,nombre,mime').order('id')
    if (r.error) throw r.error
    return r.data as { id: number; nombre: string; mime: string }[]
  }, [])
  const [busy, setBusy] = useState(false)
  const cargar = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024 || !file.size) { toast.error('Elegí una imagen PNG o JPEG de hasta 2 MB.'); return }
    if ((data?.length ?? 0) >= 6) { toast.error('Se admiten hasta seis imágenes.'); return }
    setBusy(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1]) : reject(new Error('No se pudo leer la imagen.'))
        reader.readAsDataURL(file)
      })
      const r = await supabase.rpc('acreditacion_guardar_firma', { p_nombre: file.name.slice(0, 150), p_mime: file.type, p_base64: base64 })
      if (r.error) throw r.error
      toast.ok('Imagen guardada'); reload()
    } catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
  }
  const eliminar = async (id: number) => {
    if (!(await confirmar('Eliminar imagen de firma', { text: 'Las próximas constancias dejarán de incluir esta imagen.', danger: true }))) return
    const r = await supabase.rpc('acreditacion_eliminar_firma', { p_id: id })
    if (r.error) toast.error(r.error.message); else reload()
  }
  return <Card title="Sellos y firmas">
    <p class="mb-3 text-sm text-slate-600">Cargá hasta seis imágenes PNG o JPEG de hasta 2 MB. Se colocan una junto a otra en la constancia.</p>
    {error && <Alert tone="error">{error}</Alert>}
    <ul class="mb-3 space-y-2">{data?.map((f) => <li key={f.id} class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm"><span class="flex min-w-0 items-center gap-2 break-all"><Icon name="attachment" class="size-4 shrink-0 text-sky-600" />{f.nombre}</span><AccionIcono icon="trash" label={`Quitar imagen ${f.nombre}`} danger onClick={() => eliminar(f.id)} /></li>)}</ul>
    <label class={BTN_SECONDARY}><Icon name="plus" />{busy ? 'Cargando…' : 'Cargar imagen'}<input type="file" accept="image/png,image/jpeg" class="sr-only" disabled={busy} onChange={cargar} /></label>
  </Card>
}

function Envios({ evento, reloadEventos }: { evento: Evento; reloadEventos(): void }) {
  const [version, setVersion] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [parcial, setParcial] = useState<Progreso | null>(null)
  const vivo = useRef(true)
  useEffect(() => () => { vivo.current = false }, [])
  const progreso = useAsync(async () => {
    const r = await supabase.rpc('acreditacion_progreso_envios', { p_evento: evento.id }).single()
    if (r.error) throw r.error
    return r.data as Progreso
  }, [evento.id, version])
  const valor = parcial ?? progreso.data
  const finalizar = async () => {
    if (!(await confirmar('Confirmar finalización', { text: 'Se cerrará la acreditación por QR. Podrás agregar personas manualmente y enviar constancias.' }))) return
    const r = await supabase.rpc('acreditacion_estado_evento', { p_id: evento.id, p_estado: 'finalizado' })
    if (r.error) setError(r.error.message); else { toast.ok('Evento finalizado'); reloadEventos() }
  }
  const enviar = async () => {
    if (evento.estado !== 'finalizado') { setError('Debés confirmar la finalización del evento antes de enviar constancias.'); return }
    if (!(await confirmar('Enviar constancias', { text: 'Se enviarán hasta 100 constancias pendientes, una a la vez. Un reintento de un envío sin confirmar podría duplicar el correo.', ok: 'Iniciar envío' }))) return
    setError(''); setBusy(true)
    try {
      const fechaLimite = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const candidatos = await supabase.from('acreditacion_personas').select('id').eq('evento_id', evento.id)
        .or(`envio_estado.eq.pendiente,envio_estado.eq.incierto,and(envio_estado.eq.enviando,envio_iniciado_en.lt.${fechaLimite})`)
        .order('id').limit(100)
      if (candidatos.error) throw candidatos.error
      for (const persona of candidatos.data) {
        if (!vivo.current) break
        const r = await supabase.functions.invoke('acreditacion-constancia', { body: { evento: evento.id, persona: persona.id } })
        if (r.error) {
          let detalle = r.error.message
          if (r.error.context instanceof Response) {
            const body = await r.error.context.json().catch(() => null)
            if (body?.error) detalle = body.error
          }
          throw new Error(detalle)
        }
        const p = await supabase.rpc('acreditacion_progreso_envios', { p_evento: evento.id }).single()
        if (p.error) throw p.error
        if (vivo.current) setParcial(p.data as Progreso)
      }
      if (vivo.current) toast.ok(candidatos.data.length === 100 ? 'Tanda de 100 constancias completada.' : 'Tanda de constancias completada.')
    } catch (e) { if (vivo.current) setError(errorText(e)) }
    finally { if (vivo.current) { setBusy(false); setParcial(null); setVersion((v) => v + 1) } }
  }
  return <div class="space-y-4">
    <Card title="Envío de constancias">
      {evento.estado !== 'finalizado' && <div class="mb-3"><Alert tone="warning">Confirmá la finalización del evento para habilitar el envío. El QR dejará de aceptar registros.</Alert></div>}
      {error && <div class="mb-3"><Alert tone="error">{error}</Alert></div>}
      {progreso.error && <Alert tone="error">{progreso.error}</Alert>}
      {valor && <div class="space-y-2"><p class="flex flex-wrap items-center gap-2 font-semibold"><Icon name="send" class="size-5 text-sky-600" />{valor.enviados} de {valor.total} enviados · {valor.pendientes} pendientes</p>
        <progress class="w-full" max={Math.max(valor.total, 1)} value={valor.enviados} aria-label="Progreso del envío de constancias" />
        {valor.inciertos > 0 && <p class="text-sm text-amber-700">{valor.inciertos} envío(s) sin confirmar se consideran pendientes. Al reintentarlos podrían duplicarse.</p>}
        {valor.en_curso > 0 && <p class="text-sm">Hay un envío en curso. Esperá antes de continuar.</p>}
      </div>}
      <div class="mt-4 flex flex-wrap gap-2">
        {evento.estado === 'activo' && <button class={BTN_SECONDARY} disabled={busy} onClick={finalizar}><Icon name="lock" />Confirmar finalización</button>}
        <button class={BTN_PRIMARY} disabled={busy || evento.estado !== 'finalizado' || !valor || !valor.pendientes || !!valor.en_curso} onClick={enviar}><Icon name="send" />{busy ? 'Enviando…' : `Continuar envío: ${valor?.enviados ?? 0} de ${valor?.total ?? 0}`}</button>
      </div>
      {busy && <p class="mt-2 text-sm text-slate-600">No cierres esta pantalla hasta completar la tanda. Si salís, podrás continuar luego.</p>}
    </Card>
    <Personas evento={evento} manual refreshKey={version} />
  </div>
}
