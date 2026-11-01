import { supabase, check } from '../../lib/supabase'
import { useAsync } from '../../lib/hooks'
import { setParams, useRoute } from '../../lib/router'
import { descargarReporte } from '../../lib/download'
import type { RepTabla } from '../../lib/export'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Spinner, toast } from '../../ui/kit'
import { Icon } from '../../ui/Icon'
import { nombrePeriodo, type Periodo } from './common'

interface Grupo { id: number; nombre: string; codigos: string[] }
interface Esc { id: number; clave: string; codigo: string | null }
interface Dato { plan_id: number; curso_id: number; turno_id: number; secciones: number; matricula: number; asistencia: number }

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
/** Turnos de cada agrupamiento con reporte definido (por sigla, en este orden) */
const TURNOS: Record<string, string[]> = { inicial: ['TM', 'TT', 'JC'] }

async function armar(per: Periodo, grupo: Grupo, escuelas: Esc[]): Promise<RepTabla[]> {
  const siglas = TURNOS[norm(grupo.nombre)]
  const es = escuelas.filter((e) => e.codigo && grupo.codigos.includes(e.codigo)).sort((a, b) => a.clave.localeCompare(b.clave, 'es'))
  const ids = es.map((e) => e.id)
  const [ts, ep, ps, cs, ks] = await Promise.all([
    supabase.from('turnos').select('id,sigla').in('sigla', siglas),
    supabase.from('escuelas').select('id,nivel,modalidad').in('id', ids),
    supabase.from('planes_estudio').select('id,nombre,activo,nivel:catalogos!nivel_id(nombre),modalidad:catalogos!modalidad_id(nombre)').order('id'),
    supabase.from('planes_cursos').select('id,plan_id,orden,nombre').order('orden'),
    supabase.from('matricula_cargas').select('escuela_id,matricula_datos(plan_id,curso_id,turno_id,secciones,matricula,asistencia)').eq('ciclo', per.ciclo).eq('mes', per.mes).not('confirmada_at', 'is', null).in('escuela_id', ids),
  ])
  const turnos = siglas.map((s) => ({ sigla: s, id: (check(ts) as { id: number; sigla: string }[]).find((t) => t.sigla === s)?.id ?? -1 }))
  const pares = new Set((check(ep) as { nivel: string | null; modalidad: string | null }[]).map((e) => `${e.nivel}|${e.modalidad}`))
  const datos = new Map<number, Dato[]>()
  const usados = new Set<number>()
  for (const k of check(ks) as unknown as { escuela_id: number; matricula_datos: Dato[] }[]) {
    datos.set(k.escuela_id, k.matricula_datos)
    k.matricula_datos.forEach((d) => usados.add(d.plan_id))
  }
  const cursos = check(cs) as { id: number; plan_id: number; nombre: string }[]
  const planes = (check(ps) as unknown as { id: number; nombre: string; nivel: { nombre: string } | null; modalidad: { nombre: string } | null }[])
    .filter((p) => usados.has(p.id) || pares.has(`${p.nivel?.nombre}|${p.modalidad?.nombre}`))

  return planes.map((p) => {
    const cur = cursos.filter((c) => c.plan_id === p.id)
    const grupos = [...cur.map((c) => ({ label: c.nombre, subs: siglas })), { label: 'Total', subs: [...cur.map((c) => c.nombre), 'Total'] }]
    const calc = (e: Esc) => {
      const dd = (datos.get(e.id) ?? []).filter((d) => d.plan_id === p.id)
      const trio = (f: (d: Dato) => boolean) => dd.filter(f).reduce((a, d) => [a[0] + d.secciones, a[1] + d.matricula, a[2] + d.asistencia], [0, 0, 0])
      const out: number[] = []
      for (const c of cur) for (const t of turnos) out.push(...trio((d) => d.curso_id === c.id && d.turno_id === t.id))
      const visibles = (d: Dato) => turnos.some((t) => t.id === d.turno_id)
      for (const c of cur) out.push(...trio((d) => d.curso_id === c.id && visibles(d)))
      out.push(...trio(visibles))
      return out
    }
    const filas = es.map((e) => ({ label: e.clave, vals: calc(e) }))
    const n = (grupos.reduce((a, g) => a + g.subs.length, 0)) * 3
    const total = Array.from({ length: n }, (_, i) => filas.reduce((a, f) => a + f.vals[i], 0))
    return { titulo: p.nombre, primera: 'Escuela', grupos, filas, total }
  })
}

