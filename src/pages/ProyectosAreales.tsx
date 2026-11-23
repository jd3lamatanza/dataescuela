import { useEffect, useRef, useState } from 'preact/hooks'
import { esPdf, MAX_PROYECTO } from '../../supabase/functions/_shared/proyectos'
import { useAuth } from '../lib/auth'
import { useAsync, useDebounced } from '../lib/hooks'
import { llamarDrive } from '../lib/drive'
import { supabase } from '../lib/supabase'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, TabBar, confirmar, toast } from '../ui/kit'

type Tipo = { id: number; nombre: string }
type Proyecto = { id: string; tipo: string; nombre: string; bytes: number; created_at: string; inspector: string }
type Inspector = { id: string; nombre: string; nivel_o_modalidad: string | null; cantidad: number }
const TAMANO = 15
const mensaje = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
const llamar = (body: FormData | Record<string, unknown>) => llamarDrive('proyectos-areales-drive', body)

async function leerTipos(): Promise<Tipo[]> {
  const r = await supabase.from('proyectos_areales_tipos').select('id,nombre').order('nombre')
  if (r.error) throw r.error
  return r.data
}

export function ProyectosAreales() {
  const { user } = useAuth()
  const [tab, setTab] = useState('proyectos')
  const [revision, setRevision] = useState(0)
  const tipos = useAsync(leerTipos, [revision, user?.id, user?.role])
  if (!user || !['areal', 'distrital'].includes(user.role)) return null
  const distrital = user.role === 'distrital'
  return <>
    <PageHeader title={distrital ? 'Proyectos Areales' : 'Mis Proyectos'} subtitle={distrital ? 'Consulta los proyectos de los inspectores y administrá los tipos disponibles.' : 'Proyectos de tu supervisión.'} />
    {distrital && <TabBar label="Proyectos Areales" items={[
      { id: 'proyectos', label: 'Proyectos', icon: 'book', color: 'sky' },
      { id: 'inspectores', label: 'Inspectores', icon: 'shield', color: 'emerald' },
      { id: 'tipos', label: 'Tipos', icon: 'settings', color: 'violet' },
    ]} active={tab} onChange={setTab} />}
    {tipos.error && <div class="mt-4"><Alert tone="error">{tipos.error}</Alert><button type="button" class={`${BTN_SECONDARY} mt-2`} onClick={tipos.reload}>Reintentar</button></div>}
    {tipos.loading && <Spinner />}
    {!tipos.loading && !tipos.error && tipos.data && (tab === 'proyectos'
      ? <Listado key={`${user.id}:${user.role}`} distrital={distrital} tipos={tipos.data} />
      : tab === 'inspectores' ? <Inspectores /> : <Catalogo tipos={tipos.data} onChange={() => setRevision((n) => n + 1)} />)}
  </>
}

