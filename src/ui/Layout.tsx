import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { BRAND, ROLE_LABELS, modulesFor } from '../modules'
import type { Profile } from '../lib/auth'
import { Icon } from './Icon'
import { href } from '../lib/router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Bandeja } from './Bandeja'

export const Logo = ({ class: cls = 'size-10' }: { class?: string }) => (
  <img src="./icon-192.png" alt="DataEscuela v2" width="64" height="64" class={`shrink-0 rounded-xl ${cls}`} />
)

/** Login a dos paneles: marca a la izquierda (≥lg) y formulario a la derecha. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children?: ComponentChildren }) {
  return (
    <div class="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <aside class="relative hidden overflow-hidden bg-slate-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(6,182,212,.4),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(37,99,235,.4),transparent_45%)]" />
        <div class="relative flex items-center gap-3 text-white"><Logo class="size-11" /><span class="text-lg font-semibold tracking-tight">{BRAND.name}</span></div>
        <div class="relative max-w-lg text-white">
          <p class="text-sm font-medium uppercase tracking-widest text-cyan-300">{BRAND.org}</p>
          <h2 class="mt-4 text-4xl font-bold leading-tight tracking-tight">Información educativa, clara y a mano.</h2>
          <p class="mt-4 text-base text-slate-300">Sistema de relevamiento de datos de Jefatura Distrital 3</p>
        </div>
        <p class="relative text-xs text-slate-400">© {new Date().getFullYear()} {BRAND.org}</p>
      </aside>
      <main class="flex flex-col justify-center bg-white px-5 py-10 sm:px-10">
        <div class="mx-auto w-full max-w-sm">
          <div class="mb-8 flex items-center gap-3 lg:hidden"><Logo class="size-11" /><div><p class="text-base font-bold leading-tight">{BRAND.name}</p><p class="text-xs text-slate-500">{BRAND.org}</p></div></div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
          {subtitle && <p class="mt-2 text-sm text-slate-500">{subtitle}</p>}
          <div class="mt-8">{children}</div>
        </div>
      </main>
    </div>
  )
}

/** Shell estilo GitHub claro: topbar, sidebar (riel colapsable en escritorio, drawer en móvil). */
export function AppShell({ user, path, onLogout, children }: { user: Profile; path: string; onLogout(): void; children?: ComponentChildren }) {
  const { refresh } = useAuth()
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dw-sb') === '1')
  const mods = modulesFor(user.role)
  const active = (p: string) => (p === '/' ? path === '/' : path.startsWith(p))
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const toggle = () => { const v = !collapsed; setCollapsed(v); localStorage.setItem('dw-sb', v ? '1' : '0') }

  return (
    <div class="min-h-full bg-white">
      {user.simulador && (
        <div class="fixed inset-x-3 bottom-4 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg bg-amber-400 px-3 py-2 text-center text-sm font-medium text-amber-950 shadow-lg ring-1 ring-amber-600/40 lg:inset-x-auto lg:right-4 lg:max-w-md">
          <span>Ingreso simulado como <strong>{user.name}</strong> (sesión de {user.simulador})</span>
          <button class="rounded bg-amber-950 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-900" onClick={async () => { await supabase.rpc('simular_salir'); await refresh(); location.hash = '#/simulado' }}>Volver a mi cuenta</button>
        </div>
      )}
      {drawer && <div class="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setDrawer(false)} />}
      <header class="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 sm:px-4">
        <button type="button" class="flex size-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Menú" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
        <button type="button" class="hidden size-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 lg:flex" aria-label="Colapsar menú" onClick={toggle}><Icon name="sidebar" /></button>
        <a href={href('/')} class="flex items-center gap-2 font-semibold text-slate-900"><Logo class="size-8" /><span class="hidden sm:inline">{BRAND.name}</span></a>
        <div class="ml-auto flex items-center gap-2">
          <Bandeja />
          <div class="hidden text-right leading-tight sm:block"><p class="max-w-56 truncate text-sm font-medium text-slate-900">{user.name}</p><p class="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p></div>
          <span class="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-xs font-semibold text-white">{initials}</span>
          <button type="button" onClick={onLogout} aria-label="Salir" title="Salir" class="flex size-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"><Icon name="logout" /></button>
        </div>
      </header>

      <nav class={`fixed inset-y-0 left-0 z-40 w-64 -translate-x-full overflow-y-auto border-r border-slate-200 bg-slate-50 p-2 pt-16 transition-transform lg:z-10 lg:translate-x-0 lg:pt-16 ${drawer ? '!translate-x-0' : ''} ${collapsed ? 'lg:w-16' : ''}`}>
        <ul class="space-y-0.5">
          {mods.map((m) => (
            <li key={m.id}>
              <a href={href(m.path)} title={m.label} onClick={() => setDrawer(false)} aria-current={active(m.path) ? 'page' : undefined}
                class={`relative flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm ${collapsed ? 'lg:justify-center lg:px-0' : ''} ${active(m.path) ? 'bg-sky-50 font-semibold text-slate-900 before:absolute before:-left-2 before:bottom-2 before:top-2 before:w-1 before:rounded-full before:bg-cyan-500' : 'text-slate-700 hover:bg-slate-200/60'}`}>
                <Icon name={m.icon} class={`size-[18px] shrink-0 ${active(m.path) ? 'text-sky-600' : 'text-slate-500'}`} />
                <span class={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{m.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main class={`px-3 py-5 sm:px-6 ${collapsed ? 'lg:pl-24' : 'lg:pl-72'}`}>
        <div class="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
