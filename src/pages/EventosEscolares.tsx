import { useState } from 'preact/hooks'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/hooks'
import { setParams, useRoute } from '../lib/router'
import { supabase } from '../lib/supabase'
import { escuelaArticulada, escuelaEvento, escuelaRealizacion, horarioRealizacion, leerEscuelasEventos, leerRealizaciones, leerSeguimiento, leerTiposEscolares, ordenarTiposEscolares, tablaSeguimiento, type EscuelaEvento, type OrdenEventos, type RealizacionEscolar, type TipoEventoEscolar } from '../lib/eventosEscolares'
import { buildListadoXlsx } from '../lib/escuelasListado'
import { buildPdf } from '../lib/export'
import { descargar, XLSX_MIME } from '../lib/download'
import { BRAND } from '../modules'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, TabBar, confirmar, toast } from '../ui/kit'

const TAMANO = 20
const fecha = (s: string) => s.split('-').reverse().join('/')
const mensajeError = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
const ordenarEscuelas = <T extends EscuelaEvento>(escuelas: T[]) => [...escuelas].sort((a, b) => escuelaEvento(a).localeCompare(escuelaEvento(b), 'es') || a.id - b.id)

export function EventosEscolares() {
  const { user } = useAuth()
  const { params } = useRoute()
  const [tab, setTab] = useState('catalogo')
  const [revision, setRevision] = useState(0)
  const valorId = params.get('realizacion')
  const id = valorId && /^[1-9]\d*$/.test(valorId) && Number.isSafeInteger(Number(valorId)) ? Number(valorId) : null
  const detalle = useAsync(async () => ({ id, filas: id ? await leerRealizaciones(undefined, undefined, id) : [] }), [id, revision, user?.id, user?.role])
  if (!user || !['escolar', 'areal', 'distrital'].includes(user.role)) return null
  return <>
    <PageHeader title="Eventos Escolares" subtitle={user.role === 'distrital' ? 'Definí los eventos y seguí las cargas de las escuelas.' : user.role === 'escolar' ? 'Registrá las realizaciones de tu escuela y sus articulaciones.' : 'Consultá los eventos de tus escuelas asignadas.'} />
    {user.role === 'distrital' ? <>
      <TabBar label="Eventos escolares" items={[
        { id: 'catalogo', label: 'Eventos', icon: 'calendar', color: 'sky' },
        { id: 'seguimiento', label: 'Seguimiento', icon: 'chart', color: 'emerald' },
      ]} active={tab} onChange={setTab} />
      {tab === 'catalogo' ? <Catalogo onChange={() => setRevision((n) => n + 1)} /> : <Seguimiento />}
    </> : <Realizaciones cue={user.cue} escolar={user.role === 'escolar'} onChange={() => setRevision((n) => n + 1)} />}
    {valorId && <Modal title="Detalle del evento escolar" onClose={() => setParams({ realizacion: null })}>
      {id === null ? <Alert tone="error">Identificador de evento inválido.</Alert> : detalle.loading ? <Spinner /> :
        detalle.error ? <Alert tone="error">{detalle.error}</Alert> : detalle.data?.id !== id ? <Spinner /> :
          detalle.data.filas[0] ? <Detalle r={detalle.data.filas[0]} /> : <Alert tone="warning">El evento no existe o no tenés acceso.</Alert>}
      <div class="mt-4 flex justify-end"><button type="button" class={BTN_SECONDARY} onClick={() => setParams({ realizacion: null })}>Cerrar</button></div>
    </Modal>}
  </>
}

