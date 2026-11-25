import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync, useDebounced } from '../lib/hooks'
import { ROLE_LABELS, type Role } from '../modules'
import { Alert, Badge, BTN_PRIMARY, Card, EmptyState, FIELD, PageHeader, Spinner, toast } from '../ui/kit'
import { go } from '../lib/router'
import { Icon } from '../ui/Icon'

interface Row { id: string; name: string; login: string; role: Role }

export function Simulado() {
  const { refresh } = useAuth()
  const [q, setQ] = useState('')
  const [rol, setRol] = useState('')
  const dq = useDebounced(q)
  const { data, loading, error } = useAsync(async () => {
    const { data, error } = await supabase.rpc('simulables_filtrar', { q: dq.trim(), p_rol: rol })
    if (error) throw error
    return data as Row[]
  }, [dq, rol])

  const entrar = async (u: Row) => {
    const { error } = await supabase.rpc('simular_iniciar', { target: u.id })
    if (error) return toast.error(error.message)
    await refresh()
    go('/')
  }

  return (
    <>
      <PageHeader title="Ingreso simulado" subtitle="Ingresá como otro usuario para ver la app tal como la ve él. Queda registrado." />
      <div class="mb-3"><Alert tone="info">Las acciones modifican datos reales. Al simular EOE, los PIN y legajos siguen reservados para la cuenta EOE real.</Alert></div>
      <div class="mb-3 flex flex-col gap-2 sm:flex-row">
        <input type="search" class={FIELD} placeholder="Buscar por nombre, CUE o CUIL" value={q} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Buscar" />
        <select class={`${FIELD} sm:max-w-56`} value={rol} onChange={(e) => setRol(e.currentTarget.value)} aria-label="Filtrar por rol">
          <option value="">Todos los roles</option>
          <option value="escolar">{ROLE_LABELS.escolar}</option>
          <option value="areal">{ROLE_LABELS.areal}</option>
          <option value="eav">{ROLE_LABELS.eav}</option>
          <option value="eoe">{ROLE_LABELS.eoe}</option>
        </select>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        {loading ? <Spinner /> : error ? null : !data?.length ? <EmptyState title="Sin resultados" /> : (
          <ul class="-my-4 divide-y divide-slate-100">
            {data.map((u) => (
              <li key={u.id} class="flex flex-col items-start justify-between gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
                <div class="min-w-0"><p class="truncate font-medium text-slate-900">{u.name}</p><p class="font-mono text-xs text-slate-500">{u.login}</p></div>
                <div class="flex flex-wrap items-center gap-2"><Badge tone="blue">{ROLE_LABELS[u.role]}</Badge><button class={BTN_PRIMARY} onClick={() => entrar(u)}><Icon name="login" class="size-4" />Ingresar como</button></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!loading && !error && data?.length === 30 && <p class="mt-2 text-xs text-slate-500">Se muestran los primeros 30. Refiná la búsqueda para ver otros.</p>}
    </>
  )
}
