import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { contactosChat, enviarChat, historialChat, leerChat, type ContactoChat, type MensajeChat } from '../lib/chatDistrital'
import { supabase } from '../lib/supabase'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, FIELD } from './kit'
import { Icon } from './Icon'

const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
const limitar = (n: number, max: number) => Math.max(8, Math.min(n, Math.max(8, max - 64)))

export function ChatDistrital({ userId }: { userId: string }) {
  const [abierto, setAbierto] = useState(false)
  const [contactoId, setContactoId] = useState<string | null>(null)
  const [contactos, setContactos] = useState<ContactoChat[]>([])
  const [mensajes, setMensajes] = useState<MensajeChat[]>([])
  const [hayMas, setHayMas] = useState(false)
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState('')
  const [errorContactos, setErrorContactos] = useState('')
  const [sonidoListo, setSonidoListo] = useState(false)
  const [posicion, setPosicion] = useState(() => ({ x: Math.max(8, innerWidth - 68), y: Math.max(8, innerHeight - 100) }))
  const sonido = useRef<AudioContext | null>(null)
  const cursor = useRef<Map<string, number> | null>(null)
  const vigente = useRef(true)
  const abiertoRef = useRef(abierto)
  const contactoRef = useRef(contactoId)
  const generacion = useRef(0)
  const historialSolicitud = useRef(0)
  const inicialHistorial = useRef(true)
  const solicitudes = useRef(0)
  const pendiente = useRef<{ texto: string; contacto: string; id: string } | null>(null)
  const arrastre = useRef<{ x: number; y: number; origenX: number; origenY: number; movido: boolean } | null>(null)
  const suprimirClick = useRef(false)
  const lista = useRef<HTMLDivElement>(null)
  const seguir = useRef(true)
  abiertoRef.current = abierto
  contactoRef.current = contactoId

  const activarSonido = useCallback(async () => {
    try {
      if (!sonido.current) sonido.current = new AudioContext()
      if (sonido.current.state !== 'running') await sonido.current.resume()
      if (vigente.current) setSonidoListo(sonido.current.state === 'running')
    } catch (e) {
      console.error('No se pudo activar el sonido del chat:', e)
      if (vigente.current) setSonidoListo(false)
    }
  }, [])
  const sonar = useCallback(() => {
    const ctx = sonido.current
    if (!ctx || ctx.state !== 'running') return
    for (const [frecuencia, inicio] of [[880, 0], [1175, 0.13]]) {
      const oscilador = ctx.createOscillator(), volumen = ctx.createGain()
      oscilador.type = 'sine'; oscilador.frequency.value = frecuencia
      volumen.gain.setValueAtTime(0.0001, ctx.currentTime + inicio)
      volumen.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + inicio + 0.01)
      volumen.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + 0.12)
      oscilador.connect(volumen); volumen.connect(ctx.destination)
      oscilador.start(ctx.currentTime + inicio); oscilador.stop(ctx.currentTime + inicio + 0.13)
    }
  }, [])
  const cargarContactos = useCallback(async () => {
    const llamada = ++solicitudes.current
    try {
      const datos = await contactosChat()
      if (!vigente.current || llamada !== solicitudes.current) return
      const nuevos = new Map(datos.map((c) => [c.id, Number(c.ultimo_recibido ?? 0)]))
      if (cursor.current && datos.some((c) => Number(c.ultimo_recibido ?? 0) > (cursor.current?.get(c.id) ?? 0))) sonar()
      cursor.current = nuevos
      setContactos(datos); setErrorContactos('')
    } catch (e) {
      if (vigente.current && llamada === solicitudes.current) setErrorContactos(`No se pudo actualizar el chat: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [sonar])
  const cargarHistorial = useCallback(async (id: string, reemplazar = false) => {
    const version = generacion.current
    const llamada = ++historialSolicitud.current
    try {
      const filas = await historialChat(id)
      if (!vigente.current || version !== generacion.current || llamada !== historialSolicitud.current || contactoRef.current !== id) return
      const pagina = filas.slice(0, 50).reverse()
      setMensajes((actual) => {
        if (reemplazar || !actual.length) return pagina
        const todos = new Map(actual.map((m) => [m.id, m]))
        pagina.forEach((m) => todos.set(m.id, m))
        return [...todos.values()].sort((a, b) => a.id - b.id)
      })
      if (inicialHistorial.current) { setHayMas(filas.length > 50); inicialHistorial.current = false }
      const ultimo = pagina.filter((m) => m.autor_id === id && !m.leido_en).at(-1)
      if (ultimo && abiertoRef.current && document.visibilityState === 'visible' && document.hasFocus()) {
        await leerChat(id, ultimo.id)
        if (vigente.current && version === generacion.current) void cargarContactos()
      }
    } catch (e) {
      if (vigente.current && version === generacion.current && llamada === historialSolicitud.current) setError(`No se pudo cargar la conversación: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [cargarContactos])

  useEffect(() => {
    vigente.current = true
    const activar = () => { void activarSonido() }
    const actualizar = () => {
      void cargarContactos()
      if (abiertoRef.current && contactoRef.current) void cargarHistorial(contactoRef.current)
    }
    addEventListener('pointerdown', activar, { once: true })
    addEventListener('keydown', activar, { once: true })
    addEventListener('focus', actualizar)
    document.addEventListener('visibilitychange', actualizar)
    const canal = supabase.channel(`chat-distrital-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_distrital_mensajes', filter: `destinatario_id=eq.${userId}` }, actualizar)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_distrital_mensajes', filter: `autor_id=eq.${userId}` }, actualizar)
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') actualizar()
        if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') console.error('Conexión en tiempo real del chat interrumpida; se usará la actualización periódica.', estado)
      })
    actualizar()
    const intervalo = setInterval(actualizar, 10000)
    return () => {
      vigente.current = false; generacion.current++; solicitudes.current++
      removeEventListener('pointerdown', activar); removeEventListener('keydown', activar); removeEventListener('focus', actualizar)
      document.removeEventListener('visibilitychange', actualizar)
      clearInterval(intervalo); void supabase.removeChannel(canal)
      if (sonido.current) void sonido.current.close().catch((e) => console.error('No se pudo cerrar el sonido del chat:', e))
      sonido.current = null
    }
  }, [userId, activarSonido, cargarContactos, cargarHistorial])

  useEffect(() => {
    const resize = () => setPosicion((p) => ({ x: limitar(p.x, innerWidth), y: limitar(p.y, innerHeight) }))
    addEventListener('resize', resize)
    return () => removeEventListener('resize', resize)
  }, [])
  useLayoutEffect(() => {
    if (lista.current && seguir.current) lista.current.scrollTop = lista.current.scrollHeight
  }, [mensajes, abierto])

  const elegir = (id: string) => {
    generacion.current++
    seguir.current = true
    inicialHistorial.current = true
    contactoRef.current = id
    setContactoId(id); setMensajes([]); setHayMas(false); setTexto(''); pendiente.current = null; setError('')
    void cargarHistorial(id, true)
  }
  const abrir = () => {
    void activarSonido()
    setAbierto((v) => {
      abiertoRef.current = !v
      if (!v && contactoRef.current) void cargarHistorial(contactoRef.current)
      return !v
    })
  }
  const mas = async () => {
    const id = contactoId, antes = mensajes[0]?.id, version = generacion.current
    if (!id || !antes || cargandoMas) return
    setCargandoMas(true)
    seguir.current = false
    const altura = lista.current?.scrollHeight ?? 0
    try {
      const filas = await historialChat(id, antes)
      if (!vigente.current || version !== generacion.current) return
      const pagina = filas.slice(0, 50).reverse()
      setMensajes((actual) => [...pagina, ...actual])
      setHayMas(filas.length > 50)
      requestAnimationFrame(() => { if (lista.current && version === generacion.current) lista.current.scrollTop += lista.current.scrollHeight - altura })
    } catch (e) { if (vigente.current && version === generacion.current) setError(`No se pudieron cargar mensajes anteriores: ${e instanceof Error ? e.message : String(e)}`) }
    finally { if (vigente.current) setCargandoMas(false) }
  }
  const enviar = async (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault()
    const id = contactoId, contenido = texto.trim()
    if (!id || !contenido || ocupado) return
    if (!pendiente.current || pendiente.current.texto !== contenido || pendiente.current.contacto !== id) pendiente.current = { texto: contenido, contacto: id, id: crypto.randomUUID() }
    setOcupado(true); setError('')
    try {
      await enviarChat(id, contenido, pendiente.current.id)
      pendiente.current = null
      if (contactoRef.current === id) { seguir.current = true; setTexto(''); await cargarHistorial(id) }
      void cargarContactos()
    } catch (e) { setError(`No se pudo enviar el mensaje: ${e instanceof Error ? e.message : String(e)}. Podés reintentar.`) }
    finally { if (vigente.current) setOcupado(false) }
  }
  const total = contactos.reduce((n, c) => n + Number(c.no_leidos), 0)
  const contacto = contactos.find((c) => c.id === contactoId)
  const etiqueta = total ? `Chat distrital, ${total} mensajes sin leer` : 'Chat distrital'
  const contador = total > 0 && <span class="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-bold leading-5 text-white" aria-hidden="true">{total > 99 ? '99+' : total}</span>
  const seleccionar = contactos.filter((c) => c.nombre.toLocaleLowerCase('es-AR').includes(busqueda.trim().toLocaleLowerCase('es-AR')))

  return <>
    <button type="button" class="fixed bottom-2 right-3 z-40 hidden min-h-11 items-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white shadow-lg hover:bg-sky-800 lg:flex"
      aria-label={etiqueta} aria-expanded={abierto} onClick={abrir}><span class="relative"><Icon name="chat" />{contador}</span> Chat distrital</button>
    <button type="button" class="fixed z-40 flex size-14 touch-none items-center justify-center rounded-full bg-sky-700 text-white shadow-xl lg:hidden"
      style={{ left: `${posicion.x}px`, top: `${posicion.y}px` }} aria-label={`${etiqueta}. Arrastrá para mover`} aria-expanded={abierto}
      onPointerDown={(e) => { suprimirClick.current = false; arrastre.current = { x: e.clientX, y: e.clientY, origenX: posicion.x, origenY: posicion.y, movido: false }; e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={(e) => {
        const a = arrastre.current
        if (!a) return
        const dx = e.clientX - a.x, dy = e.clientY - a.y
        if (Math.abs(dx) + Math.abs(dy) > 5) a.movido = true
        if (a.movido) setPosicion({ x: limitar(a.origenX + dx, innerWidth), y: limitar(a.origenY + dy, innerHeight) })
      }}
      onPointerUp={() => { suprimirClick.current = !!arrastre.current?.movido; arrastre.current = null }}
      onPointerCancel={() => { arrastre.current = null; suprimirClick.current = true }}
      onKeyDown={(e) => {
        const cambio: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }
        const v = cambio[e.key]
        if (v) { e.preventDefault(); setPosicion((p) => ({ x: limitar(p.x + v[0], innerWidth), y: limitar(p.y + v[1], innerHeight) })) }
      }}
      onClick={() => { if (suprimirClick.current) { suprimirClick.current = false; return } abrir() }}><span class="relative"><Icon name="chat" class="size-6" />{contador}</span></button>

    {abierto && <section aria-label="Chat distrital" class="fixed bottom-2 right-2 z-50 flex h-[min(34rem,80dvh)] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl lg:bottom-16 lg:right-3">
      <header class="flex shrink-0 items-center gap-2 bg-sky-700 px-3 py-2 text-white">
        {contactoId && <button type="button" class="flex size-10 items-center justify-center rounded hover:bg-sky-800" aria-label="Volver a contactos" onClick={() => { generacion.current++; contactoRef.current = null; setContactoId(null); setMensajes([]); setTexto(''); pendiente.current = null }}><Icon name="chevl" /></button>}
        <div class="min-w-0 flex-1"><h2 class="truncate text-sm font-semibold">{contacto?.nombre ?? 'Chat distrital'}</h2><p class="text-xs text-sky-100">{contactoId ? 'Conversación privada' : 'Conversaciones individuales'}</p></div>
        <button type="button" class="flex size-10 items-center justify-center rounded hover:bg-sky-800" aria-label="Cerrar chat" onClick={() => setAbierto(false)}><Icon name="x" /></button>
      </header>
      {(error || errorContactos) && <div class="shrink-0 p-2"><Alert tone="error">{error || errorContactos}</Alert><button type="button" class="mt-1 text-sm text-sky-700 underline" onClick={() => { setError(''); void cargarContactos(); if (contactoId) void cargarHistorial(contactoId) }}>Reintentar</button></div>}
      {!sonidoListo && <button type="button" class="shrink-0 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900" onClick={() => void activarSonido()}>Activar sonido de mensajes en este navegador</button>}
      {!contactoId ? <>
        <div class="shrink-0 p-3"><input type="search" class={FIELD} placeholder="Buscar usuario distrital" aria-label="Buscar usuario distrital" value={busqueda} onInput={(e) => setBusqueda(e.currentTarget.value)} /></div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          {!seleccionar.length && <p class="p-4 text-sm text-slate-500">No hay contactos disponibles.</p>}
          {seleccionar.map((c) => <button key={c.id} type="button" class="flex min-h-14 w-full items-center gap-3 border-t border-slate-100 px-3 py-2 text-left hover:bg-slate-50" onClick={() => elegir(c.id)}>
            <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-800">{c.nombre.slice(0, 1).toUpperCase()}</span>
            <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-slate-900">{c.nombre}</span>{!c.activo && <span class="text-xs text-slate-500">Cuenta inactiva</span>}</span>
            {Number(c.no_leidos) > 0 && <span class="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${c.no_leidos} sin leer`}>{c.no_leidos}</span>}
          </button>)}
        </div>
      </> : <>
        <div ref={lista} class="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3" aria-live="polite" onScroll={(e) => { const el = e.currentTarget; seguir.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
          {hayMas && <button type="button" class={`${BTN_SECONDARY} w-full`} disabled={cargandoMas} onClick={() => void mas()}>{cargandoMas ? 'Cargando…' : 'Ver mensajes anteriores'}</button>}
          {!mensajes.length && <p class="py-6 text-center text-sm text-slate-500">Todavía no hay mensajes. Iniciá la conversación.</p>}
          {mensajes.map((m) => <div key={m.id} class={`flex ${m.autor_id === userId ? 'justify-end' : 'justify-start'}`}>
            <div class={`max-w-[85%] rounded-xl px-3 py-2 ${m.autor_id === userId ? 'bg-sky-100 text-slate-900' : 'border border-slate-200 bg-white text-slate-900'}`}>
              <p class="whitespace-pre-wrap break-words text-sm">{m.texto}</p><p class="mt-1 text-right text-[11px] text-slate-500">{fecha(m.creado_en)}</p>
            </div>
          </div>)}
        </div>
        <form class="flex shrink-0 items-end gap-2 border-t border-slate-200 p-2" onSubmit={(e) => void enviar(e)}>
          <textarea class={`${FIELD} max-h-28 min-h-11 resize-y py-2`} rows={1} placeholder="Escribí un mensaje" aria-label="Mensaje del chat" maxLength={4000} value={texto} disabled={!contacto?.activo || ocupado} onInput={(e) => setTexto(e.currentTarget.value)} />
          <button type="submit" class={BTN_PRIMARY} disabled={!contacto?.activo || ocupado || !texto.trim()} aria-label="Enviar mensaje"><Icon name="send" /></button>
        </form>
        {!contacto?.activo && <p class="px-3 pb-2 text-xs text-slate-500">Este contacto ya no está disponible para recibir mensajes.</p>}
      </>}
    </section>}
  </>
}
