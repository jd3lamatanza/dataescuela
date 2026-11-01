import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Icon, type IconKey as IconName } from './Icon'

export const FIELD = 'block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 disabled:bg-slate-100 disabled:text-slate-500'
export const BTN_PRIMARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-gradient-to-b from-cyan-500 to-sky-600 px-4 text-sm font-semibold text-white shadow-sm hover:from-cyan-600 hover:to-sky-700 disabled:opacity-50'
export const BTN_SECONDARY = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50'
export const BTN_DANGER = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50'

export const Card = ({ title, action, class: cls = '', children }: { title?: string; action?: ComponentChildren; class?: string; children?: ComponentChildren }) => (
  <section class={`rounded-lg border border-slate-200 bg-white shadow-sm ${cls}`}>
    {(title || action) && (
      <header class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        {title && <h2 class="text-sm font-semibold text-slate-900">{title}</h2>}
        {action}
      </header>
    )}
    <div class="p-4">{children}</div>
  </section>
)

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ComponentChildren }) => (
  <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
      {subtitle && <p class="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
    {actions && <div class="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
)

const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
}
export const Badge = ({ tone = 'slate', children }: { tone?: keyof typeof TONES; children?: ComponentChildren }) => (
  <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TONES[tone]}`}>{children}</span>
)

export const EmptyState = ({ title, text }: { title: string; text?: string }) => (
  <div class="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
    <p class="text-sm font-medium text-slate-700">{title}</p>
    {text && <p class="mt-1 text-sm text-slate-500">{text}</p>}
  </div>
)

export const Alert = ({ tone = 'info', children }: { tone?: 'error' | 'info' | 'success' | 'warning'; children?: ComponentChildren }) => {
  const c = { error: 'border-red-200 bg-red-50 text-red-800', info: 'border-sky-200 bg-sky-50 text-sky-800', success: 'border-emerald-200 bg-emerald-50 text-emerald-800', warning: 'border-amber-200 bg-amber-50 text-amber-800' }[tone]
  return <div role="alert" class={`rounded-md border px-3 py-2 text-sm ${c}`}>{children}</div>
}

export const Lbl = ({ label, children }: { label: string; children?: ComponentChildren }) => (
  <label class="block text-sm font-medium text-slate-700">
    <span class="mb-1 block">{label}</span>
    {children}
  </label>
)

export const Spinner = () => (
  <div class="flex justify-center py-10"><div class="size-7 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600" /></div>
)

export const Modal = ({ title, onClose, children, wide }: { title: string; onClose(): void; children?: ComponentChildren; wide?: boolean }) => {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])
  return (
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl sm:rounded-xl ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`} role="dialog" aria-modal="true" aria-label={title}>
        <header class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 class="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" class="flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><Icon name="x" class="size-5" /></button>
        </header>
        <div class="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

/* ---- Toasts y confirmaciones: API imperativa (toast.ok(...), await confirmar(...)) ---- */
type T = { id: number; tone: 'success' | 'error' | 'info'; text: string }
let toasts: T[] = []
let setToasts: ((t: T[]) => void) | null = null
const push = (tone: T['tone'], text: string) => {
  const t = { id: Date.now() + Math.random(), tone, text }
  toasts = [...toasts, t]
  setToasts?.(toasts)
  setTimeout(() => { toasts = toasts.filter((x) => x !== t); setToasts?.(toasts) }, 4500)
}
export const toast = { ok: (m: string) => push('success', m), error: (m: string) => push('error', m), info: (m: string) => push('info', m) }

type Ask = { title: string; text?: string; ok: string; danger: boolean; resolve(v: boolean): void }
let setAsk: ((a: Ask | null) => void) | null = null
export const confirmar = (title: string, opts: { text?: string; ok?: string; danger?: boolean } = {}) =>
  new Promise<boolean>((resolve) => setAsk?.({ title, text: opts.text, ok: opts.ok ?? 'Confirmar', danger: opts.danger ?? false, resolve }))

export function Overlays() {
  const [list, setList] = useState<T[]>([])
  const [ask, setAskState] = useState<Ask | null>(null)
  useEffect(() => { setToasts = setList; setAsk = setAskState; return () => { setToasts = null; setAsk = null } }, [])
  const tone = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-slate-800' }
  return (
    <>
      <div class="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 p-3 sm:items-end" aria-live="polite">
        {list.map((t) => <div key={t.id} class={`pointer-events-auto max-w-sm rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${tone[t.tone]}`}>{t.text}</div>)}
      </div>
      {ask && (
        <Modal title={ask.title} onClose={() => { ask.resolve(false); setAskState(null) }}>
          {ask.text && <p class="whitespace-pre-line text-sm text-slate-600">{ask.text}</p>}
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class={BTN_SECONDARY} onClick={() => { ask.resolve(false); setAskState(null) }}>Cancelar</button>
            <button type="button" class={ask.danger ? BTN_DANGER : BTN_PRIMARY} onClick={() => { ask.resolve(true); setAskState(null) }}>{ask.ok}</button>
          </div>
        </Modal>
      )}
    </>
  )
}

