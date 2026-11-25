import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { Alert, Badge, PageHeader, Spinner, TabBar, type TabItem } from '../ui/kit'
import { Preinscripciones } from './EscuelaVeranoEscolar'

const TABS = [
  { id: 'inscripciones', label: 'Inscripciones', icon: 'clipboard', color: 'emerald' },
] as const satisfies readonly TabItem[]

/** Home de la cuenta eav: pestañas de gestión de la Escuela de Verano de su propia escuela. */
export function InicioEav() {
  const { user } = useAuth()
  const [tab, setTab] = useState<string>(TABS[0].id)
  const { data, error, loading } = useAsync(async () => {
    const { data, error } = await supabase.rpc('mi_escuela_cuenta')
    if (error) throw error
    return data as { id: number; cue: string; nombre: string | null; eav: boolean } | null
  })
  return (
    <>
      <PageHeader title={`Hola, ${user?.name ?? ''}`} subtitle="Escuela de Verano" actions={data ? <Badge tone={data.eav ? 'green' : 'slate'}>{data.eav ? 'EAV activa' : 'EAV inactiva'}</Badge> : undefined} />
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data ? <Spinner /> : data ? <>
        <TabBar label="Escuela de Verano" items={[...TABS]} active={tab} onChange={setTab} />
        {tab === 'inscripciones' && <Preinscripciones escuelaId={data.id} cargaManual />}
      </> : !error && <Alert tone="warning">No se encontró la escuela asociada a esta cuenta.</Alert>}
    </>
  )
}