function Catalogo({ onChange }: { onChange(): void }) {
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [editando, setEditando] = useState<TipoEventoEscolar | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<OrdenEventos>('nombre-asc')
  const { data, error, loading, reload } = useAsync(leerTiposEscolares, [])
  const guardar = async (e: Event) => {
    e.preventDefault()
    setGuardando(true)
    try {
      const { error } = editando
        ? await supabase.rpc('eventos_escolares_renombrar_tipo', { p_id: editando.id, p_nombre: nombre })
        : await supabase.rpc('eventos_escolares_crear_tipo', { p_nombre: nombre })
      if (error) throw error
      setNombre(''); setEditando(null); reload(); onChange(); toast.ok(editando ? 'Evento actualizado' : 'Evento creado')
    } catch (e) { toast.error(`No se pudo guardar el evento: ${mensajeError(e)}`) }
    finally { setGuardando(false) }
  }
  const eliminar = async (evento: TipoEventoEscolar) => {
    if (!(await confirmar('Eliminar evento', { text: `Se eliminará «${evento.nombre}» si no tiene realizaciones registradas.`, ok: 'Eliminar', danger: true }))) return
    setGuardando(true)
    try {
      const { error } = await supabase.rpc('eventos_escolares_eliminar_tipo', { p_id: evento.id })
      if (error) throw error
      if (editando?.id === evento.id) { setEditando(null); setNombre('') }
      reload(); onChange(); toast.ok('Evento eliminado')
    } catch (e) { toast.error(`No se pudo eliminar el evento: ${mensajeError(e)}`) }
    finally { setGuardando(false) }
  }
  const filas = ordenarTiposEscolares(data ?? [], busqueda, orden)
  return <div class="mt-4 space-y-4">
    <Card title={editando ? 'Editar evento' : 'Crear evento'}>
      <form class="flex flex-wrap items-end gap-3" onSubmit={(e) => void guardar(e)}>
        <div class="min-w-0 flex-1"><Lbl label="Nombre del evento"><input class={FIELD} value={nombre} minLength={2} maxLength={150} required disabled={guardando} onInput={(e) => setNombre(e.currentTarget.value)} /></Lbl></div>
        {editando && <button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={() => { setEditando(null); setNombre('') }}>Cancelar</button>}
        <button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear evento'}</button>
      </form>
      {editando && <p class="mt-2 text-xs text-slate-500">El nuevo nombre también se mostrará en las realizaciones existentes.</p>}
    </Card>
    <Card title="Eventos disponibles">
      <div class="mb-3 grid gap-3 sm:grid-cols-2">
        <Lbl label="Buscar evento"><input type="search" class={FIELD} value={busqueda} onInput={(e) => setBusqueda(e.currentTarget.value)} /></Lbl>
        <Lbl label="Ordenar por"><select class={FIELD} value={orden} onChange={(e) => setOrden(e.currentTarget.value as OrdenEventos)}>
          <option value="nombre-asc">Nombre: A a Z</option><option value="nombre-desc">Nombre: Z a A</option>
          <option value="recientes">Más recientes</option><option value="antiguos">Más antiguos</option>
        </select></Lbl>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : loading ? <Spinner /> : !data?.length ? <EmptyState title="Todavía no hay eventos" text="Creá uno para que las escuelas puedan registrarlo." /> :
        !filas.length ? <EmptyState title="Sin resultados" text="No hay eventos con esa búsqueda." /> :
          <ul class="divide-y divide-slate-100">{filas.map((e) => <li key={e.id} class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm font-medium text-slate-800">
            <span class="min-w-0 break-words">{e.nombre}</span><span class="flex gap-2">
              <button type="button" class={BTN_SECONDARY} disabled={guardando} aria-label={`Editar ${e.nombre}`} onClick={() => { setEditando(e); setNombre(e.nombre) }}>Editar</button>
              <button type="button" class={BTN_SECONDARY} disabled={guardando} aria-label={`Eliminar ${e.nombre}`} onClick={() => void eliminar(e)}>Eliminar</button>
            </span></li>)}</ul>}
    </Card>
  </div>
}

