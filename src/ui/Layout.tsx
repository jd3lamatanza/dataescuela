import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { BRAND, MODULES, ROLE_LABELS, canAccess, modulesForUser } from '../modules'
import type { Profile } from '../lib/auth'
import { BarraServidor } from './BarraServidor'
import { Icon } from './Icon'
import { href } from '../lib/router'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Bandeja } from './Bandeja'
import { AvisoSimulado } from './AvisoSimulado'
import { agruparMenuDistrital, ordenarModulosSidebar, type CategoriaDistrital } from './sidebarDistrital'
import { ESTILOS_CATEGORIAS, ESTILO_TEMA, estiloModulo } from './sidebarMenu'
import { Modal, toast } from './kit'
import { NotificacionesPush } from './NotificacionesPush'
import { ReportarError } from './ReportarError'
import type { AppModule } from '../modules'

export const Logo = ({ class: cls = 'size-10' }: { class?: string }) => (
  <img src={`${import.meta.env.BASE_URL}icon-192.png?v=2`} alt="DataEscuela v2" width="64" height="64" class={`shrink-0 rounded-xl ${cls}`} />
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

/** Topbar y sidebar (riel colapsable en escritorio, drawer en móvil). */
export function AppShell({ user, path, onLogout, children }: { user: Profile; path: string; onLogout(): void; children?: ComponentChildren }) {
  const { refresh } = useAuth()
  const [drawer, setDrawer] = useState(false)
  const [acerca, setAcerca] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dw-sb') === '1')
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key !== 'dw-theme' && e.key !== null) return
      const next = e.key === 'dw-theme' && e.newValue === 'dark'
      document.documentElement.classList.toggle('dark', next)
      setDark(next)
    }
    addEventListener('storage', sync)
    return () => removeEventListener('storage', sync)
  }, [])
  const mods = modulesForUser(user)
  const active = (p: string) => (p === '/' ? path === '/' : path.startsWith(p))
  const categorias = user.role === 'distrital' ? agruparMenuDistrital(mods) : []
  const categoriaActiva = categorias.find((c) => c.modulos.some((m) => active(m.path)))?.id
  const [abiertas, setAbiertas] = useState<Partial<Record<CategoriaDistrital, boolean>>>({})
  useEffect(() => {
    if (categoriaActiva) setAbiertas((actual) => ({ ...actual, [categoriaActiva]: true }))
  }, [categoriaActiva, path, user.id, user.role])
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  const toggle = () => { const v = !collapsed; setCollapsed(v); localStorage.setItem('dw-sb', v ? '1' : '0') }
  const cambiarTema = () => {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    setDark(next)
    try { localStorage.setItem('dw-theme', next ? 'dark' : 'light') }
    catch { toast.error('No se pudo guardar la preferencia de apariencia en este dispositivo.') }
  }
  const enlace = (m: AppModule) => (
    <a href={href(m.path)} title={m.label} onClick={() => setDrawer(false)} aria-current={active(m.path) ? 'page' : undefined}
      class={`relative flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm ${collapsed ? 'lg:justify-center lg:px-0' : ''} ${active(m.path) ? 'bg-sky-50 font-semibold text-slate-900 before:absolute before:-left-2 before:bottom-2 before:top-2 before:w-1 before:rounded-full before:bg-cyan-500' : 'text-slate-700 hover:bg-slate-200/60'}`}>
      <span class="shrink-0" style={{ color: dark ? estiloModulo(m).oscuro : estiloModulo(m).claro }}><Icon name={estiloModulo(m).icon} class="size-[18px]" /></span>
      <span class={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{m.label}</span>
    </a>
  )
  const tema = (
    <button type="button" role="switch" aria-label="Modo oscuro" aria-checked={dark} title="Modo oscuro" onClick={cambiarTema}
      class={`flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-slate-700 hover:bg-slate-200/60 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
      <span class="shrink-0" style={{ color: dark ? ESTILO_TEMA.oscuro : ESTILO_TEMA.claro }}><Icon name={ESTILO_TEMA.icon} class="size-[18px]" /></span>
      <span class={`flex-1 ${collapsed ? 'lg:hidden' : ''}`}>Modo oscuro</span>
      <span aria-hidden="true" class={`relative h-5 w-9 shrink-0 rounded-full ${dark ? 'bg-sky-600' : 'bg-slate-300'} ${collapsed ? 'lg:hidden' : ''}`}>
        <span class={`theme-thumb absolute top-0.5 size-4 rounded-full bg-white transition-transform ${dark ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
    </button>
  )
  const ordenados = ordenarModulosSidebar(mods)
  const destacados = ordenados.filter((m) => m.id === 'inicio' || m.id === 'mensajes')
  const listaPlana = <ul class="space-y-0.5">{ordenados.map((modulo) =>
    <li key={modulo.id}>{enlace(modulo)}</li>)}<li>{tema}</li></ul>
  const categoriaMenu = (categoria: (typeof categorias)[number]) => {
    const apariencia = ESTILOS_CATEGORIAS[categoria.id]
    return <section key={categoria.id}>
      <button type="button" aria-expanded={!!abiertas[categoria.id]} aria-controls={`menu-distrital-${categoria.id}`}
        onClick={() => setAbiertas((actual) => ({ ...actual, [categoria.id]: !actual[categoria.id] }))}
        class="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-200/60">
        <span class="shrink-0" style={{ color: dark ? apariencia.oscuro : apariencia.claro }}><Icon name={apariencia.icon} class="size-[18px]" /></span>
        <span class="flex-1">{categoria.label}</span>
        <Icon name="chevr" class={`size-4 text-slate-500 transition-transform ${abiertas[categoria.id] ? 'rotate-90' : ''}`} />
      </button>
      <ul id={`menu-distrital-${categoria.id}`} hidden={!abiertas[categoria.id]} class="ml-4 space-y-0.5 border-l border-slate-200 pl-2">
        {categoria.modulos.map((m) => <li key={m.id}>{enlace(m)}</li>)}
      </ul>
    </section>
  }

  return (
    <div class="min-h-full bg-white">
      {user.simulador && <AvisoSimulado user={user} onVolver={async () => { await supabase.rpc('simular_salir'); await refresh(); location.hash = '#/simulado' }} />}
      {drawer && <div class="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setDrawer(false)} />}
      <header class="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 sm:px-4">
        <button type="button" class="flex size-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Menú" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
        <button type="button" class="hidden size-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 lg:flex" aria-label="Colapsar menú" onClick={toggle}><Icon name="sidebar" /></button>
        <a href={href('/')} class="flex items-center gap-2 font-semibold text-slate-900"><Logo class="size-8" /><span class="hidden sm:inline">{BRAND.name}</span></a>
        <div class="ml-auto flex items-center gap-2">
          <Bandeja />
          <ReportarError user={user} path={path} />
          <UserMenu user={user} initials={initials} onLogout={onLogout} onAcerca={() => setAcerca(true)} />
        </div>
      </header>

      <nav class={`fixed inset-y-0 left-0 z-40 w-64 -translate-x-full overflow-y-auto border-r border-slate-200 bg-slate-50 p-2 pt-16 transition-transform lg:z-10 lg:translate-x-0 lg:pt-16 ${drawer ? '!translate-x-0' : ''} ${collapsed ? 'lg:w-16' : ''}`}>
        {user.role !== 'distrital' ? listaPlana : <>
          <div class={collapsed ? 'lg:hidden' : ''}>
            <div class="space-y-0.5">
              {destacados.map((modulo) => <div key={modulo.id}>{enlace(modulo)}</div>)}
              {categorias.map(categoriaMenu)}
              {tema}
            </div>
          </div>
          {collapsed && <div class="hidden lg:block">{listaPlana}</div>}
        </>}
      </nav>

      <main class={`px-3 py-5 sm:px-6 ${collapsed ? 'lg:pl-24' : 'lg:pl-72'}`}>
        <div class="w-full"><NotificacionesPush key={`${user.id}:${path === '/' ? 'inicio' : 'sesion'}`} simulando={!!user.simulador} />{children}</div>
        {user.role === 'distrital' && <div class="hidden h-14 lg:block" />}
      </main>
      {user.role === 'distrital' && <BarraServidor collapsed={collapsed} />}
      {acerca && <AcercaDe onClose={() => setAcerca(false)} />}
    </div>
  )
}

/** Menú desplegable del usuario: datos de la cuenta, módulos personales y salida. */
function UserMenu({ user, initials, onLogout, onAcerca }: { user: Profile; initials: string; onLogout(): void; onAcerca(): void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('click', close); addEventListener('keydown', key)
    return () => { removeEventListener('click', close); removeEventListener('keydown', key) }
  }, [open])
  const own = MODULES.filter((m) => m.userMenu && canAccess(m, user.role))
  const item = 'flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-slate-50'

  return (
    <div class="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label="Menú de usuario" onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        class="flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-1.5 text-slate-700 shadow-sm hover:bg-slate-100 sm:pl-2.5">
        <span class="hidden max-w-48 truncate text-sm font-medium sm:block">{user.name}</span>
        <span class="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-xs font-semibold text-white">{initials}</span>
      </button>
      {open && (
        <div role="menu" class="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div class="border-b border-slate-100 px-3 py-2.5">
            <p class="truncate text-sm font-semibold text-slate-900">{user.name}</p>
            <p class="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
          {own.map((m) => (
            <a key={m.id} role="menuitem" href={href(m.path)} onClick={() => setOpen(false)} class={`${item} text-slate-700`}><Icon name={m.icon} class="size-[18px] text-slate-500" />{m.label}</a>
          ))}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onAcerca() }} class={`${item} text-slate-700`}><Icon name="info" class="size-[18px] text-slate-500" />Acerca de DataEscuela</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout() }} class={`${item} border-t border-slate-100 text-slate-700`}><Icon name="logout" class="size-[18px] text-slate-500" />Cerrar sesión</button>
        </div>
      )}
    </div>
  )
}

