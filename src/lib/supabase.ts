import { createClient } from '@supabase/supabase-js'

const AUTH_STORAGE_KEY = 'dw-auth-remember'
let rememberSession = localStorage.getItem(AUTH_STORAGE_KEY) !== '0'

const authStorage = {
  getItem(key: string) {
    return (rememberSession ? localStorage : sessionStorage).getItem(key)
  },
  setItem(key: string, value: string) {
    const active = rememberSession ? localStorage : sessionStorage
    const other = rememberSession ? sessionStorage : localStorage
    other.removeItem(key)
    active.setItem(key, value)
  },
  removeItem(key: string) {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage },
})

const DOMINIO = '@dataescuela.app'

export const setRememberSession = (remember: boolean) => {
  rememberSession = remember
  localStorage.setItem(AUTH_STORAGE_KEY, remember ? '1' : '0')
}

export const getRememberSession = () => rememberSession

/** El login se escribe con CUE, CUIL o usuario; Auth usa un email sintético. */
export const authEmail = (ident: string) => {
  const v = ident.trim().toLowerCase()
  return v.includes('@') ? v : v + DOMINIO
}

/** Lanza si la consulta falla; devuelve data ya tipada. */
export function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

/** Igual que check para consultas maybeSingle: el resultado puede ser null. */
export function checkOpt<T>(r: { data: T | null; error: { message: string } | null }): T | null {
  if (r.error) throw new Error(r.error.message)
  return r.data
}
