import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { authEmail, setRememberSession, supabase } from './supabase'
import type { Role } from '../modules'

export interface Profile {
  id: string
  login: string
  name: string
  role: Role
  active: boolean
  cue: string | null
  must_change: boolean
  email?: string | null
  telefono?: string | null
  cargo?: string | null
  /** Nombre de quien inició el ingreso simulado (si corresponde) */
  simulador: string | null
}

interface AuthState {
  loading: boolean
  user: Profile | null
  recoveryPending: boolean
  signIn(ident: string, password: string, remember: boolean): Promise<string | null>
  requestPasswordRecovery(ident: string): Promise<string | null>
  signOut(): Promise<void>
  changePassword(next: string): Promise<string | null>
  refresh(): Promise<void>
}

const Ctx = createContext<AuthState>(null as unknown as AuthState)
export const useAuth = () => useContext(Ctx)

async function loadProfile(): Promise<Profile | null> {
  const { data: s } = await supabase.auth.getSession()
  if (!s.session) return null
  const { data } = await supabase.rpc('mi_perfil')
  return data && data.active ? (data as Profile) : null
}

export function AuthProvider({ children }: { children: ComponentChildren }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<Profile | null>(null)
  const [recoveryPending, setRecoveryPending] = useState(false)

  useEffect(() => {
    setRecoveryPending(sessionStorage.getItem('dw-recovery-pending') === '1')
    loadProfile().then((p) => { setUser(p); setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((ev) => {
      if (ev === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('dw-recovery-pending', '1')
        setRecoveryPending(true)
      }
      if (ev === 'SIGNED_OUT') setUser(null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const value: AuthState = {
    loading,
    user,
    recoveryPending,
    async signIn(ident, password, remember) {
      setRememberSession(remember)
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail(ident), password })
      if (error) return 'Usuario o contraseña incorrectos'
      await supabase.rpc('simular_salir') // un ingreso nuevo nunca arranca dentro de una simulación previa
      const p = await loadProfile()
      if (!p) { await supabase.auth.signOut(); return 'Usuario desactivado' }
      setUser(p)
      return null
    },
    async requestPasswordRecovery(ident) {
      const { error } = await supabase.functions.invoke('password-recovery', { body: { login: ident.trim() } })
      if (error) return 'No se pudo procesar la solicitud. Intentá nuevamente más tarde.'
      return null
    },
    async signOut() {
      await supabase.rpc('simular_salir')
      await supabase.auth.signOut()
      sessionStorage.removeItem('dw-recovery-pending')
      setRecoveryPending(false)
      setUser(null)
    },
    async refresh() { setUser(await loadProfile()) },
    async changePassword(next) {
      const { error } = await supabase.auth.updateUser({ password: next })
      if (error) return error.message
      const { error: flagError } = await supabase.rpc('clave_cambiada')
      if (flagError) return flagError.message
      setUser(await loadProfile())
      sessionStorage.removeItem('dw-recovery-pending')
      setRecoveryPending(false)
      location.hash = '#/'
      return null
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