function Listado({ distrital, tipos }: { distrital: boolean; tipos: Tipo[] }) {
  const [pagina, setPagina] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [tipo, setTipo] = useState('')
  const [orden, setOrden] = useState('recientes')
  const [subiendo, setSubiendo] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [previa, setPrevia] = useState<{ nombre: string; url: string } | null>(null)
  const montado = useRef(true)
  const buscar = useDebounced(busqueda)
  useEffect(() => { montado.current = true; return () => { montado.current = false } }, [])
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa.url) }, [previa])
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('proyectos_areales_listar', { p_busqueda: buscar, p_tipo: tipo, p_orden: orden, p_lim: TAMANO, p_offset: (pagina - 1) * TAMANO })
    if (r.error) throw r.error
    if (!r.data || !Array.isArray(r.data.filas) || !Number.isSafeInteger(r.data.total)) throw new Error('Respuesta inválida al consultar proyectos.')
    return { filas: r.data.filas as Proyecto[], total: r.data.total as number, pagina, buscar, tipo, orden }
  }, [pagina, buscar, tipo, orden])
  const actual = !error && !loading && buscar === busqueda && data?.pagina === pagina && data.buscar === buscar && data.tipo === tipo && data.orden === orden ? data : null
  const abrir = async (p: Proyecto, vista: boolean) => {
    setOcupado(p.id)
    try {
      const r = await llamar({ action: 'download', id: p.id })
      const url = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'application/pdf' }))
      if (!montado.current) { URL.revokeObjectURL(url); return }
      if (vista) setPrevia({ nombre: p.nombre, url })
      else {
        const a = Object.assign(document.createElement('a'), { href: url, download: p.nombre })
        document.body.append(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    } catch (e) { if (montado.current) toast.error(mensaje(e)) }
    finally { if (montado.current) setOcupado(null) }
  }
  const eliminar = async (p: Proyecto) => {
    if (!(await confirmar('Eliminar proyecto', { text: `Se eliminará «${p.nombre}» de Google Drive. Esta acción no se puede deshacer.`, ok: 'Eliminar', danger: true }))) return
    setOcupado(p.id)
    try {
      await llamar({ action: 'remove', id: p.id })
      toast.ok('Proyecto eliminado')
      if (pagina > 1 && actual?.filas.length === 1) setPagina(pagina - 1)
      else reload()
    } catch (e) { toast.error(mensaje(e)) } finally { setOcupado(null) }
  }
  return <div class="mt-4">
    {!distrital && <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-slate-600">Archivos PDF de hasta 5 MB; podés subir más de uno por tipo.</p>
      <button type="button" class={BTN_PRIMARY} disabled={!actual} onClick={() => setSubiendo(true)}>Subir proyecto</button>
    </div>}
    {distrital && <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Lbl label="Buscar inspector o proyecto"><input type="search" class={FIELD} value={busqueda} onInput={(e) => { setBusqueda(e.currentTarget.value); setPagina(1) }} /></Lbl>
      <Lbl label="Tipo de proyecto"><select class={FIELD} value={tipo} onChange={(e) => { setTipo(e.currentTarget.value); setPagina(1) }}>
        <option value="">Todos los tipos</option>{tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}<option value="otro">Otro</option>
      </select></Lbl>
      <Lbl label="Ordenar por"><select class={FIELD} value={orden} onChange={(e) => { setOrden(e.currentTarget.value); setPagina(1) }}>
        <option value="recientes">Más recientes</option><option value="antiguos">Más antiguos</option><option value="inspector">Inspector</option>
        <option value="tipo">Tipo de proyecto</option><option value="archivo">Nombre del archivo</option>
      </select></Lbl>
    </div>}
    <div class="mt-4">
      {error && <div class="space-y-2"><Alert tone="error">{error}</Alert><button type="button" class={BTN_SECONDARY} onClick={reload}>Reintentar</button></div>}
      {!actual && !error && <Spinner />}
      {actual && <>
        {distrital && <p class="mb-3 text-sm text-slate-500">{actual.total} proyecto(s)</p>}
        {!actual.filas.length ? <Card><EmptyState title="Sin proyectos" text={distrital ? 'No hay proyectos con esos filtros.' : 'Elegí «Subir proyecto» para cargar un archivo.'} /></Card> :
          <div class="space-y-3">{actual.filas.map((p) => <Card key={p.id}><div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1"><p class="font-semibold text-slate-900">{p.tipo}</p>
              <p class="mt-1 break-all text-sm text-slate-700">{p.nombre}</p>
              {distrital && <p class="mt-1 break-words text-sm text-slate-600">{p.inspector}</p>}
              <p class="mt-1 text-xs text-slate-500">{(p.bytes / 1024 / 1024).toFixed(2)} MB · {new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(p.created_at))}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class={BTN_SECONDARY} disabled={!!ocupado} onClick={() => void abrir(p, true)}>{ocupado === p.id ? 'Cargando…' : 'Previsualizar'}</button>
              <button type="button" class={BTN_SECONDARY} disabled={!!ocupado} onClick={() => void abrir(p, false)}>Descargar</button>
              {!distrital && <button type="button" class={BTN_SECONDARY} disabled={!!ocupado} onClick={() => void eliminar(p)}>Eliminar</button>}
            </div>
          </div></Card>)}</div>}
        <Pager page={pagina} total={actual.total} size={TAMANO} onPage={setPagina} />
      </>}
    </div>
    {subiendo && <Formulario tipos={tipos} onClose={() => setSubiendo(false)} onDone={() => { setSubiendo(false); if (pagina !== 1) setPagina(1); else reload() }} />}
    {previa && <Modal title={`Vista previa: ${previa.nombre}`} onClose={() => setPrevia(null)} wide>
      <iframe src={previa.url} title={`Vista previa de ${previa.nombre}`} class="h-[65vh] w-full rounded border border-slate-200" />
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>Si no se muestra el PDF, abrilo en otra pestaña o descargalo.</span>
        <a class={BTN_SECONDARY} href={previa.url} target="_blank" rel="noopener noreferrer">Abrir en otra pestaña</a>
      </div>
    </Modal>}
  </div>
}

