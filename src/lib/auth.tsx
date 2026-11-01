import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { authEmail, supabase } from './supabase'
import type { Role } from '../modules'

export interface Profile {
  id: string
  login: string
  name: string
  role: Role
  active: boolean
  cue: string | null
  must_change: boolean
  /** Nombre de quien inició el ingreso simulado (si corresponde) */
  simulador: string | null
}

interface AuthState {
  loading: boolean
  user: Profile | null
  signIn(ident: string, password: string): Promise<string | null>
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

  useEffect(() => {
    loadProfile().then((p) => { setUser(p); setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((ev) => {
      if (ev === 'SIGNED_OUT') setUser(null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const value: AuthState = {
    loading,
    user,
    async signIn(ident, password) {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail(ident), password })
      if (error) return 'Usuario o contraseña incorrectos'
      const p = await loadProfile()
      if (!p) { await supabase.auth.signOut(); return 'Usuario desactivado' }
      setUser(p)
      return null
    },
    async signOut() {
      await supabase.rpc('simular_salir')
      await supabase.auth.signOut()
      setUser(null)
    },
    async refresh() { setUser(await loadProfile()) },
    async changePassword(next) {
      const { error } = await supabase.auth.updateUser({ password: next })
      if (error) return error.message
      await supabase.rpc('clave_cambiada')
      setUser(await loadProfile())
      return null
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
