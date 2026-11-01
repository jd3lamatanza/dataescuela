import { useState } from 'preact/hooks'
import { supabase, check, checkOpt } from '../../lib/supabase'
import { useAsync } from '../../lib/hooks'
import { setParams, useRoute } from '../../lib/router'
import { Alert, Card, EmptyState, PageHeader, RowMenu, Spinner, TabBar } from '../../ui/kit'
import { useMiEscuela } from '../Planta'
import { FormCarga, MESES, VistaCarga, cargaFilas, bajarCarga, fdia, hoyAR, nombrePeriodo, type Periodo } from './common'

/** Período vigente (activo y dentro de fechas, hora de Argentina); si no hay, el mes calendario, cerrado */
export async function periodoActual() {
  const hoy = hoyAR()
  const ps = check(await supabase.from('carga_activa').select('id,ciclo,mes,fecha_apertura,fecha_cierre,carga').order('ciclo', { ascending: false }).order('mes', { ascending: false })) as Periodo[]
  const v = ps.find((p) => p.carga && p.fecha_apertura <= hoy && p.fecha_cierre >= hoy)
  if (v) return { ciclo: v.ciclo, mes: v.mes, row: v, abierto: true }
  const ciclo = Number(hoy.slice(0, 4)); const mes = Number(hoy.slice(5, 7))
  return { ciclo, mes, row: ps.find((p) => p.ciclo === ciclo && p.mes === mes) ?? null, abierto: false }
}

export function Matricula() {
  const { params } = useRoute()
  const esc = useMiEscuela()
  const tab = params.get('tab') === 'historial' ? 'historial' : 'carga'
  const ver = Number(params.get('ver')) || 0
  if (esc.loading) return <Spinner />
  if (esc.error || !esc.data) return <Alert tone="error">{esc.error ?? 'Sin escuela'}</Alert>
  if (ver) return <VistaCarga cargaId={ver} volver={() => setParams({ ver: null })} />
  return (
    <>
      <PageHeader title="Matrícula" subtitle="Matrícula y asistencia mensual" />
      <TabBar label="Matrícula" items={[{ id: 'carga', label: 'Carga del mes', icon: 'edit', color: 'cyan' }, { id: 'historial', label: 'Historial', icon: 'clock', color: 'amber' }]} active={tab} onChange={(id) => setParams({ tab: id === 'carga' ? null : id })} />
      {tab === 'carga' ? <Carga escuelaId={esc.data} /> : <Historial escuelaId={esc.data} />}
    </>
  )
}

function Carga({ escuelaId }: { escuelaId: number }) {
  const [n, setN] = useState(0)
  const { data, error, loading } = useAsync(async () => {
    const per = await periodoActual()
    const k: { habilitada: boolean } | null = checkOpt(await supabase.from('matricula_cargas').select('habilitada').eq('escuela_id', escuelaId).eq('ciclo', per.ciclo).eq('mes', per.mes).maybeSingle())
    const e: { clave: string } = check(await supabase.from('escuelas').select('clave').eq('id', escuelaId).single())
    return { per, habilitada: !!k?.habilitada, clave: e.clave }
  }, [escuelaId, n])
  if (loading && !data) return <Spinner />
  if (error || !data) return <Alert tone="error">{error}</Alert>
  const { per, habilitada, clave } = data
  return (
    <>
      {per.abierto ? (
        <div class="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p class="font-semibold">Período de carga abierto: {nombrePeriodo(per)}</p>
          <p>Apertura: {fdia(per.row!.fecha_apertura)} · Cierre: {fdia(per.row!.fecha_cierre)}</p>
        </div>
      ) : (
        <div class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p class="font-semibold">Fuera de Período de Carga</p>
          <p>{per.row ? `Período ${nombrePeriodo(per)}: apertura ${fdia(per.row.fecha_apertura)} · cierre ${fdia(per.row.fecha_cierre)}.` : `No hay un período de carga definido para ${nombrePeriodo(per)}.`}</p>
          {habilitada && <p class="mt-1 font-medium">La Jefatura habilitó la carga de tu escuela para este período.</p>}
        </div>
      )}
      <FormCarga escuelaId={escuelaId} ciclo={per.ciclo} mes={per.mes} editable={per.abierto || habilitada} clave={clave} onSaved={() => setN(n + 1)} />
    </>
  )
}