function Formulario({ tipos, onClose, onDone }: { tipos: Tipo[]; onClose(): void; onDone(): void }) {
  const [tipo, setTipo] = useState('')
  const [otro, setOtro] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guardar = async (e: Event) => {
    e.preventDefault()
    if (!tipo) return setError('Seleccioná un tipo de proyecto.')
    if (tipo === 'otro' && !otro.trim()) return setError('Indicá el tipo de proyecto.')
    if (!archivo || !/\.pdf$/i.test(archivo.name) || archivo.size < 1 || archivo.size > MAX_PROYECTO) return setError('Elegí un PDF de hasta 5 MB.')
    setError(null); setGuardando(true)
    try {
      if (!esPdf(new Uint8Array(await archivo.slice(0, 5).arrayBuffer()))) throw new Error('El archivo no es un PDF válido.')
      const form = new FormData()
      form.append('action', 'upload'); form.append('tipo', tipo); form.append('otro_tipo', otro.trim()); form.append('archivo', archivo)
      await llamar(form); toast.ok('Proyecto subido'); onDone()
    } catch (e) { setError(mensaje(e)) } finally { setGuardando(false) }
  }
  return <Modal title="Subir proyecto" onClose={() => { if (!guardando) onClose() }}>
    <form class="space-y-4" onSubmit={guardar}>
      {error && <Alert tone="error">{error}</Alert>}
      <Lbl label="Tipo de proyecto"><select class={FIELD} required value={tipo} disabled={guardando} onChange={(e) => setTipo(e.currentTarget.value)}>
        <option value="">Seleccioná un tipo</option>{tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}<option value="otro">Otro</option>
      </select></Lbl>
      {tipo === 'otro' && <Lbl label="Indicá el tipo de proyecto"><input class={FIELD} required maxLength={150} value={otro} disabled={guardando} onInput={(e) => setOtro(e.currentTarget.value)} /></Lbl>}
      <Lbl label="Archivo PDF (máximo 5 MB)"><input class={`${FIELD} py-2`} type="file" accept=".pdf,application/pdf" required disabled={guardando} onChange={(e) => setArchivo(e.currentTarget.files?.[0] ?? null)} /></Lbl>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={onClose}>Cancelar</button>
        <button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Subiendo…' : 'Subir'}</button></div>
    </form>
  </Modal>
}