function Seguimiento() {
  const [evento, setEvento] = useState('')
  const [estado, setEstado] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)
  const [escuelaDetalle, setEscuelaDetalle] = useState<number | null>(null)
  const tipos = useAsync(leerTiposEscolares, [])
  const datos = useAsync(async () => ({
    evento, filas: evento ? await leerSeguimiento(Number(evento)) : [],
    realizaciones: evento ? await leerRealizaciones(undefined, undefined, undefined, Number(evento)) : [],
  }), [evento])
  const actual = !datos.loading && !datos.error && datos.data?.evento === evento ? datos.data : null
  const buscar = busqueda.trim().toLocaleLowerCase('es')
  const filas = ordenarEscuelas(actual?.filas ?? []).filter((e) =>
    (!estado || (estado === 'cargado') === e.cargado) && (!buscar || `${escuelaEvento(e)} ${e.cue} ${e.nivel ?? ''} ${e.localidad ?? ''}`.toLocaleLowerCase('es').includes(buscar)))
  const nombre = tipos.data?.find((t) => String(t.id) === evento)?.nombre ?? ''
  const detalle = actual?.realizaciones.filter((r) => r.escuela_id === escuelaDetalle || r.articulada_id === escuelaDetalle) ?? []
  const exportar = async (formato: 'xlsx' | 'pdf') => {
    setExportando(true)
    try {
      const tabla = tablaSeguimiento(filas, nombre, BRAND.org)
      if (formato === 'xlsx') descargar(await buildListadoXlsx(tabla, BRAND.name, 'Seguimiento'), 'eventos-escolares.xlsx', XLSX_MIME)
      else {
        const logo = await fetch(`${import.meta.env.BASE_URL}icon-192.png`)
        if (!logo.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        descargar(await buildPdf(tabla, { brand: { name: BRAND.name, logo: new Uint8Array(await logo.arrayBuffer()) }, maxCellLines: 10 }), 'eventos-escolares.pdf', 'application/pdf')
      }
    } catch (e) { toast.error(`No se pudo exportar: ${mensajeError(e)}`) }
    finally { setExportando(false) }
  }
  return <div class="mt-4 space-y-4">
    {tipos.error && <Alert tone="error">{tipos.error}</Alert>}
    <div class="grid gap-3 sm:grid-cols-3">
      <Lbl label="Evento"><select class={FIELD} value={evento} onChange={(e) => { setEvento(e.currentTarget.value); setPagina(1) }}>
        <option value="">Seleccioná un evento</option>{[...(tipos.data ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
      </select></Lbl>
      <Lbl label="Estado"><select class={FIELD} value={estado} onChange={(e) => { setEstado(e.currentTarget.value); setPagina(1) }}>
        <option value="">Todos</option><option value="cargado">Cargado</option><option value="pendiente">Pendiente</option>
      </select></Lbl>
      <Lbl label="Buscar escuela"><input class={FIELD} type="search" value={busqueda} onInput={(e) => { setBusqueda(e.currentTarget.value); setPagina(1) }} /></Lbl>
    </div>
    {evento && <p class="text-sm text-slate-500">Las escuelas articuladas cuentan como participantes. Una escuela puede tener varias realizaciones.</p>}
    {datos.error && <div class="space-y-2"><Alert tone="error">{datos.error}</Alert><button type="button" class={BTN_SECONDARY} onClick={datos.reload}>Reintentar</button></div>}
    {evento && datos.loading && <Spinner />}
    {evento && actual && <>
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone="green">{actual.filas.filter((e) => e.cargado).length} cargadas</Badge><Badge tone="amber">{actual.filas.filter((e) => !e.cargado).length} pendientes</Badge>
        <button type="button" class={BTN_SECONDARY} disabled={!filas.length || exportando} onClick={() => void exportar('xlsx')}>Excel</button>
        <button type="button" class={BTN_SECONDARY} disabled={!filas.length || exportando} onClick={() => void exportar('pdf')}>PDF</button>
        <span class="text-xs text-slate-500">{exportando ? 'Preparando exportación…' : 'Se exportan todas las escuelas filtradas.'}</span>
      </div>
      {!filas.length ? <EmptyState title="Sin escuelas" text="No hay escuelas con esos filtros." /> :
        <div class="space-y-2">{filas.slice((pagina - 1) * TAMANO, pagina * TAMANO).map((e) =>
          <div key={e.id} class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <div class="min-w-0"><p class="break-words font-medium text-slate-900">{escuelaEvento(e)}</p><p class="text-xs text-slate-500">CUE {e.cue} · {[e.nivel, e.modalidad, e.localidad].filter(Boolean).join(' · ')}</p></div>
            <div class="flex items-center gap-2"><Badge tone={e.cargado ? 'green' : 'amber'}>{e.cargado ? 'Cargado' : 'Pendiente'}</Badge>
              {e.cargado && <button type="button" class={BTN_SECONDARY} onClick={() => setEscuelaDetalle(e.id)}>Ver cargas</button>}</div>
          </div>)}</div>}
      <Pager page={pagina} total={filas.length} size={TAMANO} onPage={setPagina} />
      {escuelaDetalle !== null && <Modal title="Realizaciones de la escuela" onClose={() => setEscuelaDetalle(null)} wide>
        <div class="space-y-4">{detalle.map((r) => <div key={r.id} class="rounded-lg border border-slate-200 p-3"><Detalle r={r} /></div>)}</div>
      </Modal>}
    </>}
  </div>
}

function Realizaciones({ cue, escolar, onChange }: { cue: string | null; escolar: boolean; onChange(): void }) {
  const [edit, setEdit] = useState<RealizacionEscolar | 'nueva' | null>(null)
  const [pagina, setPagina] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [eliminando, setEliminando] = useState<number | null>(null)
  const datos = useAsync(async () => {
    const [filas, tipos, escuelas] = await Promise.all([leerRealizaciones(), escolar ? leerTiposEscolares() : Promise.resolve([]), escolar ? leerEscuelasEventos() : Promise.resolve([])])
    return { filas, tipos, escuelas }
  }, [escolar, cue])
  const texto = busqueda.trim().toLocaleLowerCase('es')
  const filas = [...(datos.data?.filas ?? [])].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
    .filter((r) => !texto || `${r.evento} ${escuelaRealizacion(r)} ${escuelaArticulada(r)} ${r.lugar}`.toLocaleLowerCase('es').includes(texto))
  const eliminar = async (r: RealizacionEscolar) => {
    if (!(await confirmar('Eliminar evento escolar', { text: `Se eliminará la realización de «${r.evento}» para todas las escuelas participantes.`, ok: 'Eliminar', danger: true }))) return
    setEliminando(r.id)
    try {
      const { error } = await supabase.rpc('eventos_escolares_eliminar', { p_id: r.id })
      if (error) throw error
      toast.ok('Realización eliminada'); datos.reload(); onChange()
    } catch (e) { toast.error(`No se pudo eliminar: ${mensajeError(e)}`) }
    finally { setEliminando(null) }
  }
  return <>
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="min-w-0 flex-1"><Lbl label="Buscar evento o escuela"><input type="search" class={FIELD} value={busqueda} onInput={(e) => { setBusqueda(e.currentTarget.value); setPagina(1) }} /></Lbl></div>
      {escolar && <button type="button" class={BTN_PRIMARY} disabled={datos.loading || !!datos.error} onClick={() => setEdit('nueva')}>Cargar evento</button>}
    </div>
    {datos.error ? <div class="space-y-2"><Alert tone="error">{datos.error}</Alert><button type="button" class={BTN_SECONDARY} onClick={datos.reload}>Reintentar</button></div> :
      datos.loading ? <Spinner /> : !filas.length ? <EmptyState title="Sin realizaciones" text="No hay eventos escolares para mostrar." /> :
        <div class="space-y-3">{filas.slice((pagina - 1) * TAMANO, pagina * TAMANO).map((r) => <Card key={r.id}>
          <div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0 flex-1">
            <h2 class="break-words font-semibold text-slate-900">{r.evento}</h2>
            <p class="mt-1 text-sm text-slate-600">{fecha(r.fecha)} · {horarioRealizacion(r)} · {r.lugar}</p>
            <p class="mt-1 text-sm text-slate-600">{escuelaRealizacion(r)}{escuelaArticulada(r) && ` · Articulado con ${escuelaArticulada(r)}`}</p>
          </div><div class="flex flex-wrap gap-2">
            <button type="button" class={BTN_SECONDARY} onClick={() => setParams({ realizacion: r.id })}>Ver detalle</button>
            {escolar && cue === r.escuela_cue && <><button type="button" class={BTN_SECONDARY} disabled={eliminando !== null} onClick={() => setEdit(r)}>Editar</button>
              <button type="button" class={BTN_SECONDARY} disabled={eliminando !== null} onClick={() => void eliminar(r)}>Eliminar</button></>}
          </div></div>
        </Card>)}</div>}
    <Pager page={pagina} total={filas.length} size={TAMANO} onPage={setPagina} />
    {edit && datos.data && <Formulario realizacion={edit === 'nueva' ? null : edit} cue={cue} tipos={datos.data.tipos} escuelas={datos.data.escuelas}
      onClose={() => setEdit(null)} onDone={() => { setEdit(null); setPagina(1); datos.reload(); onChange() }} />}
  </>
}

function Detalle({ r }: { r: RealizacionEscolar }) {
  const campos = [
    ['Evento', r.evento], ['Escuela que registró', escuelaRealizacion(r)], ['Fecha', fecha(r.fecha)],
    ['Horario', horarioRealizacion(r)], ['Lugar', r.lugar],
    ['Articulación', escuelaArticulada(r) || (r.articulacion_informada === false ? 'No informada' : 'No')], ['Objetivos', r.objetivos || 'Sin informar'], ['Observaciones', r.observaciones || 'Sin observaciones'],
    ...(r.origen_historico ? [['Origen', 'Importación histórica']] : []),
  ]
  return <dl class="grid gap-3 text-sm sm:grid-cols-2">{campos.map(([k, v]) => <div key={k} class="min-w-0">
    <dt class="text-xs font-semibold uppercase text-slate-500">{k}</dt><dd class="whitespace-pre-wrap break-words text-slate-800">{v}</dd>
  </div>)}</dl>
}

function Formulario({ realizacion: r, cue, tipos, escuelas, onClose, onDone }: {
  realizacion: RealizacionEscolar | null; cue: string | null; tipos: TipoEventoEscolar[]; escuelas: EscuelaEvento[]; onClose(): void; onDone(): void
}) {
  const propias = ordenarEscuelas(escuelas.filter((e) => e.cue === cue))
  const [form, setForm] = useState({
    evento: r ? String(r.evento_id) : '', escuela: r ? String(r.escuela_id) : propias.length === 1 ? String(propias[0].id) : '',
    articulada: r?.articulada_id ? String(r.articulada_id) : '', fecha: r?.fecha ?? '', lugar: r?.lugar ?? '',
    inicio: r?.hora_inicio.slice(0, 5) ?? '', fin: r?.hora_fin?.slice(0, 5) ?? '', objetivos: r?.objetivos ?? '', observaciones: r?.observaciones ?? '',
  })
  const [articula, setArticula] = useState(!!r?.articulada_id)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const cambiar = (k: keyof typeof form, valor: string) => setForm((v) => ({ ...v, [k]: valor }))
  const guardar = async (e: Event) => {
    e.preventDefault()
    if (form.fin <= form.inicio) { setError('El horario de finalización debe ser posterior al inicio.'); return }
    setError(''); setGuardando(true)
    try {
      const { error } = await supabase.rpc('eventos_escolares_guardar', {
        p_id: r?.id ?? null, p_evento: Number(form.evento), p_escuela: Number(form.escuela),
        p_articulada: articula ? Number(form.articulada) : null, p_fecha: form.fecha,
        p_lugar: form.lugar, p_inicio: form.inicio, p_fin: form.fin, p_objetivos: form.objetivos, p_observaciones: form.observaciones,
      })
      if (error) throw error
      toast.ok(r ? 'Evento actualizado' : 'Evento registrado'); onDone()
    } catch (e) { setError(mensajeError(e)) }
    finally { setGuardando(false) }
  }
  return <Modal title={r ? 'Editar evento escolar' : 'Cargar evento escolar'} onClose={() => { if (!guardando) onClose() }} wide>
    <form class="space-y-4" onSubmit={(e) => void guardar(e)}>
      {error && <Alert tone="error">{error}</Alert>}
      {r?.origen_historico && (!r.hora_fin || !r.objetivos) && <Alert tone="info">Este registro histórico no incluye horario de finalización u objetivos. Completalos para guardar los cambios.</Alert>}
      {r?.articulacion_informada === false && <Alert tone="info">La articulación no estaba informada en el registro histórico. Al guardar se registrará la opción que selecciones.</Alert>}
      {!propias.length && <Alert tone="error">Tu cuenta no tiene una escuela asociada. Consultá con la Jefatura.</Alert>}
      {!tipos.length && <Alert tone="warning">Todavía no hay eventos disponibles. Consultá con la Jefatura.</Alert>}
      <div class="grid gap-3 sm:grid-cols-2">
        <Lbl label="Evento"><select class={FIELD} value={form.evento} required disabled={guardando} onChange={(e) => cambiar('evento', e.currentTarget.value)}>
          <option value="">Seleccioná un evento</option>{[...tipos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select></Lbl>
        <Lbl label="Escuela que registra"><select class={FIELD} value={form.escuela} required disabled={guardando || !!r} onChange={(e) => { cambiar('escuela', e.currentTarget.value); cambiar('articulada', '') }}>
          <option value="">Seleccioná tu escuela</option>{propias.map((e) => <option key={e.id} value={e.id}>{escuelaEvento(e)}</option>)}
        </select></Lbl>
        <Lbl label="Fecha"><input type="date" class={FIELD} required disabled={guardando} value={form.fecha} onInput={(e) => cambiar('fecha', e.currentTarget.value)} /></Lbl>
        <Lbl label="Lugar de realización"><input class={FIELD} maxLength={250} required disabled={guardando} value={form.lugar} onInput={(e) => cambiar('lugar', e.currentTarget.value)} /></Lbl>
        <Lbl label="Horario de inicio"><input type="time" class={FIELD} required disabled={guardando} value={form.inicio} onInput={(e) => cambiar('inicio', e.currentTarget.value)} /></Lbl>
        <Lbl label="Horario de finalización"><input type="time" class={FIELD} required disabled={guardando} value={form.fin} onInput={(e) => cambiar('fin', e.currentTarget.value)} /></Lbl>
      </div>
      <label class="flex min-h-11 items-center gap-3 text-sm text-slate-700"><input type="checkbox" class="size-5" checked={articula} disabled={guardando} onChange={(e) => setArticula(e.currentTarget.checked)} />Se realiza articuladamente con otra escuela</label>
      {articula && <Lbl label="Escuela articulada"><select class={FIELD} required value={form.articulada} disabled={guardando} onChange={(e) => cambiar('articulada', e.currentTarget.value)}>
        <option value="">Seleccioná otra escuela</option>{ordenarEscuelas(escuelas.filter((e) => String(e.id) !== form.escuela)).map((e) => <option key={e.id} value={e.id}>{escuelaEvento(e)}{e.localidad ? ` · ${e.localidad}` : ''}</option>)}
      </select></Lbl>}
      <Lbl label="Objetivos"><textarea class={`${FIELD} min-h-24 py-2`} maxLength={10000} required disabled={guardando} value={form.objetivos} onInput={(e) => cambiar('objetivos', e.currentTarget.value)} /></Lbl>
      <Lbl label="Otras observaciones"><textarea class={`${FIELD} min-h-24 py-2`} maxLength={10000} disabled={guardando} value={form.observaciones} onInput={(e) => cambiar('observaciones', e.currentTarget.value)} /></Lbl>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={onClose}>Cancelar</button>
        <button class={BTN_PRIMARY} disabled={guardando || !propias.length || !tipos.length}>{guardando ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
  </Modal>
}