export function TablaReporte({ t }: { t: RepTabla }) {
  const th = 'border border-slate-300 bg-sky-100 px-1.5 py-1 text-center text-xs font-semibold'
  const td = 'border border-slate-200 px-1.5 py-1 text-right tabular-nums'
  const sub = ['Sec', 'Mat', 'Asist']
  return (
    <div class="overflow-x-auto">
      <table class="border-collapse text-xs">
        <thead>
          <tr>
            <th rowSpan={3} class={th + ' sticky left-0 z-10 min-w-24 text-left'}>{t.primera}</th>
            {t.grupos.map((g) => <th key={g.label} colSpan={g.subs.length * 3} class={th}>{g.label}</th>)}
          </tr>
          <tr>{t.grupos.flatMap((g) => g.subs.map((s) => <th key={g.label + s} colSpan={3} class={th}>{s}</th>))}</tr>
          <tr>{t.total.map((_, i) => <th key={i} class={th + ' font-medium'}>{sub[i % 3]}</th>)}</tr>
        </thead>
        <tbody>
          {t.filas.map((f) => (
            <tr key={f.label} class="hover:bg-slate-50">
              <td class="sticky left-0 border border-slate-200 bg-white px-1.5 py-1 font-mono font-medium">{f.label}</td>
              {f.vals.map((v, i) => <td key={i} class={td + (v ? '' : ' text-slate-400')}>{v}</td>)}
            </tr>
          ))}
          <tr class="bg-slate-100 font-semibold">
            <td class="sticky left-0 border border-slate-300 bg-slate-100 px-1.5 py-1">Subtotales</td>
            {t.total.map((v, i) => <td key={i} class="border border-slate-300 px-1.5 py-1 text-right tabular-nums">{v}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function Reportes({ periodos, grupos, escuelas }: { periodos: Periodo[]; grupos: Grupo[]; escuelas: Esc[] }) {
  const { params } = useRoute()
  const per = periodos.find((p) => String(p.id) === params.get('rp'))
  const grupo = grupos.find((g) => String(g.id) === params.get('rg'))
  const definido = !!grupo && !!TURNOS[norm(grupo.nombre)]
  const rep = useAsync(async () => (per && grupo && definido ? armar(per, grupo, escuelas) : null), [per?.id, grupo?.id])

  if (!periodos.length || !grupos.length) return <Card><EmptyState title="Sin datos para reportar" text="Se necesita al menos un período y un agrupamiento." /></Card>
  const nombre = per && grupo ? `Matrícula ${grupo.nombre} · ${nombrePeriodo(per)}` : ''
  const bajar = (tipo: 'xlsx' | 'pdf') => descargarReporte(tipo, nombre, `Total de matrícula cargada · ${new Date().toLocaleDateString('es-AR')}`, rep.data!, `reporte-${norm(grupo!.nombre).replace(/\W+/g, '_')}-${per!.ciclo}-${String(per!.mes).padStart(2, '0')}`).catch((e) => toast.error(e.message))
  return (
    <>
      <Card>
        <div class="grid gap-3 sm:grid-cols-2">
          <Lbl label="Período">
            <select class={FIELD} aria-label="Período" value={per?.id ?? ''} onChange={(e) => setParams({ rp: e.currentTarget.value || null })}>
              <option value="">Elegí un período</option>{periodos.map((p) => <option key={p.id} value={p.id}>{nombrePeriodo(p)}</option>)}
            </select>
          </Lbl>
          <Lbl label="Agrupamiento">
            <select class={FIELD} aria-label="Agrupamiento" value={grupo?.id ?? ''} onChange={(e) => setParams({ rg: e.currentTarget.value || null })}>
              <option value="">Elegí un agrupamiento</option>{grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </Lbl>
        </div>
      </Card>
      {!per || !grupo ? <Card class="mt-3"><EmptyState title="Elegí período y agrupamiento" text="Se mostrará el reporte total de la matrícula cargada." /></Card>
        : !definido ? <Card class="mt-3"><EmptyState title={`${grupo.nombre} · ${nombrePeriodo(per)}`} text="El reporte de este agrupamiento se construirá próximamente." /></Card>
        : rep.loading && !rep.data ? <Spinner />
        : rep.error || !rep.data ? <Alert tone="error">{rep.error ?? 'No se pudo armar el reporte'}</Alert>
        : (
          <>
            <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
              <h2 class="text-base font-semibold text-slate-900">{nombre}</h2>
              <div class="flex gap-2">
                <button class={BTN_PRIMARY} onClick={() => bajar('xlsx')}><Icon name="download" class="size-5" />Excel</button>
                <button class={BTN_SECONDARY} onClick={() => bajar('pdf')}><Icon name="download" class="size-5" />PDF</button>
              </div>
            </div>
            {!rep.data.length ? <Card class="mt-3"><EmptyState title="Sin planes de estudio" text="No hay planes de estudio para este agrupamiento." /></Card> : rep.data.map((t) => (
              <Card key={t.titulo} title={t.titulo} class="mt-3"><TablaReporte t={t} /></Card>
            ))}
          </>
        )}
    </>
  )
}
