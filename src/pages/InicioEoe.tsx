import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { Alert, Badge, Card, PageHeader, Spinner, TabBar, type TabItem } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { Equipo, type TipoEquipo } from '../ui/Equipo'
import { FichaEscuela } from '../ui/FichaEscuela'
import { FICHA_TABS } from './Fichas'
import { PlantaPanel } from './Planta'
import { Historial } from './matricula/Escolar'
import { VistaCarga } from './matricula/common'
import { Salidas } from './Salidas'

const TABS = [
  { id: 'planta', label: 'Mi Planta', icon: 'org', color: 'violet' },
  { id: 'escuela', label: 'Mi Escuela', icon: 'school', color: 'sky' },
  { id: 'matricula', label: 'Matrícula', icon: 'chart', color: 'cyan' },
  { id: 'salidas', label: 'Salidas Educativas', icon: 'bus', color: 'amber' },
] as const satisfies readonly TabItem[]

const LECTURA = <Badge tone="slate">Solo lectura</Badge>

function MiEscuela({ id }: { id: number }) {
  const [ficha, setFicha] = useState<string>(FICHA_TABS[0].id)
  return (
    <>
      <TabBar label="Fichas" class="" items={[...FICHA_TABS]} active={ficha} onChange={setFicha} />
      <div class="mt-4">
        {ficha === 'orientacion' ? <Equipo escuelaId={id} tipo="orientacion" />
          : <>
            <div class="mb-3">{LECTURA}</div>
            {ficha === 'escuela' ? <FichaEscuela id={id} soloLectura /> : <Equipo escuelaId={id} tipo={ficha as TipoEquipo} soloLectura />}
          </>}
      </div>
    </>
  )
}

function Matricula({ id }: { id: number }) {
  const [ver, setVer] = useState(0)
  if (ver) return <VistaCarga cargaId={ver} volver={() => setVer(0)} />
  return <><div class="mb-3">{LECTURA}</div><Historial escuelaId={id} onVer={setVer} propia={false} /></>
}

/** Home de la cuenta eoe: bienvenida y consulta de su escuela; solo edita la ficha del equipo de orientación. */
export function InicioEoe() {
  const { user } = useAuth()
  const [tab, setTab] = useState<string>(TABS[0].id)
  const { data, error, loading } = useAsync(async () => {
    const { data, error } = await supabase.rpc('mi_escuela_cuenta')
    if (error) throw error
    return data as { id: number; cue: string; nombre: string | null } | null
  })
  return (
    <>
      <PageHeader title={`Hola, ${user?.name ?? ''}`} subtitle="Equipo de Orientación" />
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data ? <Spinner /> : data ? <>
        <Card class="mb-4">
          <div class="flex items-start gap-3">
            <span class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Icon name="users" /></span>
            <div class="min-w-0">
              <h2 class="font-semibold text-slate-900">¡Te damos la bienvenida a DataEscuela!</h2>
              <p class="mt-0.5 text-sm text-slate-500">Desde acá podés consultar la información de {data.nombre ?? data.cue} y mantener actualizada la ficha de tu Equipo de Orientación.</p>
            </div>
          </div>
        </Card>
        <TabBar label="Secciones" items={[...TABS]} active={tab} onChange={setTab} />
        {tab === 'planta' && <PlantaPanel key={data.id} escuelaId={data.id} soloLectura />}
        {tab === 'escuela' && <MiEscuela id={data.id} />}
        {tab === 'matricula' && <Matricula id={data.id} />}
        {tab === 'salidas' && <Salidas />}
      </> : !error && <Alert tone="warning">No se encontró la escuela asociada a esta cuenta.</Alert>}
    </>
  )
}
