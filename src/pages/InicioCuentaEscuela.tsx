import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { Alert, Badge, Card, PageHeader, Spinner } from '../ui/kit'
import { Icon } from '../ui/Icon'
import type { IconName } from '../modules'

interface MiEscuela { id: number; cue: string; nombre: string | null; nivel: string | null; modalidad: string | null; localidad: string | null; eav: boolean; integrantes: number }

const c = { titulo: 'Equipo de Orientación', icono: 'users' as IconName, texto: 'Desde acá vas a gestionar el Equipo de Orientación de tu escuela.' }

/** Home de ejemplo de la cuenta eoe: solo datos de su propia escuela. */
export function InicioCuentaEscuela() {
  const { user } = useAuth()
  const { data, error, loading } = useAsync(async () => {
    const { data, error } = await supabase.rpc('mi_escuela_cuenta')
    if (error) throw error
    return data as MiEscuela | null
  })
  const dato = (label: string, valor: string | null | undefined) => (
    <div><dt class="text-xs uppercase text-slate-500">{label}</dt><dd class="text-sm font-medium text-slate-900">{valor || '—'}</dd></div>
  )
  return (
    <>
      <PageHeader title={`Hola, ${user?.name ?? ''}`} subtitle={c.titulo} />
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data ? <Spinner /> : data && (
        <div class="grid gap-3 lg:grid-cols-3">
          <Card class="lg:col-span-2">
            <div class="flex items-start gap-3">
              <span class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600"><Icon name={c.icono} /></span>
              <div class="min-w-0">
                <h2 class="font-semibold text-slate-900">{data.nombre ?? data.cue}</h2>
                <p class="mt-0.5 text-sm text-slate-500">{c.texto}</p>
              </div>
            </div>
            <dl class="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
              {dato('CUE', data.cue)}{dato('Nivel', data.nivel)}{dato('Modalidad', data.modalidad)}{dato('Localidad', data.localidad)}
            </dl>
          </Card>
          <Card title="Estado">
            <div class="flex items-center justify-between gap-2"><span class="text-sm text-slate-700">Integrantes del equipo</span><Badge tone="blue">{data.integrantes}</Badge></div>
          </Card>
        </div>
      )}
      {!loading && !data && !error && <Alert tone="warning">No se encontró la escuela asociada a esta cuenta.</Alert>}
    </>
  )
}
