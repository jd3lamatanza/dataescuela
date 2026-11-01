import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { setParams, useRoute } from '../lib/router'
import { Alert, PageHeader, Spinner } from '../ui/kit'
import { Equipo, type TipoEquipo } from '../ui/Equipo'
import { FichaEscuela } from '../ui/FichaEscuela'

export const FICHA_TABS = [
  { id: 'escuela', label: 'Ficha de Escuela' },
  { id: 'directivo', label: 'Ficha de Directivos' },
  { id: 'orientacion', label: 'Ficha de Equipo de Orientación' },
  { id: 'esi', label: 'Ficha de Referentes de ESI' },
]

/** Fichas de la escuela del usuario (rol escolar). */
export function Fichas() {
  const { params } = useRoute()
  const tab = FICHA_TABS.some((t) => t.id === params.get('t')) ? params.get('t')! : 'escuela'
  const { data: id, loading, error } = useAsync(async () => {
    const r = await supabase.rpc('mi_escuela')
    if (r.error) throw r.error
    if (!r.data) throw new Error('Tu cuenta no tiene una escuela asociada')
    return r.data as number
  })
  return (
    <>
      <PageHeader title="Fichas de Datos" subtitle="Mantené actualizados los datos de tu escuela" />
      <nav class="flex overflow-x-auto border-b border-slate-200 text-sm" aria-label="Fichas">
        {FICHA_TABS.map((t) => (
          <button key={t.id} onClick={() => setParams({ t: t.id === 'escuela' ? null : t.id })} aria-current={tab === t.id ? 'page' : undefined}
            class={`min-h-11 shrink-0 border-b-2 px-3 ${tab === t.id ? 'border-cyan-500 font-semibold text-slate-900' : 'border-transparent text-slate-600 hover:border-slate-300'}`}>{t.label}</button>
        ))}
      </nav>
      <div class="mt-4">
        {loading ? <Spinner /> : error || !id ? <Alert tone="error">{error ?? 'Sin escuela'}</Alert>
          : tab === 'escuela' ? <FichaEscuela id={id} /> : <Equipo escuelaId={id} tipo={tab as TipoEquipo} />}
      </div>
    </>
  )
}