function Historial({ escuelaId }: { escuelaId: number }) {
  const { data, error, loading } = useAsync(async () => {
    const [ks, escuela] = await Promise.all([
      supabase.from('matricula_cargas').select('id,ciclo,mes,confirmada_at,matricula_datos(secciones,matricula,inclusion,asistencia),escuelas(clave)').eq('escuela_id', escuelaId).not('confirmada_at', 'is', null).order('ciclo', { ascending: false }).order('mes', { ascending: false }),
      supabase.from('escuelas').select('codigo').eq('id', escuelaId).single(),
    ])
    const registros = check(ks) as any[]
    const codigo = check(escuela).codigo as string | null
    const especial = ['EE', 'EL', 'ET'].includes(codigo ?? '')
    return {
      especial,
      registros: registros.map((k) => {
        const mat = k.matricula_datos.reduce((a: number, d: any) => a + d.matricula, 0)
        const inc = k.matricula_datos.reduce((a: number, d: any) => a + d.inclusion, 0)
        return { ...k, sec: k.matricula_datos.reduce((a: number, d: any) => a + d.secciones, 0), mat, inc, totalMat: mat + inc, asi: k.matricula_datos.reduce((a: number, d: any) => a + d.asistencia, 0) }
      }),
    }
  }, [escuelaId])
  if (loading && !data) return <Spinner />
  if (error || !data) return <Alert tone="error">{error}</Alert>
  const excel = async (k: any, t: 'xlsx' | 'pdf') => bajarCarga(t, await cargaFilas(k.id), k, k.escuelas.clave, k.confirmada_at, data.especial)
  const Menu = ({ k }: { k: any }) => <RowMenu items={[
    { label: 'Ver carga', icon: 'eye', onClick: () => setParams({ ver: k.id }) },
    { label: 'Descargar Excel', icon: 'download', onClick: () => excel(k, 'xlsx') },
    { label: 'Descargar PDF', icon: 'download', onClick: () => excel(k, 'pdf') },
  ]} />
  return (
    <Card>
      {!data.registros.length ? <EmptyState title="Sin cargas" text="Todavía no confirmaste ninguna carga mensual." /> : (
        <div class="-m-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-3 py-2">Período</th><th class="px-3 py-2 text-right">Secciones</th><th class="px-3 py-2 text-right">{data.especial ? 'Matrícula sede' : 'Matrícula'}</th>{data.especial && <><th class="px-3 py-2 text-right">Matrícula con inclusión</th><th class="px-3 py-2 text-right">Matrícula total</th></>}<th class="px-3 py-2 text-right">Asistencia</th><th class="px-3 py-2">Confirmada</th><th class="px-3 py-2" /></tr></thead>
            <tbody class="divide-y divide-slate-100">
              {data.registros.map((k) => (
                <tr key={k.id}><td class="px-3 py-2.5 font-medium">{MESES[k.mes]} {k.ciclo}</td><td class="px-3 py-2.5 text-right">{k.sec}</td><td class="px-3 py-2.5 text-right">{k.mat}</td>{data.especial && <><td class="px-3 py-2.5 text-right">{k.inc}</td><td class="px-3 py-2.5 text-right font-semibold">{k.totalMat}</td></>}<td class="px-3 py-2.5 text-right">{k.asi}</td><td class="px-3 py-2.5 text-xs text-slate-500">{fdia(k.confirmada_at)}</td><td class="px-3 py-2.5"><Menu k={k} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.especial && <p class="mt-3 text-xs text-slate-600">Matrícula total = matrícula sede + matrícula con inclusión; el total se obtiene sumando ambas.</p>}
    </Card>
  )
}
