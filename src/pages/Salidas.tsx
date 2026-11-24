import { useEffect, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync, useDebounced } from '../lib/hooks'
import { descargarArchivo, primerNoPdf, subirArchivo, urlVistaPrevia } from '../lib/salidas'
import { consultaSalidas, leerSalidasFiltradas, limpiarBusquedaSalidas, tablaSalidas, type SalidaListado } from '../lib/salidasListado'
import { buildListadoXlsx } from '../lib/escuelasListado'
import { buildPdf } from '../lib/export'
import { descargar, XLSX_MIME } from '../lib/download'
import { BRAND, ROLE_LABELS, type Role } from '../modules'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, confirmar, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { col } from '../ui/Calendario'

interface Estado { id: number; nombre: string; color: string; orden: number; activo: boolean }
type Salida = SalidaListado
interface Archivo { id: number; nombre: string; mime: string | null; bytes: number | null }
interface Mensaje { id: number; rol: Role; autor: string; texto: string; estado_id: number | null; created_at: string }
interface Escuela { id: number; clave: string | null; cue: string; tipo: string | null; numero: number | null; nombre: string | null; localidad: string | null }

const fecha = (d: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'))
const fechaHora = (d: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(d))
const tam = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

const EstadoChip = ({ e }: { e?: Estado }) => <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${col(e?.color).chip}`}>{e?.nombre ?? '—'}</span>

function Visado({ salida, onChange, disabled = false }: { salida: Salida; onChange(): void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [registrado, setRegistrado] = useState(false)
  const visada = !!salida.visado_at || registrado
  const visar = async () => {
    setBusy(true)
    try {
      if (!await confirmar('Visar salida educativa', { text: 'Una vez confirmado, el visado no se puede quitar.', ok: 'Visar' })) return
      const { error } = await supabase.rpc('salida_visar', { p_id: salida.id })
      if (error) throw error
      setRegistrado(true)
      toast.ok('Salida visada')
      onChange()
    } catch (e) {
      toast.error(e && typeof e === 'object' && 'message' in e ? String(e.message) : 'No se pudo visar la salida')
    } finally { setBusy(false) }
  }
  return <label class="flex items-start gap-2 text-sm font-medium text-slate-700">
    <input type="checkbox" class="mt-0.5 size-4 shrink-0 accent-emerald-600" checked={visada} disabled={disabled || busy || visada}
      aria-label={`${visada ? 'Visada' : 'Visar'}: ${salida.titulo}`}
      onChange={(e) => { e.currentTarget.checked = false; void visar() }} />
    <span>{salida.visado_at ? `Visada el ${fechaHora(salida.visado_at)}` : registrado ? 'Visada' : 'Visar esta salida (no se puede deshacer)'}</span>
  </label>
}

export function Salidas() {
  const { user } = useAuth()
  return user?.role === 'distrital' ? <SalidasDistrital key={user.id} /> : <SalidasGeneral key={user?.id} />
}

function SalidasDistrital() {
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState('')
  const [pagina, setPagina] = useState(1)
  const [tamano, setTamano] = useState(20)
  const [abierta, setAbierta] = useState<number | null>(null)
  const [nueva, setNueva] = useState(false)
  const [exportando, setExportando] = useState(false)
  const busqueda = limpiarBusquedaSalidas(q)
  const dq = useDebounced(busqueda)
  const filtros = { busqueda: dq, estado }
  const { data, loading, error, reload } = useAsync(async () => {
    const [s, e] = await Promise.all([
      consultaSalidas(supabase, filtros).range((pagina - 1) * tamano, pagina * tamano - 1),
      supabase.from('salida_estados').select('*').order('orden'),
    ])
    if (s.error) throw s.error
    if (e.error) throw e.error
    if (s.count == null) throw new Error('No se pudo contar las salidas.')
    return { salidas: s.data as Salida[], estados: e.data as Estado[], total: s.count, busqueda: dq, estado, pagina, tamano }
  }, [dq, estado, pagina, tamano])

  useEffect(() => {
    if (!loading && !error && data && data.busqueda === dq && data.estado === estado && data.pagina === pagina && data.tamano === tamano && pagina > Math.max(1, Math.ceil(data.total / tamano))) {
      setPagina(Math.max(1, Math.ceil(data.total / tamano)))
    }
  }, [loading, error, data, dq, estado, pagina, tamano])

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    setExportando(true)
    try {
      const salidas = await leerSalidasFiltradas(supabase, filtros)
      if (!salidas.length) { toast.info('No hay salidas para exportar con estos filtros.'); return }
      const tabla = tablaSalidas(salidas, data?.estados ?? [], filtros, BRAND.org)
      if (tipo === 'xlsx') descargar(await buildListadoXlsx(tabla, BRAND.name, 'Salidas'), 'salidas-educativas.xlsx', XLSX_MIME)
      else {
        const respuesta = await fetch(`${import.meta.env.BASE_URL}icon-192.png?v=2`)
        if (!respuesta.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        descargar(await buildPdf(tabla, { brand: { name: BRAND.name, logo: new Uint8Array(await respuesta.arrayBuffer()) }, maxCellLines: 30 }), 'salidas-educativas.pdf', 'application/pdf')
      }
    } catch (e) {
      const mensaje = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
      toast.error(`No se pudo exportar el listado: ${mensaje}`)
    } finally { setExportando(false) }
  }

  const listo = !loading && !error && dq === busqueda && data?.busqueda === dq && data.estado === estado && data.pagina === pagina && data.tamano === tamano
  return <>
    <PageHeader title="Salida Educativa" subtitle="Solicitudes de las escuelas: revisá la documentación, dejá observaciones y actualizá el estado."
      actions={<button class={BTN_PRIMARY} onClick={() => setNueva(true)}>Nueva salida</button>} />
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <input type="search" class={FIELD} placeholder="Título, destino, escuela, clave o CUE" value={q} onInput={(e) => { setQ(e.currentTarget.value); setPagina(1) }} aria-label="Buscar salidas" />
      <select class={FIELD} value={estado} onChange={(e) => { setEstado(e.currentTarget.value); setPagina(1) }} aria-label="Estado">
        <option value="">Estado: todos</option>
        {(data?.estados ?? []).map((x) => <option value={x.id}>{x.nombre}</option>)}
      </select>
      <select class={FIELD} value={tamano} onChange={(e) => { setTamano(Number(e.currentTarget.value)); setPagina(1) }} aria-label="Resultados por página">
        {[10, 20, 50, 100].map((n) => <option value={n}>{n} por página</option>)}
      </select>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" class={BTN_SECONDARY} aria-label="Exportar salidas a Excel" disabled={!listo || exportando || !data?.total} onClick={() => void exportar('xlsx')}><Icon name="download" />Excel</button>
      <button type="button" class={BTN_SECONDARY} aria-label="Exportar salidas a PDF" disabled={!listo || exportando || !data?.total} onClick={() => void exportar('pdf')}><Icon name="download" />PDF</button>
      <span class="text-xs text-slate-500">{exportando ? 'Preparando exportación…' : 'Se exportan todos los resultados filtrados, no solo esta página.'}</span>
    </div>
    {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
    <div class="mt-3 space-y-2">
      {!listo ? !error && <Spinner /> : !data?.salidas.length ? <Card><EmptyState title="Sin salidas" text="No hay salidas con esos criterios." /></Card> : data.salidas.map((s) => (
        <button key={s.id} type="button" onClick={() => setAbierta(s.id)} class="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-sky-300 hover:bg-sky-50">
          <span class={`flex size-10 shrink-0 items-center justify-center rounded-lg border ${col(data.estados.find((e) => e.id === s.estado_id)?.color).card}`}><Icon name="bus" /></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-slate-900">{s.titulo}</span>
            <span class="block truncate text-xs text-slate-500">{fecha(s.fecha)} · {s.destino} · {s.escuela}{s.clave ? ` (${s.clave})` : ''}</span>
            {s.visado_at && <span class="mt-1 block text-xs font-medium text-emerald-700">✓ Visada el {fechaHora(s.visado_at)}</span>}
          </span>
          <EstadoChip e={data.estados.find((e) => e.id === s.estado_id)} />
        </button>
      ))}
    </div>
    {listo && data && <>{data.total <= tamano && <p class="mt-3 text-sm text-slate-500">{data.total} salida(s)</p>}<Pager page={pagina} total={data.total} size={tamano} onPage={setPagina} /></>}
    {nueva && <Formulario distrital onClose={() => setNueva(false)} onDone={(id) => { setNueva(false); reload(); setAbierta(id) }} />}
    {abierta != null && <Detalle id={abierta} estados={data?.estados ?? []} onClose={() => setAbierta(null)} onChange={reload} />}
  </>
}

function SalidasGeneral() {
  const { user } = useAuth()
  const distrito = user?.role === 'distrital'
  const escolar = user?.role === 'escolar'
  const areal = user?.role === 'areal'
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState('')
  const [nueva, setNueva] = useState(false)
  const [abierta, setAbierta] = useState<number | null>(null)
  const dq = useDebounced(q)

  const { data, loading, error, reload } = useAsync(async () => {
    const [s, e] = await Promise.all([
      supabase.from('salidas').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }),
      supabase.from('salida_estados').select('*').order('orden'),
    ])
    if (s.error) throw s.error
    if (e.error) throw e.error
    return { salidas: s.data as Salida[], estados: e.data as Estado[] }
  })
  const estados = data?.estados ?? []
  const estadoDe = (id: number) => estados.find((x) => x.id === id)
  const t = dq.trim().toLowerCase()
  const rows = (data?.salidas ?? []).filter((s) =>
    (!filtro || String(s.estado_id) === filtro) &&
    (!t || `${s.titulo} ${s.destino} ${s.escuela} ${s.clave ?? ''}`.toLowerCase().includes(t)))

  return (
    <>
      <PageHeader title="Salida Educativa" subtitle={distrito ? 'Solicitudes de las escuelas: revisá la documentación, dejá observaciones y actualizá el estado.' : escolar ? 'Cargá la salida con su documentación y seguí el estado de la solicitud.' : 'Salidas educativas de las escuelas que tenés asignadas.'}
        actions={escolar && <button class={BTN_PRIMARY} onClick={() => setNueva(true)}>Nueva salida</button>} />
      <div class="grid gap-2 sm:grid-cols-2">
        <input type="search" class={FIELD} placeholder={!escolar ? 'Título, destino, escuela o clave' : 'Título o destino'} value={q} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Buscar" />
        <select class={FIELD} value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} aria-label="Estado">
          <option value="">Estado: todos</option>
          {estados.map((x) => <option value={x.id}>{x.nombre}</option>)}
        </select>
      </div>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      <div class="mt-3 space-y-2">
        {loading && !data ? <Spinner /> : rows.length === 0 ? <Card><EmptyState title="Sin salidas" text={!escolar ? 'Todavía no hay solicitudes.' : 'Cargá la primera con “Nueva salida”.'} /></Card> : rows.map((s) => (
          <div key={s.id} class="rounded-lg border border-slate-200 bg-white shadow-sm sm:flex sm:items-center">
            <button type="button" onClick={() => setAbierta(s.id)} class="flex w-full min-w-0 flex-1 items-center gap-3 rounded-lg p-3 text-left hover:bg-sky-50">
              <span class={`flex size-10 shrink-0 items-center justify-center rounded-lg border ${col(estadoDe(s.estado_id)?.color).card}`}><Icon name="bus" /></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium text-slate-900">{s.titulo}</span>
                <span class="block truncate text-xs text-slate-500">{fecha(s.fecha)} · {s.destino}{!escolar ? ` · ${s.escuela}${s.clave ? ` (${s.clave})` : ''}` : ''}</span>
              </span>
              <EstadoChip e={estadoDe(s.estado_id)} />
            </button>
            {areal && <div class="border-t border-slate-100 px-3 py-2 sm:max-w-52 sm:border-t-0 sm:border-l"><Visado salida={s} onChange={reload} /></div>}
          </div>
        ))}
      </div>
      {nueva && <Formulario onClose={() => setNueva(false)} onDone={(id) => { setNueva(false); reload(); setAbierta(id) }} />}
      {abierta != null && <Detalle id={abierta} estados={estados} onClose={() => setAbierta(null)} onChange={reload} />}
    </>
  )
}

function Formulario({ onClose, onDone, distrital = false }: { onClose(): void; onDone(id: number): void; distrital?: boolean }) {
  const [f, setF] = useState({ titulo: '', fecha: '', destino: '', obs: '' })
  const [files, setFiles] = useState<File[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [escuela, setEscuela] = useState<Escuela | null>(null)
  const dbusqueda = useDebounced(busqueda)
  const escuelas = useAsync(async () => {
    const texto = limpiarBusquedaSalidas(dbusqueda)
    if (!distrital || texto.length < 2) return [] as Escuela[]
    const criterios = ['clave', 'cue', 'codigo', 'nombre', 'localidad'].map((campo) => `${campo}.ilike.%${texto}%`)
    if (/^\d+$/.test(texto)) criterios.push(`numero.eq.${texto}`)
    const r = await supabase.from('escuelas').select('id,clave,cue,tipo,numero,nombre,localidad').or(criterios.join(',')).order('clave').limit(20)
    if (r.error) throw r.error
    return r.data as Escuela[]
  }, [dbusqueda, distrital])
  const [err, setErr] = useState<string | null>(null)
  const [paso, setPaso] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value })

  const agregar = (list: FileList | null) => {
    if (!list) return
    const nuevos = [...list].filter((n) => !files.some((x) => x.name === n.name && x.size === n.size && x.lastModified === n.lastModified))
    setFiles([...files, ...nuevos])
  }

  const submit = async (e: Event) => {
    e.preventDefault()
    setErr(null)
    if (distrital && !escuela) return setErr('Elegí una escuela')
    const malo = await primerNoPdf(files)
    if (malo) return setErr(`Solo se admiten archivos PDF: “${malo}” no lo es`)
    let id: number | undefined
    try {
      setPaso('Guardando salida…')
      const datos = { p_titulo: f.titulo, p_fecha: f.fecha, p_destino: f.destino, p_obs: f.obs }
      const { data, error } = distrital
        ? await supabase.rpc('salida_crear_distrital', { ...datos, p_escuela: escuela!.id })
        : await supabase.rpc('salida_crear', { ...datos, p_mail: false })
      if (error) throw new Error(error.message)
      id = data as number
      for (const [i, file] of files.entries()) {
        await subirArchivo(id!, file, (p) => setPaso(`Subiendo ${i + 1} de ${files.length}: ${file.name} (${p}%)`))
      }
      toast.ok('Salida guardada')
      onDone(id!)
    } catch (ex) {
      setPaso(null)
      const msg = ex instanceof Error ? ex.message : 'No se pudo guardar'
      if (id) { toast.error(`La salida se guardó, pero: ${msg}. Podés completarla desde su detalle.`); onDone(id) } else setErr(msg)
    }
  }

  return (
    <Modal title="Nueva salida educativa" onClose={() => !paso && onClose()} wide>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        {distrital && <div>
          <Lbl label="Escuela">
            <input type="search" class={FIELD} value={busqueda} placeholder="Buscar por escuela, clave o CUE" maxLength={80}
              onInput={(e) => { setBusqueda(e.currentTarget.value); setEscuela(null) }} />
          </Lbl>
          {escuela ? <p class="mt-2 text-sm text-emerald-700">Seleccionada: {[escuela.tipo, escuela.numero, escuela.nombre].filter(Boolean).join(' ')} · {escuela.clave || escuela.cue}</p>
            : escuelas.error ? <div class="mt-2"><Alert tone="error">{escuelas.error}</Alert></div>
            : busqueda.trim().length < 2 ? <p class="mt-2 text-xs text-slate-500">Escribí al menos 2 caracteres.</p>
            : escuelas.loading || dbusqueda !== busqueda ? <Spinner />
            : !escuelas.data?.length ? <p class="mt-2 text-sm text-slate-500">No se encontraron escuelas.</p>
            : <ul class="mt-2 max-h-48 divide-y overflow-y-auto rounded-md border border-slate-200">
              {escuelas.data.map((e) => <li key={e.id}><button type="button" class="w-full px-3 py-2 text-left text-sm hover:bg-sky-50"
                onClick={() => setEscuela(e)}>{[e.tipo, e.numero, e.nombre].filter(Boolean).join(' ')} · {e.clave || e.cue} · {e.localidad}</button></li>)}
            </ul>}
        </div>}
        <div class="grid gap-3 sm:grid-cols-2">
          <Lbl label="Título"><input class={FIELD} value={f.titulo} onInput={set('titulo')} required minLength={3} maxLength={150} /></Lbl>
          <Lbl label="Fecha"><input class={FIELD} type="date" value={f.fecha} onInput={set('fecha')} required /></Lbl>
        </div>
        <Lbl label="Destino"><input class={FIELD} value={f.destino} onInput={set('destino')} required minLength={2} maxLength={200} /></Lbl>
        <Lbl label="Observaciones (opcional)"><textarea class={`${FIELD} min-h-24 py-2`} value={f.obs} onInput={set('obs')} maxLength={3000} /></Lbl>
        <div>
          <p class="mb-1 text-sm font-medium text-slate-700">Documentación</p>
          <label class="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-center text-sm text-slate-600 hover:border-sky-400 hover:bg-sky-50">
            <Icon name="download" class="size-6 rotate-180 text-slate-400" />
            Tocá para elegir archivos PDF (sin límite de cantidad ni peso)
            <input type="file" accept="application/pdf,.pdf" multiple class="sr-only" onChange={(e) => { agregar(e.currentTarget.files); e.currentTarget.value = '' }} />
          </label>
          {files.length > 0 && (
            <ul class="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
              {files.map((x, i) => (
                <li key={i} class="flex items-center gap-2 px-3 py-2 text-sm">
                  <span class="min-w-0 flex-1 truncate">{x.name}</span><span class="text-xs text-slate-500">{tam(x.size)}</span>
                  <button type="button" aria-label={`Quitar ${x.name}`} disabled={!!paso} onClick={() => setFiles(files.filter((_, j) => j !== i))} class="flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><Icon name="x" class="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {paso && <Alert tone="info">{paso}</Alert>}
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={!!paso} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={!!paso}>{paso ? 'Procesando…' : 'Guardar'}</button></div>
      </form>
    </Modal>
  )
}

function Detalle({ id, estados, onClose, onChange }: { id: number; estados: Estado[]; onClose(): void; onChange(): void }) {
  const { user } = useAuth()
  const distrito = user?.role === 'distrital'
  const areal = user?.role === 'areal'
  const supervisor = distrito || areal
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState('')
  const [busy, setBusy] = useState(false)
  const [prev, setPrev] = useState<{ nombre: string; url: string } | null>(null)
  const [subiendo, setSubiendo] = useState<string | null>(null)

  const { data, loading, error, reload } = useAsync(async () => {
    const [s, a, m, ed, du] = await Promise.all([
      supabase.from('salidas').select('*').eq('id', id).maybeSingle(),
      supabase.from('salida_archivos').select('id,nombre,mime,bytes').eq('salida_id', id).order('id'),
      supabase.from('salida_mensajes').select('id,rol,autor,texto,estado_id,created_at').eq('salida_id', id).order('id'),
      supabase.rpc('salida_editable', { p_id: id }),
      supabase.rpc('salida_es_dueno', { p_id: id }),
    ])
    if (s.error) throw s.error
    if (a.error) throw a.error
    if (m.error) throw m.error
    if (ed.error) throw ed.error
    if (du.error) throw du.error
    if (!s.data) throw new Error('Salida inexistente')
    return { s: s.data as Salida, archivos: (a.data ?? []) as Archivo[], mensajes: (m.data ?? []) as Mensaje[], editable: !!ed.data, dueno: !!du.data }
  }, [id])
  const refresh = () => { reload(); onChange() }
  const estadoDe = (eid: number | null) => estados.find((x) => x.id === eid)

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string, after?: () => void) => {
    setBusy(true)
    const { error } = await p
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.ok(ok); after?.(); refresh()
  }
  const comentar = (e: Event) => {
    e.preventDefault()
    if (!texto.trim() && !(supervisor && estado)) return
    if (supervisor && estado) run(supabase.rpc('salida_estado', { p_id: id, p_estado: Number(estado), p_texto: texto }), 'Estado actualizado', () => { setTexto(''); setEstado('') })
    else run(supabase.rpc('salida_mensaje', { p_id: id, p_texto: texto }), 'Mensaje enviado', () => setTexto(''))
  }
  const agregarArchivos = async (list: FileList | null) => {
    if (!list || !data) return
    const files = [...list]
    const malo = await primerNoPdf(files)
    if (malo) return toast.error(`Solo se admiten archivos PDF: “${malo}” no lo es`)
    try {
      for (const [i, f] of files.entries()) await subirArchivo(id, f, (p) => setSubiendo(`Subiendo ${i + 1} de ${files.length}: ${f.name} (${p}%)`))
      toast.ok('Documentación agregada')
    } catch (ex) { toast.error(ex instanceof Error ? ex.message : 'No se pudo subir') }
    setSubiendo(null); refresh()
  }
  const ver = async (a: Archivo) => {
    try { setPrev({ nombre: a.nombre, url: await urlVistaPrevia(a.id) }) } catch (ex) { toast.error(ex instanceof Error ? ex.message : 'No se pudo abrir el archivo') }
  }
  useEffect(() => () => { if (prev) URL.revokeObjectURL(prev.url) }, [prev])
  const bajar = async (a: Archivo) => { try { await descargarArchivo(a.id, a.nombre) } catch (ex) { toast.error(ex instanceof Error ? ex.message : 'No se pudo descargar') } }

  return (
    <>
    <Modal title={data?.s.titulo ?? 'Salida educativa'} onClose={onClose} wide>
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data ? <Spinner /> : data && (
        <div class="space-y-5">
          <div class="flex flex-wrap items-center gap-2"><EstadoChip e={estadoDe(data.s.estado_id)} />{data.s.mail_enviado_at && <span class="text-xs text-slate-500">Correo enviado el {fechaHora(data.s.mail_enviado_at)}</span>}</div>
          {areal ? <Visado salida={data.s} onChange={refresh} disabled={busy} /> : data.s.visado_at && <p class="text-sm font-medium text-emerald-700">✓ Visada el {fechaHora(data.s.visado_at)}</p>}
          <dl class="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt class="text-xs uppercase text-slate-500">Escuela</dt><dd>{data.s.escuela}{data.s.clave ? ` · ${data.s.clave}` : ''}</dd></div>
            <div><dt class="text-xs uppercase text-slate-500">Fecha</dt><dd>{fecha(data.s.fecha)}</dd></div>
            <div><dt class="text-xs uppercase text-slate-500">Destino</dt><dd>{data.s.destino}</dd></div>
            <div><dt class="text-xs uppercase text-slate-500">Observaciones</dt><dd class="whitespace-pre-line">{data.s.observaciones || 'Sin observaciones'}</dd></div>
          </dl>

          <section>
            <h3 class="mb-1.5 text-sm font-semibold text-slate-900">Documentación ({data.archivos.length})</h3>
            {data.archivos.length === 0 ? <p class="text-sm text-slate-500">Sin archivos.</p> : (
              <ul class="divide-y divide-slate-100 rounded-md border border-slate-200">
                {data.archivos.map((a) => (
                  <li key={a.id} class="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span class="min-w-0 flex-1 truncate">{a.nombre}</span><span class="text-xs text-slate-500">{tam(a.bytes)}</span>
                    <button type="button" class="flex size-10 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" aria-label={`Ver ${a.nombre}`} onClick={() => ver(a)}><Icon name="eye" class="size-5" /></button>
                    <button type="button" class="flex size-10 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" aria-label={`Descargar ${a.nombre}`} onClick={() => bajar(a)}><Icon name="download" class="size-5" /></button>
                  </li>
                ))}
              </ul>
            )}
            {subiendo && <div class="mt-2"><Alert tone="info">{subiendo}</Alert></div>}
            {data.editable && (
              <label class={`${BTN_SECONDARY} mt-2 cursor-pointer`}>Agregar documentación (PDF)
                <input type="file" accept="application/pdf,.pdf" multiple class="sr-only" disabled={!!subiendo} onChange={(e) => { agregarArchivos(e.currentTarget.files); e.currentTarget.value = '' }} />
              </label>
            )}
          </section>

          <section>
            <h3 class="mb-2 text-sm font-semibold text-slate-900">Seguimiento</h3>
            {data.mensajes.length === 0 ? <p class="text-sm text-slate-500">Todavía no hay observaciones.</p> : (
              <ol class="space-y-2">
                {data.mensajes.map((m) => (
                  <li key={m.id} class={`rounded-lg border p-3 text-sm ${m.rol === 'distrital' ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white'}`}>
                    <p class="flex flex-wrap items-center gap-x-2 text-xs text-slate-500"><span class="font-medium text-slate-700">{m.autor}</span><span>{ROLE_LABELS[m.rol]}</span><span>{fechaHora(m.created_at)}</span>{m.estado_id && <EstadoChip e={estadoDe(m.estado_id)} />}</p>
                    <p class="mt-1 whitespace-pre-line text-slate-800">{m.texto}</p>
                  </li>
                ))}
              </ol>
            )}
            {(supervisor || data.dueno) && (
              <form onSubmit={comentar} class="mt-3 space-y-2">
                {supervisor && (
                  <Lbl label="Estado">
                    <select class={FIELD} value={estado} onChange={(e) => setEstado(e.currentTarget.value)}>
                      <option value="">Sin cambios ({estadoDe(data.s.estado_id)?.nombre})</option>
                      {estados.filter((x) => x.activo && x.id !== data.s.estado_id).map((x) => <option value={x.id}>{x.nombre}</option>)}
                    </select>
                  </Lbl>
                )}
                <Lbl label={supervisor ? 'Observación' : 'Escribir un mensaje'}><textarea class={`${FIELD} min-h-20 py-2`} value={texto} onInput={(e) => setTexto(e.currentTarget.value)} maxLength={3000} /></Lbl>
                <div class="flex justify-end"><button class={BTN_PRIMARY} disabled={busy || (!texto.trim() && !estado)}>{supervisor && estado ? 'Actualizar estado' : 'Enviar'}</button></div>
              </form>
            )}
          </section>
        </div>
      )}
    </Modal>
    {prev && (
      <Modal title={prev.nombre} onClose={() => setPrev(null)} wide>
        <iframe src={prev.url} title={prev.nombre} class="h-[70vh] w-full rounded border border-slate-200" />
      </Modal>
    )}
    </>
  )
}
