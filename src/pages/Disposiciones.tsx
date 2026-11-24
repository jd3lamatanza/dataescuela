import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { abrirArchivo, abrirPdfFinal, CARGOS, finalizarTramite, FORMATOS_ACEPTADOS, quitarArchivo, REVISTAS, subirLote, validarArchivo, type AdjuntoEscolar, type Disposicion, type DisposicionEscolar, type MensajeDisposicion, type MotivoDisposicion } from '../lib/disposiciones'
import { SelectorEscuela, type Escuela } from './PreinscripcionEav'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, confirmar, toast, Toggle } from '../ui/kit'
import { Icon } from '../ui/Icon'

interface Datos { registros: Disposicion[]; escuelas: Escuela[]; inspectores: string[]; motivos: MotivoDisposicion[] }

async function cargar(puedeEditar: boolean): Promise<Datos> {
  const registros: Disposicion[] = []
  const escuelas: Escuela[] = []
  for (let offset = 0; ; offset += 500) {
    const r = await supabase.from('disposiciones').select('*,archivos:disposicion_archivos(*)').order('id', { ascending: false }).range(offset, offset + 499)
    if (r.error) throw r.error
    registros.push(...r.data as Disposicion[])
    if (r.data.length < 500) break
  }
  if (!puedeEditar) return { registros, escuelas, inspectores: [], motivos: [] }
  for (let offset = 0; ; offset += 500) {
    const r = await supabase.from('escuelas').select('id,nombre,tipo,numero,codigo,localidad,eav,clave').order('clave').range(offset, offset + 499)
    if (r.error) throw r.error
    escuelas.push(...r.data)
    if (r.data.length < 500) break
  }
  const [inspectores, motivos] = await Promise.all([
    supabase.from('inspectores').select('nombre').order('nombre'),
    supabase.from('disposicion_motivos').select('tipo,motivo,orden').order('tipo').order('orden'),
  ])
  if (inspectores.error) throw inspectores.error
  if (motivos.error) throw motivos.error
  return { registros, escuelas, inspectores: [...new Set(inspectores.data.map((i) => i.nombre).filter((n): n is string => !!n))], motivos: motivos.data }
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' })
const tono = (estado: string) => estado === 'Finalizada' ? 'green' : estado === 'Rechazada' ? 'red' : estado === 'Enviada a SAD' ? 'blue' : 'amber'
const estadoTexto = (estado: string) => estado === 'Finalizada' ? 'Aprobada' : estado
const titulo = (r: { cargo_cubrir: string; escuela_cubrir_nombre: string; docente_nombre: string }) =>
  [r.cargo_cubrir, r.escuela_cubrir_nombre, r.docente_nombre].filter(Boolean).join(' · ')

export function Disposiciones() {
  const { user } = useAuth()
  if (!user) return null
  if (user.role === 'escolar') return <ListadoEscolar key={user.id} />
  return <Listado key={`${user.id}-${user.role}`} distrito={user.role === 'distrital'} />
}

function ListadoEscolar() {
  const [buscar, setBuscar] = useState('')
  const [pagina, setPagina] = useState(1)
  const [detalle, setDetalle] = useState<DisposicionEscolar | null>(null)
  const { data, error, loading } = useAsync(async () => {
    const filas: DisposicionEscolar[] = []
    for (let offset = 0; ; offset += 500) {
      const r = await supabase.rpc('disposicion_escuelas_listar').range(offset, offset + 499)
      if (r.error) throw r.error
      filas.push(...r.data as DisposicionEscolar[])
      if (r.data.length < 500) break
    }
    const adjuntos: AdjuntoEscolar[] = []
    for (let offset = 0; ; offset += 500) {
      const r = await supabase.from('disposicion_archivos').select('id,disposicion_id,nombre,mime').order('id').range(offset, offset + 499)
      if (r.error) throw r.error
      adjuntos.push(...r.data)
      if (r.data.length < 500) break
    }
    return { filas, adjuntos }
  })
  const filas = (data?.filas ?? []).filter((r) => normalizar(`${r.id} ${r.estado} ${titulo(r)} ${r.inspector}`).includes(normalizar(buscar)))
  const actual = Math.min(pagina, Math.max(1, Math.ceil(filas.length / 20)))
  return <>
    <PageHeader title="Disposiciones" subtitle="Consultá el estado de los trámites y descargá las disposiciones finalizadas." />
    <input class={FIELD} type="search" aria-label="Buscar disposición" placeholder="Buscar por cargo, escuela, docente o estado" value={buscar} onInput={(e) => { setBuscar(e.currentTarget.value); setPagina(1) }} />
    {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
    {loading && !data ? <Spinner /> : data && <Card class="mt-3">
      {!filas.length ? <EmptyState title="Sin disposiciones" /> : <ul class="-my-4 divide-y divide-slate-200">
        {filas.slice((actual - 1) * 20, actual * 20).map((r) => <li key={r.id} class="flex flex-wrap items-center justify-between gap-3 py-4">
          <div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><p class="font-semibold text-slate-900">{titulo(r)}</p><Badge tone={tono(r.estado)}>{estadoTexto(r.estado)}</Badge></div><p class="mt-1 text-sm text-slate-500">{r.inspector} · {fecha(r.fecha_registro)}</p></div>
          {r.estado === 'Finalizada' ? <button class={BTN_SECONDARY} onClick={() => setDetalle(r)}><Icon name="eye" />Abrir disposición</button>
            : <span class="text-xs text-slate-500">Disponible al aprobarse</span>}
        </li>)}
      </ul>}
    </Card>}
    <Pager page={actual} total={filas.length} size={20} onPage={setPagina} />
    {detalle && data && <DetalleEscolar registro={detalle} archivos={data.adjuntos.filter((a) => a.disposicion_id === detalle.id)} onClose={() => setDetalle(null)} />}
  </>
}

function DetalleEscolar({ registro, archivos, onClose }: { registro: DisposicionEscolar; archivos: AdjuntoEscolar[]; onClose(): void }) {
  const { data, error, loading } = useAsync(async () => {
    const r = await supabase.rpc('disposicion_escuela_detalle', { p_id: registro.id }).maybeSingle()
    if (r.error) throw r.error
    if (!r.data) throw new Error('La disposición ya no está disponible.')
    return r.data as Disposicion
  }, [registro.id])
  return <Modal title="Disposición aprobada" onClose={onClose} wide>
    {error && <Alert tone="error">{error}</Alert>}
    {loading && !data ? <Spinner /> : data && <>
      <div class="rounded-xl bg-sky-50 p-4"><p class="font-semibold text-slate-900">{titulo(data)}</p><p class="mt-1 text-sm text-slate-600">{data.inspector} · {fecha(data.fecha_registro)}</p></div>
      <section class="mt-5"><h3 class="font-semibold text-slate-900">Documentación disponible</h3>
        <div class="mt-3 flex flex-wrap gap-2">
          {registro.pdf_disponible && <button class={BTN_SECONDARY} onClick={() => abrirPdfFinal(registro.id).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}><Icon name="download" />Descargar PDF final</button>}
          {archivos.map((a) => <button key={a.id} class={`${BTN_SECONDARY} max-w-full`} onClick={() => abrirArchivo(a).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}><Icon name="download" /><span class="break-all">{a.nombre}</span></button>)}
          {!registro.pdf_disponible && !archivos.length && <p class="text-sm text-slate-500">Todavía no hay documentación disponible. Consultá a Jefatura.</p>}
        </div>
      </section>
      <div class="mt-5 border-t border-slate-200 pt-4"><h3 class="font-semibold text-slate-900">Datos de la disposición</h3><DatosDetalle registro={data} /></div>
    </>}
  </Modal>
}

function Listado({ distrito }: { distrito: boolean }) {
  const { data, error, loading, reload } = useAsync(() => cargar(true), [])
  const [buscar, setBuscar] = useState('')
  const [pagina, setPagina] = useState(1)
  const [tamano, setTamano] = useState(20)
  const [editar, setEditar] = useState<Disposicion | 'nuevo' | null>(null)
  const registros = useMemo(() => {
    const q = normalizar(buscar)
    return (data?.registros ?? []).filter((r) => !q || normalizar([r.id, r.inspector, r.docente_nombre, r.escuela_cubrir_clave, r.escuela_cubrir_nombre, r.escuela_base_clave, r.escuela_base_nombre, r.tipo, r.motivo, r.estado].join(' ')).includes(q))
  }, [data, buscar])
  const totalPaginas = Math.max(1, Math.ceil(registros.length / tamano))
  const actual = Math.min(pagina, totalPaginas)
  const abrir = async (r: Disposicion) => {
    if (distrito && r.creado_areal && !r.leida_at) {
      const { error } = await supabase.rpc('disposicion_marcar_leida', { p_id: r.id })
      if (error) return toast.error(error.message)
      reload()
    }
    setEditar(r)
  }

  return <>
    <PageHeader title="Disposiciones" subtitle="Registro y seguimiento de disposiciones por escuela."
      actions={<button type="button" class={BTN_PRIMARY} disabled={!data || !!error} onClick={() => setEditar('nuevo')}><Icon name="plus" />Nueva disposición</button>} />
    {error && <div class="mb-3"><Alert tone="error">{error}</Alert></div>}
    {loading && !data ? <Spinner /> : data && <>
      <div class="mb-4 flex flex-wrap gap-2">
        <Badge tone="blue">{data.registros.length} disposiciones</Badge>
        <Badge tone="amber">{data.registros.filter((r) => r.estado === 'Pendiente' || r.estado === 'En proceso').length} pendientes</Badge>
        <Badge tone="green">{data.registros.filter((r) => r.estado === 'Finalizada').length} aprobadas</Badge>
      </div>
      <div class="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input class={FIELD} type="search" aria-label="Buscar disposición" placeholder="Buscar por escuela, docente, inspector, tipo o estado" value={buscar} onInput={(e) => { setBuscar(e.currentTarget.value); setPagina(1) }} />
        <select class={FIELD} aria-label="Resultados por página" value={tamano} onChange={(e) => { setTamano(Number(e.currentTarget.value)); setPagina(1) }}>
          {[10, 20, 50, 100].map((n) => <option value={n}>{n} por página</option>)}
        </select>
      </div>
      {!registros.length ? <EmptyState title="Sin disposiciones" text="No hay registros con esos criterios." /> : <Card>
        <ul class="-my-4 divide-y divide-slate-200">
          {registros.slice((actual - 1) * tamano, actual * tamano).map((r) => <li key={r.id} class="flex flex-wrap items-start gap-3 py-3">
            {distrito && <span class={r.creado_areal && !r.leida_at ? 'text-sky-600' : 'text-slate-400'} title={r.creado_areal && !r.leida_at ? 'Sin abrir' : 'Abierta'} aria-label={r.creado_areal && !r.leida_at ? 'Sin abrir' : 'Abierta'}><Icon name={r.creado_areal && !r.leida_at ? 'mail' : 'mail-open'} /></span>}
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2"><p class="font-semibold text-slate-900">{titulo(r)}</p><Badge tone={tono(r.estado)}>{estadoTexto(r.estado)}</Badge></div>
              <p class="mt-1 text-sm text-slate-500">{r.inspector} · {fecha(r.fecha_registro)}</p>
              {r.archivos.length > 0 && <p class="mt-1 text-xs text-slate-500">{r.archivos.length} {r.archivos.length === 1 ? 'probanza' : 'probanzas'}</p>}
            </div>
            <button type="button" class={BTN_SECONDARY} aria-label={`Abrir disposición ${r.id}`} onClick={() => void abrir(r)}><Icon name={distrito ? 'edit' : 'eye'} />{distrito ? 'Ver y editar' : 'Ver detalle'}</button>
          </li>)}
        </ul>
      </Card>}
      <Pager page={actual} total={registros.length} size={tamano} onPage={setPagina} />
      {editar && (distrito || editar === 'nuevo'
        ? <Formulario registro={editar === 'nuevo' ? null : editar} data={data} distrito={distrito} onClose={() => setEditar(null)} onDone={() => { setEditar(null); reload() }} />
        : <Detalle registro={editar} onClose={() => { setEditar(null); reload() }} />)}
    </>}
  </>
}

function DatosDetalle({ registro: r }: { registro: Disposicion }) {
  const fechaDia = (s: string) => s.split('-').reverse().join('/')
  const escuela = (clave: string, nombre: string) => [clave, nombre].filter(Boolean).join(' · ')
  const campos = [
    ['Estado', estadoTexto(r.estado)], ['Fecha de registro', fecha(r.fecha_registro)],
    ['Inspector solicitante', r.inspector], ['Correo de jefatura', r.email_jefatura],
    ['Nombre completo del docente', r.docente_nombre], ['CUIL del docente', r.docente_cuil], ['Correo del docente', r.docente_email],
    ['Escuela a cubrir', escuela(r.escuela_cubrir_clave, r.escuela_cubrir_nombre)],
    ['Cargo a cubrir', r.cargo_cubrir], ['Revista a cubrir', r.revista_cubrir], ['Tipo de disposición', r.tipo], ['Motivo', r.motivo],
    ['Fecha de designación', fechaDia(r.fecha_designacion)], ['Número de designación', r.numero_designacion],
    ['Escuela base afectada', `${escuela(r.escuela_base_clave, r.escuela_base_nombre)}${r.escuela_base_fuera_distrital ? ' (fuera de la Distrital)' : ''}`],
    ['Cargo base', r.cargo_base], ['Revista base', r.revista_base], ['Fecha desde', fechaDia(r.fecha_desde)],
    ['Observaciones', r.observaciones || '—'], ['Usuario', r.usuario], ['Última actualización', fecha(r.actualizada)],
  ]
  return <dl class="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
      {campos.map(([label, valor]) => <div key={label} class="min-w-0 rounded-lg bg-slate-50 p-3"><dt class="text-xs font-semibold text-slate-500">{label}</dt><dd class="mt-1 break-words text-sm text-slate-900">{valor}</dd></div>)}
    </dl>
}

function Detalle({ registro: r, onClose }: { registro: Disposicion; onClose(): void }) {
  return <Modal title={`Disposición #${r.id}`} onClose={onClose} wide>
    <p class="mb-3 text-sm text-slate-500">El estado lo actualiza Jefatura.</p>
    <DatosDetalle registro={r} />
    {r.estado !== 'Finalizada' && <CargasPendientes id={r.id} />}
    <Seguimiento id={r.id} mostrarDocumentos puedeAdjuntar={r.estado !== 'Finalizada'} />
    <div class="mt-4 flex justify-end"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cerrar</button></div>
  </Modal>
}

function Seguimiento({ id, puedeAdjuntar = false, mostrarDocumentos = false }: { id: number; puedeAdjuntar?: boolean; mostrarDocumentos?: boolean }) {
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, error, loading, reload } = useAsync(async () => {
    const [mensajes, docs, final] = await Promise.all([
      supabase.from('disposicion_mensajes').select('id,autor,rol,texto,created_at').eq('disposicion_id', id).order('id'),
      supabase.from('disposicion_archivos').select('*').eq('disposicion_id', id).order('id'),
      supabase.from('disposicion_final').select('nombre').eq('disposicion_id', id).maybeSingle(),
    ])
    if (mensajes.error) throw mensajes.error
    if (docs.error) throw docs.error
    if (final.error) throw final.error
    return { mensajes: mensajes.data as MensajeDisposicion[], archivos: docs.data as Disposicion['archivos'], final: final.data }
  }, [id])
  const enviar = async () => {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('disposicion_comentar', { p_id: id, p_texto: texto })
      if (error) throw error
      setTexto(''); reload(); toast.ok('Respuesta enviada')
    } catch (e) { toast.error(e && typeof e === 'object' && 'message' in e ? String(e.message) : 'No se pudo enviar la respuesta') }
    finally { setBusy(false) }
  }
  const agregar = async (lista: FileList | null) => {
    if (!lista) return
    const nuevos = Array.from(lista)
    setBusy(true)
    try {
      await subirLote(id, nuevos, true)
      toast.ok('Documentación agregada')
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false); reload() }
  }
  return <section class="mt-4 space-y-3 border-t border-slate-200 pt-4">
    <h3 class="font-semibold text-slate-900">Seguimiento</h3>
    {error && <Alert tone="error">{error}</Alert>}
    {loading && !data ? <Spinner /> : data && <>
      {data.final && <button type="button" class={BTN_SECONDARY} onClick={() => abrirPdfFinal(id).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}><Icon name="download" />PDF final: {data.final.nombre}</button>}
      {mostrarDocumentos && <>
        <p class="text-sm text-slate-600">Documentación: {data.archivos.length} archivos. PDF, imágenes, Word o Excel de hasta 10 MB cada uno.</p>
        <ul class="space-y-1">{data.archivos.map((a) => <li key={a.id}><button type="button" class="text-sm text-sky-700 underline" onClick={() => abrirArchivo(a).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}>{a.nombre}</button></li>)}</ul>
        {puedeAdjuntar && <label class={`${BTN_SECONDARY} cursor-pointer`}>Agregar documentación
          <input type="file" class="sr-only" multiple accept={FORMATOS_ACEPTADOS} disabled={busy}
            onChange={(e) => { void agregar(e.currentTarget.files); e.currentTarget.value = '' }} />
        </label>}
      </>}
      {data.mensajes.length ? <ol class="space-y-2">{data.mensajes.map((m) => <li key={m.id} class="rounded-lg border border-slate-200 p-3 text-sm">
        <p class="text-xs text-slate-500">{m.autor} · {m.rol === 'areal' ? 'Inspector' : 'Jefatura'} · {fecha(m.created_at)}</p><p class="whitespace-pre-line">{m.texto}</p>
      </li>)}</ol> : <p class="text-sm text-slate-500">Sin mensajes de seguimiento.</p>}
      {puedeAdjuntar && <><Lbl label="Responder a Jefatura"><textarea class={FIELD} rows={3} maxLength={3000} value={texto} onInput={(e) => setTexto(e.currentTarget.value)} /></Lbl>
        <button type="button" class={BTN_PRIMARY} disabled={busy || !texto.trim()} onClick={() => void enviar()}>Enviar respuesta</button></>}
    </>}
  </section>
}

