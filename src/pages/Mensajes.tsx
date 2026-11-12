import { useEffect, useRef, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Alert, BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, Card, FIELD, Lbl, PageHeader, Spinner, TabBar, confirmar, toast, type TabItem } from '../ui/kit'
import { Icon } from '../ui/Icon'

type Carpeta = 'recibidos' | 'enviados' | 'borradores' | 'destacados' | 'archivados' | 'papelera'
const CARPETAS: (TabItem & { id: Carpeta })[] = [
  { id: 'recibidos', label: 'Recibidos', icon: 'inbox', color: 'sky' },
  { id: 'enviados', label: 'Enviados', icon: 'send', color: 'cyan' },
  { id: 'borradores', label: 'Borradores', icon: 'edit', color: 'violet' },
  { id: 'destacados', label: 'Destacados', icon: 'star', color: 'amber' },
  { id: 'archivados', label: 'Archivados', icon: 'archive', color: 'emerald' },
  { id: 'papelera', label: 'Papelera', icon: 'trash', color: 'rose' },
]
interface Destino { buzon: string; nombre: string; rol?: string }
interface Adjunto { id: number; nombre: string; bytes: number }
interface Fila { id: number; carpeta: 'recibidos' | 'enviados'; autor: string; asunto: string; cuerpo: string; fecha: string; leido: boolean; destacado: boolean; archivado: boolean; papelera: boolean; adjuntos: number; total: number }
interface Detalle { id: number; autor: string; autor_buzon: string; asunto: string; cuerpo: string; fecha: string; destinatarios: Destino[]; adjuntos: Adjunto[] }
interface Borrador { id: number | null; asunto: string; cuerpo: string; destinatarios: string[]; respuesta_a: number | null; actualizado_en?: string; total?: number }
const vacio = (): Borrador => ({ id: null, asunto: '', cuerpo: '', destinatarios: [], respuesta_a: null })
const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
const avisar = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))
const evento = () => dispatchEvent(new Event('correo-changed'))
async function rpc<T>(nombre: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) throw new Error(error.message)
  return data as T
}
async function cargarDestinos(): Promise<Destino[]> {
  const destinos: Destino[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.rpc('correo_destinos').range(offset, offset + 499)
    if (error) throw new Error(error.message)
    const pagina = data as Destino[]
    destinos.push(...pagina)
    if (pagina.length < 500) return destinos
  }
}

