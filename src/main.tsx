import { render } from 'preact'
import { AuthProvider, useAuth } from './lib/auth'
import { useRoute } from './lib/router'
import { MODULES, canAccessUser } from './modules'
import { AppShell } from './ui/Layout'
import { Overlays } from './ui/kit'
import { ErrorPagina, Splash } from './ui/Pantallas'
import { Login, CambiarClave } from './pages/Login'
import { pageFor } from './pages/registry'
import { PreinscripcionEav } from './pages/PreinscripcionEav'
import { RegistroAcreditacion } from './pages/RegistroAcreditacion'
import './index.css'

function Router() {
  const { loading, user, signOut, recoveryPending } = useAuth()
  const { path, params } = useRoute()
  if (path === '/preinscripcion-eav') return <PreinscripcionEav />
  if (path === '/registro-acreditacion') return <RegistroAcreditacion id={params.get('id') ?? ''} />
  if (loading) return <Splash />
  if (!user) return <Login />
  if (user.must_change || recoveryPending) return <CambiarClave forced recovery={recoveryPending} />

  // Cada módulo valida el rol para abrirse; si no corresponde, 403 visual.
  const mod = [...MODULES].sort((a, b) => b.path.length - a.path.length).find((m) => (m.path === '/' ? path === '/' : path.startsWith(m.path)))
  const body = !mod ? <ErrorPagina />
    : !canAccessUser(mod, user) ? <ErrorPagina permiso />
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