function CargasPendientes({ id }: { id: number }) {
  const [busy, setBusy] = useState(false)
  const { data, error, reload } = useAsync(async () => {
    const r = await supabase.rpc('disposicion_lotes_pendientes', { p_id: id })
    if (r.error) throw r.error
    return r.data as { id: string; creado_at: string; cantidad: number; cargados: number }[]
  }, [id])
  if (error) return <Alert tone="error">No se pudieron consultar las cargas pendientes: {error}</Alert>
  if (!data?.length) return null
  return <div class="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
    <p class="text-sm text-amber-900">Hay cargas interrumpidas. Cancelalas antes de aprobar; los archivos incompletos podrían permanecer en Drive.</p>
    {data.map((l) => <div key={l.id} class="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{fecha(l.creado_at)} · {l.cargados} de {l.cantidad} archivos</span>
      <button type="button" class={BTN_SECONDARY} disabled={busy} onClick={async () => {
        if (!await confirmar('Cancelar carga', { text: 'Los archivos que ya llegaron a Drive podrían permanecer allí.', ok: 'Cancelar carga' })) return
        setBusy(true)
        const r = await supabase.rpc('disposicion_lote_cerrar', { p_lote: l.id, p_completar: false })
        if (r.error) toast.error(r.error.message); else { toast.ok('Carga cancelada'); reload() }
        setBusy(false)
      }}>Cancelar carga</button>
    </div>)}
  </div>
}