/** Menú contextual de fila (⋮). Los ítems con `sep` dibujan un separador antes. */
export interface MenuItem { label: string; onClick(): void; danger?: boolean; sep?: boolean; hidden?: boolean; icon?: IconName }

// Ícono por defecto según el texto de la opción (se puede forzar con `icon`)
const ICONOS: [RegExp, IconName][] = [
  [/eliminar|borrar/i, 'trash'], [/restablecer|contraseña/i, 'key'], [/duplicar|copiar/i, 'copy'], [/mover/i, 'move'],
  [/desbloquear/i, 'unlock'], [/bloquear|bloqueado/i, 'lock'], [/desactivar/i, 'ban'], [/activar/i, 'power'],
  [/descargar|excel|pdf/i, 'download'], [/editar|modificar/i, 'edit'], [/ver intervenciones|ver carga|^ver\b/i, 'eye'],
  [/intervenci[oó]n|nota/i, 'note'], [/fuera de/i, 'external'], [/confirmar|destino/i, 'check'], [/ficha|equipo|referentes/i, 'clipboard'],
]
const iconoDe = (i: MenuItem): IconName => i.icon ?? ICONOS.find(([r]) => r.test(i.label))?.[1] ?? 'list'
export function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const c = () => setOpen(false)
    addEventListener('click', c)
    return () => removeEventListener('click', c)
  }, [open])
  return (
    <div class="relative">
      <button type="button" aria-label="Acciones" onClick={(e) => { e.stopPropagation(); setOpen(!open) }} class="flex size-10 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><Icon name="dots" class="size-5" /></button>
      {open && (
        <div class="absolute right-0 z-40 mt-1 w-60 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {items.filter((i) => !i.hidden).map((i) => (
            <>
              {i.sep && <div class="my-1 border-t border-slate-100" />}
              <button type="button" onClick={() => { setOpen(false); i.onClick() }} class={`flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-slate-50 ${i.danger ? 'text-red-600' : 'text-slate-700'}`}><Icon name={iconoDe(i)} class={`size-4 shrink-0 ${i.danger ? 'text-red-500' : 'text-slate-500'}`} />{i.label}</button>
            </>
          ))}
        </div>
      )}
    </div>
  )
}

export const Toggle = ({ checked, onChange, label, disabled }: { checked: boolean; onChange(v: boolean): void; label?: string; disabled?: boolean }) => (
  <label class="inline-flex items-center gap-2 text-sm text-slate-700">
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      class={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-sky-600' : 'bg-slate-300'} disabled:opacity-50`}>
      <span class={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
    {label}
  </label>
)

export const PAGE_SIZE = 15
export function Pager({ page, total, size = PAGE_SIZE, onPage }: { page: number; total: number; size?: number; onPage(p: number): void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (pages <= 1) return null
  return (
    <div class="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>{total} registros · página {page} de {pages}</span>
      <div class="flex gap-2">
        <button type="button" class={BTN_SECONDARY} disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
        <button type="button" class={BTN_SECONDARY} disabled={page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button>
      </div>
    </div>
  )
}

const TAB_COLOR = {
  sky: 'text-sky-600', cyan: 'text-cyan-600', emerald: 'text-emerald-600', amber: 'text-amber-600',
  violet: 'text-violet-600', rose: 'text-rose-600', indigo: 'text-indigo-600',
} as const
export type TabColor = keyof typeof TAB_COLOR
export type TabItem = { id: string; label: string; icon: IconName; color: TabColor; disabled?: boolean; why?: string; badge?: number }

export const TabBar = ({ items, active, onChange, label = 'Secciones', class: cls = 'mb-4' }: { items: TabItem[]; active: string; onChange(id: string): void; label?: string; class?: string }) => (
  <nav class={`${cls} flex overflow-x-auto border-b border-slate-200 text-sm`} aria-label={label}>
    {items.map((t) => (
      <button key={t.id} disabled={t.disabled} title={t.disabled ? t.why : undefined} onClick={() => onChange(t.id)} aria-current={active === t.id ? 'page' : undefined}
        class={`flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 disabled:cursor-not-allowed disabled:opacity-50 ${active === t.id ? 'border-cyan-500 font-semibold text-slate-900' : 'border-transparent text-slate-600 hover:border-slate-300'}`}>
        <Icon name={t.icon} class={`size-5 ${TAB_COLOR[t.color]}`} />{t.label}
        {!!t.badge && <span class="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-800">{t.badge}</span>}
      </button>
    ))}
  </nav>
)