function Catalogo({ tipos, onChange }: { tipos: Tipo[]; onChange(): void }) {
  const [nombre, setNombre] = useState('')
  const [editando, setEditando] = useState<Tipo | null>(null)
  const [guardando, setGuardando] = useState(false)
  const guardar = async (e: Event) => {
    e.preventDefault(); setGuardando(true)
    try {
      const r = await supabase.rpc('proyecto_areal_guardar_tipo', { p_id: editando?.id ?? null, p_nombre: nombre })
      if (r.error) throw r.error
      toast.ok(editando ? 'Tipo actualizado' : 'Tipo creado'); setNombre(''); setEditando(null); onChange()
    } catch (e) { toast.error(`No se pudo guardar el tipo: ${mensaje(e)}`) } finally { setGuardando(false) }
  }
  const eliminar = async (t: Tipo) => {
    if (!(await confirmar('Eliminar tipo', { text: `Se eliminará «${t.nombre}» si no tiene proyectos registrados.`, ok: 'Eliminar', danger: true }))) return
    setGuardando(true)
    try {
      const r = await supabase.rpc('proyecto_areal_eliminar_tipo', { p_id: t.id })
      if (r.error) throw r.error
      if (editando?.id === t.id) { setEditando(null); setNombre('') }
      toast.ok('Tipo eliminado'); onChange()
    } catch (e) { toast.error(`No se pudo eliminar el tipo: ${mensaje(e)}`) } finally { setGuardando(false) }
  }
  return <div class="mt-4 space-y-4">
    <Card title={editando ? 'Editar tipo' : 'Crear tipo de proyecto'}>
      <form class="flex flex-wrap items-end gap-3" onSubmit={(e) => void guardar(e)}>
        <div class="min-w-0 flex-1"><Lbl label="Nombre del tipo"><input class={FIELD} value={nombre} minLength={2} maxLength={150} required disabled={guardando} onInput={(e) => setNombre(e.currentTarget.value)} /></Lbl></div>
        {editando && <button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={() => { setEditando(null); setNombre('') }}>Cancelar</button>}
        <button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear tipo'}</button>
      </form>
      {editando && <p class="mt-2 text-xs text-slate-500">El nuevo nombre también se mostrará en los proyectos existentes.</p>}
    </Card>
    <Card title="Tipos disponibles">{!tipos.length ? <EmptyState title="Sin tipos" text="Creá un tipo para los inspectores." /> :
      <ul class="divide-y divide-slate-100">{tipos.map((t) => <li key={t.id} class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm font-medium text-slate-800">
        <span class="min-w-0 break-words">{t.nombre}</span><span class="flex gap-2">
          <button type="button" class={BTN_SECONDARY} disabled={guardando} aria-label={`Editar ${t.nombre}`} onClick={() => { setEditando(t); setNombre(t.nombre) }}>Editar</button>
          <button type="button" class={BTN_SECONDARY} disabled={guardando} aria-label={`Eliminar ${t.nombre}`} onClick={() => void eliminar(t)}>Eliminar</button>
        </span></li>)}</ul>}</Card>
  </div>
}

function Inspectores() {
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const buscar = useDebounced(busqueda)
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('proyectos_areales_inspectores', { p_busqueda: buscar, p_lim: TAMANO, p_offset: (pagina - 1) * TAMANO })
    if (r.error) throw r.error
    if (!r.data || !Array.isArray(r.data.filas) || !Number.isSafeInteger(r.data.total)) throw new Error('Respuesta inválida al consultar inspectores.')
    return { filas: r.data.filas as Inspector[], total: r.data.total as number, buscar, pagina }
  }, [buscar, pagina])
  const actual = !error && !loading && buscar === busqueda && data?.buscar === buscar && data.pagina === pagina ? data : null
  return <div class="mt-4">
    <Lbl label="Buscar inspector, nivel o modalidad"><input type="search" class={FIELD} value={busqueda} onInput={(e) => { setBusqueda(e.currentTarget.value); setPagina(1) }} /></Lbl>
    {error && <div class="mt-3 space-y-2"><Alert tone="error">{error}</Alert><button type="button" class={BTN_SECONDARY} onClick={reload}>Reintentar</button></div>}
    {!actual && !error && <Spinner />}
    {actual && <div class="mt-4"><p class="mb-3 text-sm text-slate-500">{actual.total} inspector(es), incluidos quienes aún no cargaron proyectos.</p>
      {!actual.filas.length ? <Card><EmptyState title="Sin inspectores" text="No hay inspectores con esa búsqueda." /></Card> :
        <div class="space-y-3">{actual.filas.map((i) => <Card key={i.id}><div class="flex flex-wrap items-center justify-between gap-3">
          <div><p class="font-semibold text-slate-900">{i.nombre}</p>{i.nivel_o_modalidad && <p class="mt-1 text-sm text-slate-600">{i.nivel_o_modalidad}</p>}</div>
          <Badge tone={i.cantidad === 0 ? 'amber' : 'green'}>{i.cantidad} {i.cantidad === 1 ? 'proyecto' : 'proyectos'}</Badge>
        </div></Card>)}</div>}
      <Pager page={pagina} total={actual.total} size={TAMANO} onPage={setPagina} />
    </div>}
  </div>
}
