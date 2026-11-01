import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { setParams, useRoute } from '../lib/router'
import { Alert, PageHeader, Spinner, TabBar, type TabItem } from '../ui/kit'
import { Equipo, type TipoEquipo } from '../ui/Equipo'
import { FichaEscuela } from '../ui/FichaEscuela'

export const FICHA_TABS = [
  { id: 'escuela', label: 'Ficha de Escuela', icon: 'school', color: 'sky' },
  { id: 'directivo', label: 'Ficha de Directivos', icon: 'users', color: 'violet' },
  { id: 'orientacion', label: 'Ficha de Equipo de Orientación', icon: 'book', color: 'emerald' },
  { id: 'esi', label: 'Ficha de Referentes de ESI', icon: 'shield', color: 'rose' },
] as const satisfies readonly TabItem[]

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
      <TabBar label="Fichas" class="" items={[...FICHA_TABS]} active={tab} onChange={(id) => setParams({ t: id === 'escuela' ? null : id })} />
      <div class="mt-4">
        {loading ? <Spinner /> : error || !id ? <Alert tone="error">{error ?? 'Sin escuela'}</Alert>
          : tab === 'escuela' ? <FichaEscuela id={id} /> : <Equipo escuelaId={id} tipo={tab as TipoEquipo} />}
      </div>
    </>
  )
}
