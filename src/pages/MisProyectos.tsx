import { useEffect, useRef, useState } from 'preact/hooks'
import { esPdf, MAX_PROYECTO, TIPOS_PROYECTO } from '../../supabase/functions/_shared/proyectos'
import { useAuth } from '../lib/auth'
import { useAsync, useDebounced } from '../lib/hooks'
import { llamarDrive } from '../lib/drive'
import { supabase } from '../lib/supabase'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, TabBar, confirmar, toast } from '../ui/kit'

type Proyecto = { id: string; tipo: string; otro_tipo: string | null; nombre: string; bytes: number; created_at: string }
type ProyectoSupervision = Proyecto & { cue: string; clave: string; escuela: string; escuela_tipo: string; escuela_numero: number | null }
type ProyectoListado = Proyecto & Partial<ProyectoSupervision>
const TAMANO = 15
const fecha = (s: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(s))

const llamar = (body: FormData | Record<string, unknown>) => llamarDrive('proyectos-drive', body)

export function MisProyectos() {
  const { user } = useAuth()
  const [tab, setTab] = useState('proyectos')
  if (!user || !['escolar', 'areal', 'distrital', 'eoe'].includes(user.role)) return null
  if (user.role === 'escolar') return <Listado key={user.id} supervision={false} />
  if (user.role === 'eoe') return <Listado key={user.id} supervision={false} soloLectura />
  return <>
    <PageHeader title="Proyectos Escolares" subtitle={user.role === 'areal' ? 'Proyectos de tus escuelas asignadas.' : 'Proyectos registrados por las escuelas.'} />
    <TabBar label="Proyectos Escolares" items={[
      { id: 'proyectos', label: 'Proyectos', icon: 'book', color: 'sky' },
      { id: 'escuelas', label: 'Escuelas', icon: 'school', color: 'emerald' },
    ]} active={tab} onChange={setTab} />
    {tab === 'proyectos' ? <Listado key={`${user.id}:${user.role}`} supervision /> : <EscuelasProyectos key={`${user.id}:${user.role}`} />}
  </>
}

