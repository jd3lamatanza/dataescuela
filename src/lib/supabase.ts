import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

const DOMINIO = '@dataescuela.app'

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