function AcercaDe({ onClose }: { onClose(): void }) {
  return <Modal title="Acerca de DataEscuela" onClose={onClose}>
    <div class="space-y-4 text-sm leading-relaxed text-slate-600">
      <div class="flex items-center gap-3">
        <Logo class="size-14" />
        <div>
          <p class="text-lg font-bold text-slate-900">DataEscuela v2</p>
          <p>Sistema de Relevamiento de Datos de JD3</p>
        </div>
      </div>
      <p class="font-semibold text-slate-800">Jefa Distrital: Karina Mattivi</p>
      <p>DataEscuela es una plataforma destinada al relevamiento de datos y comunicación con las escuelas de JD3.</p>
      <p>Es un sistema de código abierto desarrollado por la JD3, alojado gratuitamente en servidores mediante servicios gratuitos para desarrolladores. Es el producto del trabajo de sistematización de la información realizado durante los últimos dos años.</p>
      <div class="rounded-lg bg-slate-50 p-3">
        <p><span class="font-semibold text-slate-800">Soporte Técnico:</span> Orlando Martínez (JD3)</p>
        <p><span class="font-semibold text-slate-800">Desarrollador:</span> Joel Amarante (JD3)</p>
      </div>
      <div class="border-t border-slate-200 pt-4 text-right">
        <p class="font-semibold italic text-slate-800">Es en equipo o no es.</p>
        <p class="mt-1">Karina Mattivi</p>
      </div>
    </div>
  </Modal>
}