export function Mensajes() {
  const { user } = useAuth()
  const [carpeta, setCarpeta] = useState<Carpeta>('recibidos')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState('')
  const [pagina, setPagina] = useState(0)
  const [version, setVersion] = useState(0)
  const [filas, setFilas] = useState<Fila[]>([])
  const [borradores, setBorradores] = useState<Borrador[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<{ item: Fila; detalle: Detalle } | null>(null)
  const [escribir, setEscribir] = useState<Borrador | null>(null)
  const [destinos, setDestinos] = useState<Destino[]>([])
  const [extra, setExtra] = useState<Destino[]>([])
  const actualizar = () => { setVersion((n) => n + 1); evento() }

  useEffect(() => {
    const refrescar = () => setVersion((n) => n + 1)
    addEventListener('correo-refrescar', refrescar)
    return () => removeEventListener('correo-refrescar', refrescar)
  }, [])
  useEffect(() => {
    let vivo = true
    cargarDestinos().then((d) => { if (vivo) setDestinos(d) }).catch((e) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [user?.id])
  useEffect(() => {
    let vivo = true
    setLoading(true); setError('')
    const consulta = carpeta === 'borradores'
      ? rpc<Borrador[]>('correo_borradores_listar', { p_busqueda: q.trim(), p_limite: 20, p_offset: pagina * 20 }).then((d) => { if (vivo) setBorradores(d) })
      : rpc<Fila[]>('correo_listar', { p_carpeta: carpeta, p_busqueda: q.trim(), p_filtro: filtro, p_limite: 20, p_offset: pagina * 20 }).then((d) => { if (vivo) setFilas(d) })
    consulta.catch((e) => { if (vivo) setError(e.message) }).finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [carpeta, q, filtro, pagina, version, user?.id])

  const cambiarCarpeta = (v: Carpeta) => { setCarpeta(v); setPagina(0); setAbierto(null); setEscribir(null) }
  const ver = async (item: Fila) => {
    try { const detalle = await rpc<Detalle>('correo_detalle', { p_id: item.id, p_carpeta: item.carpeta }); setAbierto({ item, detalle }); actualizar() }
    catch (e) { avisar(e) }
  }
  const accion = async (item: Fila, a: string) => {
    try { await rpc('correo_cambiar_estado', { p_id: item.id, p_carpeta: item.carpeta, p_accion: a }); setAbierto(null); actualizar() }
    catch (e) { avisar(e) }
  }
  const responder = async (modo: 'autor' | 'todos' | 'reenviar') => {
    if (!abierto) return
    try {
      const { detalle: d } = abierto
      const participantes = await rpc<Destino[]>('correo_participantes', { p_id: d.id })
      const miBuzon = user?.role === 'distrital' ? 'jd3' : user?.id
      const elegidos = modo === 'reenviar' ? [] : modo === 'autor' ? [d.autor_buzon] : participantes.map((p) => p.buzon)
      const borrador: Borrador = {
        id: null, asunto: `${modo === 'reenviar' ? 'Fwd' : 'Re'}: ${d.asunto}`.slice(0, 150),
        cuerpo: modo === 'reenviar' ? `\n\n--- Mensaje reenviado ---\nDe: ${d.autor}\nFecha: ${fecha(d.fecha)}\n\n${d.cuerpo}` : '',
        destinatarios: [...new Set(elegidos.filter((v) => v !== miBuzon))], respuesta_a: modo === 'reenviar' ? null : d.id,
      }
      if (modo === 'reenviar' && d.adjuntos.length) {
        borrador.id = await rpc<number>('correo_guardar_borrador', { p_id: null, p_asunto: borrador.asunto, p_cuerpo: borrador.cuerpo, p_destinatarios: [], p_respuesta_a: null })
        await rpc('correo_copiar_adjuntos', { p_borrador: borrador.id, p_mensaje: d.id })
      }
      setExtra(modo === 'reenviar' ? [] : participantes.filter((p) => p.buzon !== miBuzon))
      setAbierto(null); setEscribir(borrador)
    } catch (e) { avisar(e) }
  }
  const descarga = async (a: Adjunto) => {
    try {
      const { data, error: err } = await supabase.functions.invoke('correo-drive', { body: { action: 'download', id: a.id } })
      if (err) throw err
      if (!(data instanceof Blob)) throw new Error('Respuesta de descarga inválida')
      const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = a.nombre; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { avisar(e) }
  }
  const total = Number(carpeta === 'borradores' ? borradores[0]?.total ?? 0 : filas[0]?.total ?? 0)
  return <>
    <PageHeader title="Mensajes" subtitle="Correo interno de DataEscuela" actions={<button class={BTN_PRIMARY} disabled={!!escribir} onClick={() => { setExtra([]); setAbierto(null); setEscribir(vacio()) }}><Icon name="edit" class="size-4" />Redactar</button>} />
    <TabBar label="Carpetas de mensajes" items={CARPETAS.map((c) => ({ ...c, disabled: !!escribir }))} active={carpeta} onChange={(id) => { const destino = CARPETAS.find((c) => c.id === id); if (destino) cambiarCarpeta(destino.id) }} />
    {error && <Alert tone="error">{error}</Alert>}
    {escribir ? <Redactar inicial={escribir} destinos={destinos} extra={extra} onClose={() => { setEscribir(null); actualizar() }} onSent={() => { setEscribir(null); cambiarCarpeta('enviados'); actualizar() }} descarga={descarga} /> :
      abierto ? <Card title={abierto.detalle.asunto}>
        <div class="space-y-4">
          <div class="rounded-lg bg-slate-50 p-4 text-sm text-slate-600"><p><strong>De:</strong> {abierto.detalle.autor}</p><p><strong>Para:</strong> {abierto.detalle.destinatarios.map((d) => d.nombre).join(', ')}</p><p class="mt-1 text-xs">{fecha(abierto.detalle.fecha)}</p></div>
          <p class="whitespace-pre-wrap text-sm">{abierto.detalle.cuerpo}</p>
          {abierto.detalle.adjuntos.map((a) => <button class={`${BTN_SECONDARY} mr-2`} onClick={() => descarga(a)} key={a.id}><Icon name="download" class="size-4" />Descargar {a.nombre} ({(a.bytes / 1048576).toFixed(2)} MB)</button>)}
          <div class="flex flex-wrap gap-2">
            <button class={BTN_SECONDARY} onClick={() => setAbierto(null)}><Icon name="chevl" class="size-4" />Volver</button>
            {abierto.item.carpeta === 'recibidos' && <><button class={BTN_PRIMARY} onClick={() => responder('autor')}><Icon name="reply" class="size-4" />Responder</button><button class={BTN_SECONDARY} onClick={() => responder('todos')}><Icon name="users" class="size-4" />Responder a todos</button></>}
            <button class={BTN_SECONDARY} onClick={() => responder('reenviar')}><Icon name="send" class="size-4" />Reenviar</button>
            <button class={BTN_SECONDARY} onClick={() => accion(abierto.item, abierto.item.destacado ? 'quitar_destacado' : 'destacar')}><Icon name="star" class="size-4 text-amber-600" />{abierto.item.destacado ? 'Quitar destacado' : 'Destacar'}</button>
            <button class={BTN_SECONDARY} onClick={() => accion(abierto.item, abierto.item.archivado ? 'desarchivar' : 'archivar')}><Icon name="archive" class="size-4 text-emerald-600" />{abierto.item.archivado ? 'Desarchivar' : 'Archivar'}</button>
            <button class={BTN_SECONDARY} onClick={() => accion(abierto.item, abierto.item.papelera ? 'restaurar' : 'papelera')}><Icon name="trash" class="size-4 text-rose-600" />{abierto.item.papelera ? 'Restaurar' : 'Papelera'}</button>
            {abierto.item.carpeta === 'recibidos' && <button class={BTN_SECONDARY} onClick={() => accion(abierto.item, 'no_leido')}><Icon name="mail" class="size-4" />Marcar no leído</button>}
          </div>
        </div>
      </Card> :
      <Card>
        <div class="flex flex-wrap gap-2 mb-4">
          <div class="relative w-full max-w-sm"><Icon name="search" class="pointer-events-none absolute left-3 top-3 size-5 text-slate-400" /><input class={`${FIELD} pl-10`} aria-label="Buscar mensajes" placeholder="Buscar por asunto, mensaje o persona" value={q} onInput={(e) => { setQ(e.currentTarget.value); setPagina(0) }} /></div>
          {carpeta !== 'borradores' && <select class={`${FIELD} max-w-48`} aria-label="Filtrar mensajes" value={filtro} onChange={(e) => { setFiltro(e.currentTarget.value); setPagina(0) }}><option value="">Todos</option><option value="no_leidos">No leídos</option><option value="adjuntos">Con adjuntos</option></select>}
        </div>
        {loading ? <Spinner /> : <>
          {carpeta === 'borradores' ? <div class="divide-y divide-slate-100">{borradores.map((d) => <button key={d.id} class="block w-full px-3 py-3 text-left hover:bg-slate-50" onClick={async () => { try { const miBuzon = user?.role === 'distrital' ? 'jd3' : user?.id; setExtra(d.respuesta_a ? (await rpc<Destino[]>('correo_participantes', { p_id: d.respuesta_a })).filter((p) => p.buzon !== miBuzon) : []); setEscribir(d) } catch (e) { avisar(e) } }}><strong>{d.asunto || '(Sin asunto)'}</strong><span class="block text-xs text-slate-500">{d.actualizado_en && fecha(d.actualizado_en)}</span></button>)}</div> :
            <div class="divide-y divide-slate-100">{filas.map((m) => <button key={`${m.id}-${m.carpeta}`} onClick={() => ver(m)} class={`flex w-full gap-3 px-3 py-4 text-left hover:bg-slate-50 ${!m.leido ? 'bg-sky-50' : ''}`}><span class={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${!m.leido ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}><Icon name={m.leido ? 'mail' : 'inbox'} class="size-4" /></span><span class="min-w-0 flex-1"><span class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"><span class={`min-w-0 truncate text-slate-900 ${!m.leido ? 'font-bold' : 'font-medium'}`}>{m.autor}</span><span class="shrink-0 text-xs text-slate-500">{fecha(m.fecha)}</span></span><span class={`mt-0.5 flex items-center gap-1 text-sm text-slate-900 ${!m.leido ? 'font-semibold' : ''}`}>{m.destacado && <Icon name="star" class="size-4 shrink-0 text-amber-600" />}<span class="truncate">{m.asunto}</span></span><span class="mt-1 block truncate text-xs text-slate-500">{m.cuerpo}{m.adjuntos ? ` · ${m.adjuntos} adjunto(s)` : ''}</span></span></button>)}</div>}
          {total === 0 && <div class="flex flex-col items-center gap-2 py-10 text-center text-sm text-slate-500"><span class="rounded-full bg-sky-50 p-3 text-sky-600"><Icon name="inbox" class="size-6" /></span><p>No hay mensajes para mostrar.</p></div>}
          <div class="mt-4 flex items-center justify-between gap-3 text-sm"><button class={BTN_SECONDARY} disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button><span>{total ? `${pagina * 20 + 1}–${Math.min((pagina + 1) * 20, total)} de ${total}` : 'Sin resultados'}</span><button class={BTN_SECONDARY} disabled={(pagina + 1) * 20 >= total} onClick={() => setPagina(pagina + 1)}>Siguiente</button></div>
        </>}
      </Card>}
  </>
}

function Redactar({ inicial, destinos, extra, onClose, onSent, descarga }: { inicial: Borrador; destinos: Destino[]; extra: Destino[]; onClose(): void; onSent(): void; descarga(a: Adjunto): void }) {
  const [f, setF] = useState(inicial)
  const [archivos, setArchivos] = useState<Adjunto[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const disponibles = [...new Map([...destinos, ...extra].map((d) => [d.buzon, d])).values()]
  useEffect(() => {
    if (f.id) rpc<Adjunto[]>('correo_adjuntos_borrador', { p_id: f.id }).then(setArchivos).catch((e) => setError(e.message))
  }, [f.id])
  const guardar = async () => {
    const id = await rpc<number>('correo_guardar_borrador', { p_id: f.id, p_asunto: f.asunto, p_cuerpo: f.cuerpo, p_destinatarios: f.destinatarios, p_respuesta_a: f.respuesta_a })
    setF((actual) => ({ ...actual, id }))
    return id
  }

  const subir = async (files: File[]) => {
    if (!files.length) return
    setBusy(true); setError('')
    try {
      for (const file of files) if (!file.size || file.size > 5 * 1024 * 1024) throw new Error(`El archivo ${file.name} está vacío o supera los 5 MB.`)
      const id = await guardar()
      for (const file of files) {
        const form = new FormData(); form.append('borrador', String(id)); form.append('file', file)
        const { error: err } = await supabase.functions.invoke('correo-drive', { body: form })
        if (err) throw err
        setArchivos(await rpc<Adjunto[]>('correo_adjuntos_borrador', { p_id: id }))
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const enviar = async (e: Event) => {
    e.preventDefault(); setBusy(true); setError('')
    try { const id = await guardar(); await rpc('correo_enviar', { p_borrador: id }); toast.ok('Mensaje enviado'); onSent() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  const quitar = async (a: Adjunto) => {
    const { data, error: err } = await supabase.functions.invoke('correo-drive', { body: { action: 'remove', id: a.id } })
    if (err) throw err
    if (data?.warning) toast.info(data.warning)
    if (f.id) setArchivos(await rpc<Adjunto[]>('correo_adjuntos_borrador', { p_id: f.id }))
  }
  const descartar = async () => {
    if (!await confirmar('¿Descartar el borrador?', { text: 'Se quitarán sus adjuntos y el mensaje no se enviará.', danger: true, ok: 'Descartar' })) return
    setBusy(true); setError('')
    try {
      for (const a of archivos) await quitar(a)
      if (f.id) await rpc('correo_eliminar_borrador', { p_id: f.id })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (f.id) setArchivos(await rpc<Adjunto[]>('correo_adjuntos_borrador', { p_id: f.id }))
    } finally { setBusy(false) }
  }
  return <Card title="Redactar mensaje">
    <form class="space-y-4" onSubmit={enviar}>
      {error && <Alert tone="error">{error}</Alert>}
      <SelectorDestinatarios disponibles={disponibles} seleccionados={f.destinatarios} onChange={(destinatarios) => setF({ ...f, destinatarios })} />
      <Lbl label="Asunto"><input class={FIELD} required maxLength={150} value={f.asunto} onInput={(e) => setF({ ...f, asunto: e.currentTarget.value })} /></Lbl>
      <Lbl label="Mensaje"><textarea class={`${FIELD} py-2`} rows={10} required maxLength={20000} value={f.cuerpo} onInput={(e) => setF({ ...f, cuerpo: e.currentTarget.value })} /></Lbl>
      <Lbl label="Adjuntos (hasta 5 MB por archivo)"><input class={`${FIELD} py-2`} type="file" multiple disabled={busy} onChange={(e) => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; void subir(files) }} /></Lbl>
      <div class="flex flex-wrap gap-2">{archivos.map((a) => <span key={a.id} class="flex gap-1"><button type="button" class={BTN_SECONDARY} onClick={() => descarga(a)}>{a.nombre} ({(a.bytes / 1048576).toFixed(2)} MB)</button><button type="button" aria-label={`Quitar ${a.nombre}`} class={BTN_SECONDARY} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await quitar(a) } catch (err) { setError(err instanceof Error ? err.message : String(err)); if (f.id) setArchivos(await rpc<Adjunto[]>('correo_adjuntos_borrador', { p_id: f.id })) } finally { setBusy(false) } }}>×</button></span>)}</div>
      <div class="flex flex-wrap justify-end gap-2"><button type="button" class={BTN_DANGER} disabled={busy} onClick={descartar}>Descartar</button><button type="button" class={BTN_SECONDARY} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { if (f.id || f.asunto || f.cuerpo || f.destinatarios.length) await guardar(); onClose() } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }}>Guardar y cerrar</button><button type="button" class={BTN_SECONDARY} disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await guardar(); toast.ok('Borrador guardado') } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }}>Guardar borrador</button><button class={BTN_PRIMARY} disabled={busy}>{busy ? 'Procesando…' : 'Enviar'}</button></div>
    </form>
  </Card>
}

function SelectorDestinatarios({ disponibles, seleccionados, onChange }: { disponibles: Destino[]; seleccionados: string[]; onChange(v: string[]): void }) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const contenedor = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => { if (e.target instanceof Node && !contenedor.current?.contains(e.target)) setAbierto(false) }
    const teclado = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAbierto(false); boton.current?.focus() } }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', teclado)
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', teclado) }
  }, [abierto])
  const filtrados = disponibles.filter((d) => d.nombre.toLocaleLowerCase('es-AR').includes(busqueda.trim().toLocaleLowerCase('es-AR')))
  const nombres = seleccionados.map((id) => disponibles.find((d) => d.buzon === id)?.nombre ?? id)
  return <div ref={contenedor} class="relative">
    <span id="correo-destinatarios-label" class="mb-1 block text-sm font-medium text-slate-700">Destinatarios</span>
    <button ref={boton} type="button" aria-labelledby="correo-destinatarios-label correo-destinatarios-resumen" aria-expanded={abierto} aria-controls="correo-destinatarios-opciones"
      class={`${FIELD} flex items-center gap-2 text-left`} onClick={() => setAbierto(!abierto)}>
      <Icon name="users" class="size-5 shrink-0 text-sky-600" />
      <span id="correo-destinatarios-resumen" class="min-w-0 flex-1 truncate">{nombres.length ? `${nombres.length} seleccionado(s): ${nombres.join(', ')}` : 'Seleccionar destinatarios'}</span>
      <Icon name="chevr" class={`size-4 shrink-0 text-slate-500 transition-transform ${abierto ? '-rotate-90' : 'rotate-90'}`} />
    </button>
    {abierto && <div id="correo-destinatarios-opciones" class="absolute left-0 right-0 z-30 mt-1 rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
      <div class="relative"><Icon name="search" class="pointer-events-none absolute left-3 top-3 size-5 text-slate-400" /><input autoFocus class={`${FIELD} pl-10`} aria-label="Buscar destinatarios" placeholder="Buscar por nombre" value={busqueda} onInput={(e) => setBusqueda(e.currentTarget.value)} /></div>
      <div class="mt-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-2 text-xs">
        <span class="text-slate-500">{seleccionados.length} seleccionado(s)</span>
        <div class="flex gap-3"><button type="button" class="font-semibold text-sky-700 hover:underline" onClick={() => onChange([...new Set([...seleccionados, ...disponibles.map((d) => d.buzon)])])}>Seleccionar todos</button><button type="button" class="font-semibold text-slate-600 hover:underline" onClick={() => onChange([])}>Limpiar</button></div>
      </div>
      <div class="mt-1 max-h-56 overflow-y-auto" role="group" aria-label="Opciones de destinatarios">
        {filtrados.map((d) => <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm text-slate-700 hover:bg-slate-50" key={d.buzon}><input type="checkbox" class="size-4 accent-sky-600" checked={seleccionados.includes(d.buzon)} onChange={(e) => onChange(e.currentTarget.checked ? [...seleccionados, d.buzon] : seleccionados.filter((v) => v !== d.buzon))} />{d.nombre}</label>)}
        {!filtrados.length && <p class="px-2 py-4 text-sm text-slate-500">No se encontraron destinatarios.</p>}
      </div>
    </div>}
  </div>
}