function Listado({ supervision, soloLectura = false }: { supervision: boolean; soloLectura?: boolean }) {
  const [pagina, setPagina] = useState(1)
  const [subiendo, setSubiendo] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [tipo, setTipo] = useState('')
  const [orden, setOrden] = useState('recientes')
  const [previa, setPrevia] = useState<{ nombre: string; url: string } | null>(null)
  const montado = useRef(true)
  const buscar = useDebounced(busqueda)
  useEffect(() => { montado.current = true; return () => { montado.current = false } }, [])
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa.url) }, [previa])
  const { data, error, loading, reload } = useAsync(async () => {
    if (supervision) {
      const r = await supabase.rpc('proyectos_supervision', {
        p_busqueda: buscar, p_tipo: tipo, p_orden: orden, p_lim: TAMANO, p_offset: (pagina - 1) * TAMANO,
      })
      if (r.error) throw r.error
      if (!r.data || !Array.isArray(r.data.filas) || !Number.isSafeInteger(r.data.total)) throw new Error('Respuesta inválida al consultar proyectos.')
      return { filas: r.data.filas as ProyectoSupervision[], total: r.data.total as number, pagina, buscar, tipo, orden }
    }
    const r = await supabase.from('proyectos_escolares').select('id,tipo,otro_tipo,nombre,bytes,created_at', { count: 'exact' })
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range((pagina - 1) * TAMANO, pagina * TAMANO - 1)
    if (r.error) throw r.error
    if (r.count == null) throw new Error('No se pudo contar los proyectos.')
    return { filas: r.data as ProyectoListado[], total: r.count, pagina, buscar, tipo, orden }
  }, [pagina, supervision, buscar, tipo, orden])
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
    } catch (e) { if (montado.current) toast.error(e instanceof Error ? e.message : String(e)) }
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
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setOcupado(null) }
  }

  return <>
    {!supervision && <PageHeader title={soloLectura ? 'Proyectos Escolares' : 'Mis Proyectos'} subtitle="Proyectos de tu escuela."
      actions={soloLectura ? <Badge>Solo lectura</Badge> : <button type="button" class={BTN_PRIMARY} disabled={!actual} onClick={() => setSubiendo(true)}>Subir proyecto</button>} />}
    {!supervision && !soloLectura && <Alert>Subí solamente los proyectos que se aplican al nivel y la modalidad de tu escuela. Se aceptan archivos PDF de hasta 5 MB; podés subir más de uno por tipo.</Alert>}
    {supervision && <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Lbl label="Buscar escuela, clave, CUE o proyecto"><input type="search" class={FIELD} value={busqueda} onInput={(e) => { setBusqueda(e.currentTarget.value); setPagina(1) }} /></Lbl>
      <Lbl label="Tipo de proyecto"><select class={FIELD} value={tipo} onChange={(e) => { setTipo(e.currentTarget.value); setPagina(1) }}>
        <option value="">Todos los tipos</option>{TIPOS_PROYECTO.map((t) => <option key={t} value={t}>{t}</option>)}
      </select></Lbl>
      <Lbl label="Ordenar por"><select class={FIELD} value={orden} onChange={(e) => { setOrden(e.currentTarget.value); setPagina(1) }}>
        <option value="recientes">Más recientes</option><option value="antiguos">Más antiguos</option>
        <option value="escuela">Escuela</option><option value="tipo">Tipo de proyecto</option><option value="archivo">Nombre del archivo</option>
      </select></Lbl>
    </div>}
    <div class="mt-4">
      {error && <div class="space-y-2"><Alert tone="error">{error}</Alert><button type="button" class={BTN_SECONDARY} onClick={reload}>Reintentar</button></div>}
      {!actual && !error && <Spinner />}
      {actual && <>
        {supervision && <p class="mb-3 text-sm text-slate-500">{actual.total} proyecto(s)</p>}
        {!actual.filas.length ? <Card><EmptyState title="Sin proyectos" text={supervision ? 'No hay proyectos con esos filtros.' : soloLectura ? 'La escuela aún no cargó proyectos.' : 'Elegí «Subir proyecto» para cargar un archivo.'} /></Card> :
          <div class="space-y-3">{actual.filas.map((p) => <Card key={p.id}>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-slate-900">{p.tipo === 'Otro' ? p.otro_tipo : p.tipo}</p>
                <p class="mt-1 break-all text-sm text-slate-700">{p.nombre}</p>
                {p.cue && <p class="mt-1 break-words text-sm text-slate-600">{[p.clave, [p.escuela_tipo, p.escuela_numero, p.escuela].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Escuela sin identificar'} · CUE {p.cue}</p>}
                <p class="mt-1 text-xs text-slate-500">{(p.bytes / 1024 / 1024).toFixed(2)} MB · {fecha(p.created_at)}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button type="button" class={BTN_SECONDARY} disabled={!!ocupado} onClick={() => void abrir(p, true)}>{ocupado === p.id ? 'Cargando…' : 'Previsualizar'}</button>
                <button type="button" class={BTN_SECONDARY} disabled={!!ocupado} onClick={() => void abrir(p, false)}>Descargar</button>
                {!supervision && !soloLectura && <button type="button" class={BTN_SECONDARY} disabled={!!ocupado} onClick={() => void eliminar(p)}>Eliminar</button>}
              </div>
            </div>
          </Card>)}</div>}
        <Pager page={pagina} total={actual.total} size={TAMANO} onPage={setPagina} />
      </>}
    </div>
    {subiendo && !soloLectura && <Formulario onClose={() => setSubiendo(false)} onDone={() => { setSubiendo(false); if (pagina !== 1) setPagina(1); else reload() }} />}
    {previa && <Modal title={`Vista previa: ${previa.nombre}`} onClose={() => setPrevia(null)} wide>
      <iframe src={previa.url} title={`Vista previa de ${previa.nombre}`} class="h-[65vh] w-full rounded border border-slate-200" />
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>Si no se muestra el PDF, abrilo en otra pestaña o descargalo.</span>
        <a class={BTN_SECONDARY} href={previa.url} target="_blank" rel="noopener noreferrer">Abrir en otra pestaña</a>
      </div>
    </Modal>}
  </>
}

type EscuelaProyectos = {
  id: number; cue: string; clave: string | null; codigo: string | null; tipo: string | null
  numero: number | null; nombre: string | null; nivel: string | null; modalidad: string | null
  cantidad: number | null; compartida: boolean
}

function EscuelasProyectos() {
  const [busqueda, setBusqueda] = useState('')
  const [nivel, setNivel] = useState('')
  const [modalidad, setModalidad] = useState('')
  const [pagina, setPagina] = useState(1)
  const buscar = useDebounced(busqueda)
  const { data, error, loading, reload } = useAsync(async () => {
    const r = await supabase.rpc('proyectos_por_escuela', {
      p_busqueda: buscar, p_nivel: nivel, p_modalidad: modalidad,
      p_lim: TAMANO, p_offset: (pagina - 1) * TAMANO,
    })
    if (r.error) throw r.error
    if (!r.data || !Array.isArray(r.data.filas) || !Array.isArray(r.data.niveles) || !Array.isArray(r.data.modalidades) || !Number.isSafeInteger(r.data.total)) {
      throw new Error('Respuesta inválida al consultar las escuelas.')
    }
    return { filas: r.data.filas as EscuelaProyectos[], total: r.data.total as number,
      niveles: r.data.niveles as string[], modalidades: r.data.modalidades as string[], buscar, nivel, modalidad, pagina }
  }, [buscar, nivel, modalidad, pagina])
  const actual = !error && !loading && buscar === busqueda && data?.buscar === buscar
    && data.nivel === nivel && data.modalidad === modalidad && data.pagina === pagina ? data : null
  return <>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Lbl label="Buscar escuela, clave o CUE"><input type="search" class={FIELD} value={busqueda} onInput={(e) => { setBusqueda(e.currentTarget.value); setPagina(1) }} /></Lbl>
      <Lbl label="Nivel"><select class={FIELD} value={nivel} onChange={(e) => { setNivel(e.currentTarget.value); setPagina(1) }}>
        <option value="">Todos los niveles</option>{data?.niveles.map((n) => <option key={n} value={n}>{n}</option>)}
      </select></Lbl>
      <Lbl label="Modalidad"><select class={FIELD} value={modalidad} onChange={(e) => { setModalidad(e.currentTarget.value); setPagina(1) }}>
        <option value="">Todas las modalidades</option>{data?.modalidades.map((m) => <option key={m} value={m}>{m}</option>)}
      </select></Lbl>
    </div>
    <div class="mt-4">
      {error && <div class="space-y-2"><Alert tone="error">{error}</Alert><button type="button" class={BTN_SECONDARY} onClick={reload}>Reintentar</button></div>}
      {!actual && !error && <Spinner />}
      {actual && <>
        <p class="mb-3 text-sm text-slate-500">{actual.total} escuela(s), incluidas las que aún no cargaron proyectos.</p>
        {!actual.filas.length ? <Card><EmptyState title="Sin escuelas" text="No hay escuelas con esos filtros." /></Card> :
          <div class="space-y-3">{actual.filas.map((e) => <Card key={e.id}>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="break-words font-semibold text-slate-900">{[e.tipo || e.codigo, e.numero, e.nombre].filter(Boolean).join(' ') || e.clave || `CUE ${e.cue}`}</p>
                <p class="mt-1 break-words text-sm text-slate-600">{e.clave || 'Sin clave provincial'} · CUE {e.cue}</p>
                <p class="mt-1 break-words text-xs text-slate-500">{[e.nivel, e.modalidad].filter(Boolean).join(' · ') || 'Nivel y modalidad sin informar'}</p>
                {e.compartida && <p class="mt-1 text-xs text-amber-700">Cantidad compartida entre escuelas con el mismo CUE y clave.</p>}
                {e.cantidad === null && <p class="mt-1 text-xs text-amber-700">Hay proyectos sin carpeta asociada; no se puede determinar la cantidad de esta escuela.</p>}
              </div>
              <Badge tone={e.cantidad === null || e.cantidad === 0 ? 'amber' : 'green'}>{e.cantidad === null ? 'Sin determinar' : `${e.cantidad} ${e.cantidad === 1 ? 'proyecto' : 'proyectos'}`}</Badge>
            </div>
          </Card>)}</div>}
        <Pager page={pagina} total={actual.total} size={TAMANO} onPage={setPagina} />
      </>}
    </div>
  </>
}

function Formulario({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [tipo, setTipo] = useState('')
  const [otro, setOtro] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guardar = async (e: Event) => {
    e.preventDefault()
    if (!tipo) return setError('Seleccioná un tipo de proyecto.')
    if (tipo === 'Otro' && !otro.trim()) return setError('Indicá el tipo de proyecto.')
    if (!archivo || !/\.pdf$/i.test(archivo.name) || archivo.size < 1 || archivo.size > MAX_PROYECTO) return setError('Elegí un PDF de hasta 5 MB.')
    setError(null); setGuardando(true)
    try {
      if (!esPdf(new Uint8Array(await archivo.slice(0, 5).arrayBuffer()))) throw new Error('El archivo no es un PDF válido.')
      const form = new FormData()
      form.append('action', 'upload'); form.append('tipo', tipo); form.append('otro_tipo', otro.trim()); form.append('archivo', archivo)
      await llamar(form)
      toast.ok('Proyecto subido')
      onDone()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setGuardando(false) }
  }
  return <Modal title="Subir proyecto" onClose={() => { if (!guardando) onClose() }}>
    <form class="space-y-4" onSubmit={guardar}>
      {error && <Alert tone="error">{error}</Alert>}
      <Lbl label="Tipo de proyecto"><select class={FIELD} required value={tipo} disabled={guardando} onChange={(e) => setTipo(e.currentTarget.value)}>
        <option value="">Seleccioná un tipo</option>
        {TIPOS_PROYECTO.map((t) => <option key={t} value={t}>{t}</option>)}
      </select></Lbl>
      {tipo === 'Otro' && <Lbl label="Indicá el tipo de proyecto"><input class={FIELD} required maxLength={150} value={otro} disabled={guardando} onInput={(e) => setOtro(e.currentTarget.value)} /></Lbl>}
      <Lbl label="Archivo PDF (máximo 5 MB)"><input class={`${FIELD} py-2`} type="file" accept=".pdf,application/pdf" required disabled={guardando}
        onChange={(e) => setArchivo(e.currentTarget.files?.[0] ?? null)} /></Lbl>
      <div class="flex justify-end gap-2">
        <button type="button" class={BTN_SECONDARY} disabled={guardando} onClick={onClose}>Cancelar</button>
        <button class={BTN_PRIMARY} disabled={guardando}>{guardando ? 'Subiendo…' : 'Subir'}</button>
      </div>
    </form>
  </Modal>
}