function Formulario({ registro, data, distrito, onClose, onDone }: { registro: Disposicion | null; data: Datos; distrito: boolean; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({
    estado: registro?.estado ?? 'En proceso', inspector: registro?.inspector ?? '', email_jefatura: registro?.email_jefatura ?? '',
    docente_nombre: registro?.docente_nombre ?? '', docente_cuil: registro?.docente_cuil ?? '', docente_email: registro?.docente_email ?? '',
    escuela_cubrir_id: registro ? String(registro.escuela_cubrir_id) : '', cargo_cubrir: registro?.cargo_cubrir ?? '', revista_cubrir: registro?.revista_cubrir ?? '',
    tipo: registro?.tipo ?? '', motivo: registro?.motivo ?? '', fecha_designacion: registro?.fecha_designacion ?? '', numero_designacion: registro?.numero_designacion ?? '',
    escuela_base_id: registro?.escuela_base_id ? String(registro.escuela_base_id) : '',
    escuela_base_clave: registro?.escuela_base_fuera_distrital ? registro.escuela_base_clave : '',
    escuela_base_nombre: registro?.escuela_base_fuera_distrital ? registro.escuela_base_nombre : '', cargo_base: registro?.cargo_base ?? '',
    revista_base: registro?.revista_base ?? '', fecha_desde: registro?.fecha_desde ?? '', observaciones: registro?.observaciones ?? '',
  })
  const [actuales, setActuales] = useState(registro?.archivos ?? [])
  const [nuevos, setNuevos] = useState<File[]>([])
  const [fueraDistrital, setFueraDistrital] = useState(registro?.escuela_base_fuera_distrital ?? false)
  const [cambiarBase, setCambiarBase] = useState(!registro || !!registro.escuela_base_id)
  const [error, setError] = useState('')
  const [mensajeEstado, setMensajeEstado] = useState('')
  const [archivosFinales, setArchivosFinales] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const escuelas = data.escuelas.map((e) => ({ ...e, nombre: [e.clave, e.nombre].filter(Boolean).join(' · ') }))
  const tipos = [...new Set(data.motivos.map((m) => m.tipo))]
  const inspectores = f.inspector && !data.inspectores.includes(f.inspector) ? [f.inspector, ...data.inspectores] : data.inspectores
  const actualizar = (k: keyof typeof f, valor: string) => setF((prev) => ({ ...prev, [k]: valor }))
  const agregar = (files: FileList | null) => {
    if (!files) return
    const lista = Array.from(files)
    try { lista.forEach(validarArchivo) } catch (e) { setError(e instanceof Error ? e.message : String(e)); return }
    setError(''); setNuevos((prev) => [...prev, ...lista])
  }
  const guardar = async (e: Event) => {
    e.preventDefault(); setError('')
    if (!registro && !distrito && !nuevos.length) {
      setError('Agregá al menos una probanza para iniciar el trámite.')
      return
    }
    setBusy(true)
    let guardado = false
    try {
      const { estado: _estado, ...resto } = f
      const datos = {
        ...resto, docente_cuil: f.docente_cuil.replace(/\D/g, ''), escuela_cubrir_id: Number(f.escuela_cubrir_id),
        escuela_base_id: !fueraDistrital && f.escuela_base_id ? Number(f.escuela_base_id) : null,
        escuela_base_fuera_distrital: fueraDistrital, escuela_cubrir_clave: '', escuela_cubrir_nombre: '', usuario: '',
      }
      const r = registro
        ? await supabase.from('disposiciones').update(datos).eq('id', registro.id).select('id').single()
        : await supabase.from('disposiciones').insert(datos).select('id').single()
      if (r.error) throw r.error
      guardado = true
      for (const anterior of registro?.archivos ?? []) if (!actuales.some((a) => a.id === anterior.id)) await quitarArchivo(anterior.id)
      await subirLote(r.data.id, nuevos)
      toast.ok(registro ? 'Disposición actualizada' : 'Disposición registrada')
      onDone()
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)
      if (guardado) { toast.error(`La disposición se guardó parcialmente: ${mensaje}. Revisá el trámite antes de continuar.`); onDone() }
      else setError(mensaje)
    } finally { setBusy(false) }
  }
  const campo = (label: string, key: keyof typeof f, type = 'text') => <Lbl label={label}><input class={FIELD} type={type} required value={f[key]} onInput={(e) => actualizar(key, e.currentTarget.value)} /></Lbl>
  const select = (label: string, key: keyof typeof f, options: string[]) => <Lbl label={label}><select class={FIELD} required value={f[key]} onChange={(e) => actualizar(key, e.currentTarget.value)}><option value="">Seleccioná…</option>{options.map((v) => <option key={v} value={v}>{v}</option>)}</select></Lbl>
  return <Modal title={registro ? `Disposición #${registro.id}` : 'Nueva disposición'} onClose={() => { if (!busy) onClose() }} wide>
    {registro && <section class="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
      <h3 class="font-semibold text-emerald-900">Finalizar trámite</h3>
      {registro.estado === 'Finalizada' ? <p class="mt-1 text-sm text-emerald-700">El trámite está aprobado.</p> : <>
      <p class="mt-1 text-sm text-slate-600">Revisá los datos y archivos. Podés aprobar con la última carga o elegir nueva documentación para la escuela.</p>
      <CargasPendientes id={registro.id} />
      <input class="mt-3 block w-full text-sm" type="file" multiple accept={FORMATOS_ACEPTADOS} disabled={busy} aria-label="Nueva documentación para aprobar (opcional)" onChange={(e) => setArchivosFinales(Array.from(e.currentTarget.files ?? []))} />
      <button type="button" class={`${BTN_PRIMARY} mt-3`} disabled={busy} onClick={async () => {
        setBusy(true)
        try {
          archivosFinales.forEach(validarArchivo)
          if (!await confirmar('Aprobar disposición', { text: 'La escuela verá los datos y la última carga completa. Los cambios del formulario que no hayas guardado se perderán.', ok: 'Aprobar' })) return
          await subirLote(registro.id, archivosFinales, true)
          await finalizarTramite(registro.id); toast.ok('Trámite aprobado'); onDone()
        }
        catch (e) { setError(e instanceof Error ? e.message : String(e)) }
        finally { setBusy(false) }
      }}>Finalizar trámite</button>
      </>}
    </section>}
    {registro && registro.estado !== 'Finalizada' && <section class="mb-5 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <h3 class="font-semibold text-amber-900">Devolver para corrección</h3>
      <p class="mt-1 text-sm text-slate-600">Indicá qué debe revisar o adjuntar el inspector.</p>
      <div class="mt-3"><Lbl label="Observación para el inspector"><textarea class={FIELD} rows={3} maxLength={3000} value={mensajeEstado} onInput={(e) => setMensajeEstado(e.currentTarget.value)} /></Lbl></div>
      <button type="button" class={`${BTN_SECONDARY} mt-3`} disabled={busy || !mensajeEstado.trim()} onClick={async () => {
        setBusy(true)
        try {
          const resultado = await supabase.rpc('disposicion_cambiar_estado', { p_id: registro.id, p_estado: 'Devuelta para Corrección', p_texto: mensajeEstado })
          if (resultado.error) throw resultado.error
          toast.ok('Disposición devuelta para corrección'); onDone()
        } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
        finally { setBusy(false) }
      }}>Devolver para corrección</button>
    </section>}
    <form class="space-y-4" onSubmit={guardar}>
      {error && <Alert tone="error">{error}</Alert>}
      <div class="grid gap-3 sm:grid-cols-2">
        {distrito ? select('Inspector solicitante', 'inspector', inspectores) : <p class="text-sm text-slate-600">Inspector solicitante: se asignará automáticamente a tu cuenta.</p>}
        {campo('Correo de jefatura (@abc.gob.ar)', 'email_jefatura', 'email')}
        {campo('Nombre completo del docente', 'docente_nombre')}
        {campo('CUIL del docente', 'docente_cuil')}
        {campo('Correo del docente (@abc.gob.ar)', 'docente_email', 'email')}
        <SelectorEscuela id="disposicion-cubrir" label="Escuela a cubrir" escuelas={escuelas} value={f.escuela_cubrir_id} onChange={(v) => actualizar('escuela_cubrir_id', v)} />
        {select('Cargo a cubrir', 'cargo_cubrir', CARGOS)}
        {select('Revista a cubrir', 'revista_cubrir', REVISTAS)}
        <Lbl label="Tipo de disposición"><select class={FIELD} required value={f.tipo} onChange={(e) => setF((prev) => ({ ...prev, tipo: e.currentTarget.value, motivo: '' }))}><option value="">Seleccioná…</option>{tipos.map((v) => <option key={v} value={v}>{v}</option>)}</select></Lbl>
        {select('Motivo', 'motivo', data.motivos.filter((m) => m.tipo === f.tipo).map((m) => m.motivo))}
        {campo('Fecha de designación', 'fecha_designacion', 'date')}
        {campo('Número de designación', 'numero_designacion')}
        <div>
          <div class="mb-2"><Toggle label="Escuela fuera de la Distrital" checked={fueraDistrital} onChange={(valor) => {
            setFueraDistrital(valor)
            if (!valor && registro?.escuela_base_fuera_distrital) setCambiarBase(true)
          }} /></div>
          {fueraDistrital ? <div class="space-y-2">
            {campo('Nombre de la escuela base', 'escuela_base_nombre')}
            <Lbl label="Clave provincial (opcional)"><input class={FIELD} value={f.escuela_base_clave} onInput={(e) => actualizar('escuela_base_clave', e.currentTarget.value)} /></Lbl>
          </div> : cambiarBase && <SelectorEscuela id="disposicion-base" label="Escuela base afectada" escuelas={escuelas} value={f.escuela_base_id} onChange={(v) => actualizar('escuela_base_id', v)} />}
          {!fueraDistrital && registro && !registro.escuela_base_id && !registro.escuela_base_fuera_distrital && <div class="mt-1 text-xs text-amber-700">
            Escuela histórica no encontrada: {registro.escuela_base_clave} · {registro.escuela_base_nombre}. Se conservará el dato original hasta que selecciones una escuela.
            <button type="button" class="ml-2 underline" onClick={() => { setCambiarBase(!cambiarBase); actualizar('escuela_base_id', '') }}>{cambiarBase ? 'Conservar dato original' : 'Seleccionar escuela'}</button>
          </div>}
        </div>
        {campo('Cargo base', 'cargo_base')}
        {select('Revista base', 'revista_base', REVISTAS)}
        {campo('Fecha desde', 'fecha_desde', 'date')}
      </div>
      <Lbl label="Observaciones"><textarea class={FIELD} rows={3} value={f.observaciones} onInput={(e) => actualizar('observaciones', e.currentTarget.value)} /></Lbl>
      <section>
        <h3 class="font-semibold text-slate-900">Probanzas</h3>
        <p class="text-xs text-slate-500">PDF, imágenes, Word o Excel. Sin límite de cantidad; hasta 10 MB por archivo.</p>
        <ul class="mt-2 space-y-2">
          {actuales.map((a) => <li key={a.id} class="flex items-center justify-between gap-2 text-sm"><button type="button" class="text-sky-700 underline" onClick={() => abrirArchivo(a).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}>{a.nombre}</button>{registro?.estado !== 'Finalizada' && <button type="button" class={BTN_SECONDARY} aria-label={`Quitar ${a.nombre}`} onClick={() => setActuales((prev) => prev.filter((x) => x.id !== a.id))}><Icon name="x" /></button>}</li>)}
          {nuevos.map((a, i) => <li key={`${a.name}-${i}`} class="flex items-center justify-between gap-2 text-sm"><span>{a.name}</span><button type="button" class={BTN_SECONDARY} aria-label={`Quitar ${a.name}`} onClick={() => setNuevos((prev) => prev.filter((_, n) => n !== i))}><Icon name="x" /></button></li>)}
        </ul>
        <input class="mt-2 block w-full text-sm" type="file" accept={FORMATOS_ACEPTADOS} multiple disabled={busy || registro?.estado === 'Finalizada'} onChange={(e) => { agregar(e.currentTarget.files); e.currentTarget.value = '' }} aria-label="Agregar probanzas" />
      </section>
      {registro && <Seguimiento id={registro.id} />}
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={busy} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
  </Modal>
}
