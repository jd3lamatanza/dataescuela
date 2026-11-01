import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync, useDebounced } from '../lib/hooks'
import { ROLE_LABELS, type Role } from '../modules'
import { Alert, Badge, BTN_PRIMARY, Card, EmptyState, FIELD, PageHeader, Spinner, toast } from '../ui/kit'
import { go } from '../lib/router'

interface Row { id: string; name: string; login: string; role: Role }

export function Simulado() {
  const { refresh } = useAuth()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const { data, loading, error } = useAsync(async () => {
    const { data, error } = await supabase.rpc('simulables', { q: dq.trim() })
    if (error) throw error
    return data as Row[]
  }, [dq])

  const entrar = async (u: Row) => {
    const { error } = await supabase.rpc('simular_iniciar', { target: u.id })
    if (error) return toast.error(error.message)
    await refresh()
    go('/')
  }

  return (
    <>
      <PageHeader title="Ingreso simulado" subtitle="Ingresá como otro usuario para ver la app tal como la ve él. Queda registrado." />
      <input type="search" class={`${FIELD} mb-3`} placeholder="Buscar por nombre, CUE o CUIL" value={q} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Buscar" />
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        {loading && !data ? <Spinner /> : !data?.length ? <EmptyState title="Sin resultados" /> : (
          <ul class="-my-4 divide-y divide-slate-100">
            {data.map((u) => (
              <li key={u.id} class="flex items-center justify-between gap-3 py-3">
                <div class="min-w-0"><p class="truncate font-medium text-slate-900">{u.name}</p><p class="font-mono text-xs text-slate-500">{u.login}</p></div>
                <div class="flex shrink-0 items-center gap-2"><Badge tone="blue">{ROLE_LABELS[u.role]}</Badge><button class={BTN_PRIMARY} onClick={() => entrar(u)}>Ingresar como</button></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data?.length === 30 && <p class="mt-2 text-xs text-slate-500">Se muestran los primeros 30. Refiná la búsqueda para ver otros.</p>}
    </>
  )
}
