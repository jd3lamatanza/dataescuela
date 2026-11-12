import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Profile } from '../lib/auth'
import { Icon } from './Icon'
import { limitarPosicionAviso, type PosicionAviso } from './posicionAviso'

export function AvisoSimulado({ user, onVolver }: { user: Profile; onVolver(): void }) {
  const aviso = useRef<HTMLDivElement>(null)
  const arrastre = useRef<{ id: number; x: number; y: number; inicio: PosicionAviso } | null>(null)
  const [posicion, setPosicion] = useState<PosicionAviso | null>(null)

  const limitar = (p: PosicionAviso) => {
    const rect = aviso.current?.getBoundingClientRect()
    return rect ? limitarPosicionAviso(p, rect.width, rect.height, window.innerWidth, window.innerHeight) : p
  }

  useLayoutEffect(() => {
    const ajustar = () => setPosicion((actual) => {
      if (!actual) return null
      const nueva = limitar(actual)
      return nueva.x === actual.x && nueva.y === actual.y ? actual : nueva
    })
    window.addEventListener('resize', ajustar)
    const observer = new ResizeObserver(ajustar)
    if (aviso.current) observer.observe(aviso.current)
    return () => { window.removeEventListener('resize', ajustar); observer.disconnect() }
  }, [])

  return <div ref={aviso} role="status" aria-label="Ingreso simulado"
    class="fixed z-[60] flex max-h-[calc(100dvh-1rem)] w-max max-w-[calc(100vw-1rem)] items-center gap-2 overflow-auto rounded-lg bg-amber-400 p-2 text-sm font-medium text-amber-950 shadow-lg ring-1 ring-amber-600/40 sm:max-w-md"
    style={posicion ? { left: posicion.x, top: posicion.y } : { right: 8, bottom: 16 }}>
    <button type="button" aria-label="Mover aviso de ingreso simulado" aria-describedby="ayuda-mover-aviso" title="Arrastrá para mover el aviso; también podés usar las flechas del teclado"
      class="flex min-h-11 min-w-11 shrink-0 touch-none cursor-grab flex-col items-center justify-center rounded-md hover:bg-amber-500 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-950"
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0 || !aviso.current) return
        const rect = aviso.current.getBoundingClientRect()
        arrastre.current = { id: e.pointerId, x: e.clientX, y: e.clientY, inicio: { x: rect.left, y: rect.top } }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const a = arrastre.current
        if (a?.id === e.pointerId) setPosicion(limitar({ x: a.inicio.x + e.clientX - a.x, y: a.inicio.y + e.clientY - a.y }))
      }}
      onPointerUp={(e) => { if (arrastre.current?.id === e.pointerId) arrastre.current = null }}
      onPointerCancel={(e) => { if (arrastre.current?.id === e.pointerId) arrastre.current = null }}
      onLostPointerCapture={() => { arrastre.current = null }}
      onKeyDown={(e) => {
        const paso = e.shiftKey ? 80 : 20
        const delta: Record<string, PosicionAviso> = { ArrowLeft: { x: -paso, y: 0 }, ArrowRight: { x: paso, y: 0 }, ArrowUp: { x: 0, y: -paso }, ArrowDown: { x: 0, y: paso } }
        const movimiento = delta[e.key]
        if (!movimiento || !aviso.current) return
        e.preventDefault()
        const rect = aviso.current.getBoundingClientRect()
        setPosicion(limitar({ x: rect.left + movimiento.x, y: rect.top + movimiento.y }))
      }}>
      <Icon name="drag" class="size-5" />
      <span class="text-[10px] leading-3">Mover</span>
    </button>
    <span id="ayuda-mover-aviso" class="sr-only">Arrastrá el control o usá las flechas del teclado para mover el aviso.</span>
    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span class="min-w-0 break-words">Ingreso simulado como <strong>{user.name}</strong> (sesión de {user.simulador})</span>
      <button type="button" class="rounded bg-amber-950 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-900" onClick={onVolver}>Volver a mi cuenta</button>
    </div>
  </div>
}
