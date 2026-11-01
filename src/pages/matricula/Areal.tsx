import { supabase, check } from '../../lib/supabase'
import { useAsync } from '../../lib/hooks'
import { setParams, useRoute } from '../../lib/router'
import { Alert, Card, EmptyState, FIELD, Lbl, PageHeader, Spinner, TabBar } from '../../ui/kit'
import { Icon } from '../../ui/Icon'
import { Reportes } from './Reportes'
import { Consolidacion } from './Consolidacion'
import { VistaCarga, fdia, nombrePeriodo, type Periodo } from './common'

interface Escuela { id: number; clave: string; cue: string; codigo: string | null; numero: number | null; nombre: string | null; localidad: string | null }
interface Grupo { id: number; nombre: string; codigos: string[] }
interface Carga { id: number; escuela_id: number; ciclo: number; mes: number; confirmada_at: string | null }
interface Datos { periodos: Periodo[]; grupos: Grupo[]; escuelas: Escuela[]; cargas: Carga[] }

export function MatriculasAreal() {
  const { params } = useRoute()
  const ver = Number(params.get('ver')) || 0
  const tab = ['reportes', 'consolidacion'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'carga'
  const { data, error, loading } = useAsync<Datos>(async () => {
    const [ps, gs, cs, es, ks] = await Promise.all([
      supabase.from('carga_activa').select('id,ciclo,mes,fecha_apertura,fecha_cierre,carga').order('ciclo', { ascending: false }).order('mes', { ascending: false }),
      supabase.from('agrupamientos_matricula').select('id,nombre').order('nombre'),
      supabase.from('agrupamiento_codigos').select('agrupamiento_id,codigo'),
      supabase.from('escuelas').select('id,clave,cue,codigo,numero,nombre,localidad').order('clave').order('cue'),
      supabase.from('matricula_cargas').select('id,escuela_id,ciclo,mes,confirmada_at'),
    ])
    const codigos = check(cs)
    const visibles = check(es) as Escuela[]
    const menorIdPorCue = new Map<string, number>()
    for (const e of visibles) menorIdPorCue.set(e.cue, Math.min(menorIdPorCue.get(e.cue) ?? Infinity, e.id))
    const escuelas = visibles.filter((e) => menorIdPorCue.get(e.cue) === e.id)
    const ids = new Set(escuelas.map((e) => e.id))
    return {
      periodos: check(ps) as Periodo[],
      grupos: check(gs).map((g) => ({ ...g, codigos: codigos.filter((c) => c.agrupamiento_id === g.id).map((c) => c.codigo) }))
        .filter((g) => escuelas.some((e) => e.codigo && g.codigos.includes(e.codigo))),
      escuelas,
      cargas: (check(ks) as Carga[]).filter((k) => ids.has(k.escuela_id)),
    }
  })

  if (ver) return <VistaCarga cargaId={ver} volver={() => setParams({ ver: null })} />
  if (loading && !data) return <Spinner />
  if (error || !data) return <Alert tone="error">{error}</Alert>

  const periodo = data.periodos.find((p) => String(p.id) === params.get('periodo')) ?? data.periodos[0]
  const grupo = data.grupos.find((g) => String(g.id) === params.get('grupo')) ?? data.grupos[0]
  const subtitulo = tab === 'carga' ? 'Estado de carga de las escuelas asignadas a tu área' : tab === 'reportes' ? 'Reportes de las escuelas asignadas a tu área' : 'Consolidación de las escuelas asignadas a tu área'

  return (
    <>
      <PageHeader title="Matrícula" subtitle={subtitulo} />
      <TabBar label="Matrícula" items={[
        { id: 'carga', label: 'Estado de carga', icon: 'clipboard', color: 'cyan' },
        { id: 'reportes', label: 'Reportes', icon: 'chart', color: 'indigo' },
        { id: 'consolidacion', label: 'Consolidación', icon: 'layers', color: 'emerald' },
      ]} active={tab} onChange={(id) => setParams({ tab: id === 'carga' ? null : id })} />
      {tab === 'reportes' ? <Reportes periodos={data.periodos} grupos={data.grupos} escuelas={data.escuelas} />
        : tab === 'consolidacion' ? <Consolidacion periodos={data.periodos} grupos={data.grupos} escuelas={data.escuelas} />
          : <EstadoCarga data={data} periodo={periodo} grupo={grupo} />}
    </>
  )
}

function EstadoCarga({ data, periodo, grupo }: { data: Datos; periodo?: Periodo; grupo?: Grupo }) {
  const { params } = useRoute()
  if (!data.periodos.length) return <Card class="mt-3"><EmptyState title="Sin períodos de carga" text="Todavía no hay períodos de matrícula configurados." /></Card>
  if (!data.escuelas.length) return <Card class="mt-3"><EmptyState title="Sin escuelas asignadas" text="No hay escuelas asignadas a tu usuario." /></Card>
  if (!periodo || !grupo) return <Card class="mt-3"><EmptyState title="Sin agrupamientos" text="No hay agrupamientos configurados para tus escuelas." /></Card>

  const escuelas = data.escuelas.filter((e) => e.codigo && grupo.codigos.includes(e.codigo))
  const cargas = new Map(data.cargas.filter((k) => k.ciclo === periodo.ciclo && k.mes === periodo.mes).map((k) => [k.escuela_id, k]))

  return (
    <div class="mt-3 space-y-3">
      <Card>
        <div class="grid gap-3 sm:grid-cols-2">
          <Lbl label="Período">
            <select class={FIELD} aria-label="Período" value={periodo.id} onChange={(e) => setParams({ periodo: e.currentTarget.value || null })}>
              {data.periodos.map((p) => <option key={p.id} value={p.id}>{nombrePeriodo(p)}</option>)}
            </select>
          </Lbl>
          <Lbl label="Agrupamiento">
            <select class={FIELD} aria-label="Agrupamiento" value={grupo.id} onChange={(e) => setParams({ grupo: e.currentTarget.value || null })}>
              {data.grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </Lbl>
        </div>
      </Card>
      <Card title={`${grupo.nombre} · ${nombrePeriodo(periodo)}`}>
        {!escuelas.length ? <EmptyState title="Sin escuelas" text="No hay escuelas asignadas en este agrupamiento." /> : (
          <div class="-m-4 overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>{['Clave', 'CUE', 'Escuela', 'Estado de carga', ''].map((h) => <th key={h} class="px-3 py-2">{h}</th>)}</tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                {escuelas.map((e) => {
                  const carga = cargas.get(e.id)
                  const confirmada = !!carga?.confirmada_at
                  return (
                    <tr key={e.id} class="hover:bg-slate-50">
                      <td class="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-medium">{e.clave}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{e.cue}</td>
                      <td class="px-3 py-2.5 font-medium">{[e.codigo, e.numero].filter(Boolean).join(' ')} · {e.nombre}<span class="block text-xs font-normal text-slate-500">{e.localidad}</span></td>
                      <td class="px-3 py-2.5 text-xs">
                        {confirmada ? <span class="text-emerald-700">Confirmada · {fdia(carga.confirmada_at)}</span>
                          : carga ? <span class="font-medium text-amber-700">En carga, aún sin confirmar</span>
                            : <span class="font-medium text-slate-500">Sin cargar</span>}
                      </td>
                      <td class="px-3 py-2.5 text-right">
                        {confirmada && <button class="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => setParams({ ver: carga.id })}><Icon name="eye" class="size-4" />Ver carga</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p class="mt-4 text-xs text-slate-500">Vista de solo lectura: únicamente podés consultar cargas confirmadas de las escuelas asignadas a tu área.</p>
      </Card>
    </div>
  )
}
