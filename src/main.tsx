import { render } from 'preact'
import { AuthProvider, useAuth } from './lib/auth'
import { useRoute } from './lib/router'
import { MODULES, canAccess } from './modules'
import { AppShell } from './ui/Layout'
import { EmptyState, Overlays, Spinner } from './ui/kit'
import { Login, CambiarClave } from './pages/Login'
import { pageFor } from './pages/registry'
import './index.css'

function Router() {
  const { loading, user, signOut } = useAuth()
  const { path } = useRoute()
  if (loading) return <Spinner />
  if (!user) return <Login />
  if (user.must_change) return <CambiarClave forced />

  // Cada módulo valida el rol para abrirse; si no corresponde, 403 visual.
  const mod = [...MODULES].sort((a, b) => b.path.length - a.path.length).find((m) => (m.path === '/' ? path === '/' : path.startsWith(m.path)))
  const body = !mod ? <EmptyState title="Página no encontrada" />
    : !canAccess(mod, user.role) ? <EmptyState title="Sin acceso" text="Tu rol no tiene permiso para este módulo." />
    : (() => { const P = pageFor(mod.id, mod.label); return <P /> })()

  return <AppShell user={user} path={path} onLogout={signOut}>{body}</AppShell>
}

render(
  <AuthProvider>
    <Router />
    <Overlays />
  </AuthProvider>,
  document.getElementById('app')!,
)
