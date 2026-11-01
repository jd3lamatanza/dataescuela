import { supabase, check } from '../../lib/supabase'
import { useAsync } from '../../lib/hooks'
import { setParams, useRoute } from '../../lib/router'
import { descargarReporte } from '../../lib/download'
import type { RepGrupo, RepTabla } from '../../lib/export'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Spinner, TabBar, toast } from '../../ui/kit'
import { Icon } from '../../ui/Icon'
import { nombrePeriodo, type Periodo } from './common'

interface Grupo { id: number; nombre: string; codigos: string[] }
interface Esc { id: number; clave: string; codigo: string | null }
interface Dato { plan_id: number; curso_id: number; turno_id: number; secciones: number; matricula: number; asistencia: number }

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
type Tipo = 'planes' | 'secundaria'
/** Reportes definidos por agrupamiento: turnos (por sigla, en orden) y forma del cuadro */
const CFG: Record<string, { siglas: string[]; tipo: Tipo; tabs?: [string, string][] }> = {
  inicial: { siglas: ['TM', 'TT', 'JC'], tipo: 'planes' },
  primaria: { siglas: ['TM', 'TT', 'JC'], tipo: 'planes' },
  'secundaria orientada': { siglas: ['TM', 'TT', 'TV', 'JC', 'JE'], tipo: 'secundaria', tabs: [['general', 'Reporte General'], ['analitico', 'Reporte Analítico']] },
}
const CICLOS = ['Ciclo Básico', 'Ciclo Superior', 'Programas']
/** Cada ciclo se reconoce por una expresión sobre el nombre del plan (sin tildes ni mayúsculas); agregar variantes acá */
const CICLO_RE = [/ciclo\s+basico/, /ciclo\s+superior/, /programas?/]
const cicloDe = (nombre: string) => CICLO_RE.findIndex((re) => re.test(norm(nombre)))
const claveCurso = (nombre: string) => norm(nombre).match(/^(\d+)/)?.[1] ?? norm(nombre)

async function armar(per: Periodo, grupo: Grupo, escuelas: Esc[], modo: string): Promise<RepTabla[]> {
  const cfg = CFG[norm(grupo.nombre)]
  const siglas = cfg.siglas
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
  const cursos = check(cs) as { id: number; plan_id: number; orden: number; nombre: string }[]
  const planes = (check(ps) as unknown as { id: number; nombre: string; nivel: { nombre: string } | null; modalidad: { nombre: string } | null }[])
    .filter((p) => usados.has(p.id) || pares.has(`${p.nivel?.nombre}|${p.modalidad?.nombre}`))

  const visibles = (d: Dato) => turnos.some((t) => t.id === d.turno_id)
  const trio = (dd: Dato[]) => dd.reduce((a, d) => [a[0] + d.secciones, a[1] + d.matricula, a[2] + d.asistencia], [0, 0, 0])
  const sumas = (cols: { ids: Set<number> }[], e: Esc, plan?: number) => {
    const dd = (datos.get(e.id) ?? []).filter((d) => plan === undefined || d.plan_id === plan)
    const out: number[] = []
    for (const c of cols) for (const t of turnos) out.push(...trio(dd.filter((d) => c.ids.has(d.curso_id) && d.turno_id === t.id)))
    for (const c of cols) out.push(...trio(dd.filter((d) => c.ids.has(d.curso_id) && visibles(d))))
    out.push(...trio(dd.filter((d) => cols.some((c) => c.ids.has(d.curso_id)) && visibles(d))))
    return out
  }
  const tabla = (titulo: string, grupos: RepGrupo[], cols: { ids: Set<number> }[]): RepTabla => {
    const filas = es.map((e) => ({ label: e.clave, vals: sumas(cols, e) }))
    const n = grupos.reduce((a, g) => a + g.subs.length, 0) * 3
    return { titulo, primera: 'Escuela', grupos, filas, total: Array.from({ length: n }, (_, i) => filas.reduce((a, f) => a + f.vals[i], 0)) }
  }

  if (cfg.tipo === 'planes') {
    return planes.map((p) => {
      const cur = cursos.filter((c) => c.plan_id === p.id)
      const grupos: RepGrupo[] = [...cur.map((c) => ({ label: c.nombre, subs: siglas })), { label: 'Total', subs: [...cur.map((c) => c.nombre), 'Total'] }]
      return tabla(p.nombre, grupos, cur.map((c) => ({ ids: new Set([c.id]) })))
    })
  }

  // Secundaria: un solo cuadro sin turnos; los planes de cada ciclo se reconocen por nombre
  // y sus cursos se unen por número de año (o por nombre si no empiezan con número)
  const cols: { ciclo: number; clave: string; nombre: string; ids: Set<number> }[] = []
  for (const p of planes) {
    const ciclo = cicloDe(p.nombre)
    if (ciclo < 0) continue
    for (const c of cursos.filter((x) => x.plan_id === p.id)) {
      const clave = claveCurso(c.nombre)
      const ex = cols.find((x) => x.ciclo === ciclo && x.clave === clave)
      if (ex) ex.ids.add(c.id)
      else cols.push({ ciclo, clave, nombre: c.nombre, ids: new Set([c.id]) })
    }
  }
  const ord = (c: { ciclo: number; clave: string }) => (/^\d+$/.test(c.clave) ? Number(c.clave) : 1000)
  cols.sort((a, b) => a.ciclo - b.ciclo || ord(a) - ord(b))
  const suma3 = (dd: Dato[], c: { ids: Set<number> }[]) => trio(dd.filter((d) => c.some((x) => x.ids.has(d.curso_id))))
  // Un cuadro por escuela y por curso, sin turnos: solo Sec/Mat/Asist
  const sinTurnos = (titulo: string, cs: typeof cols, conSup: boolean): RepTabla => {
    const grupos: RepGrupo[] = [...cs.map((c) => ({ ...(conSup ? { sup: CICLOS[c.ciclo] } : {}), label: c.nombre, subs: [] })), { ...(conSup ? { sup: 'Totales' } : {}), label: 'Total', subs: [] }]
    const filas = es.map((e) => {
      const dd = (datos.get(e.id) ?? []).filter(visibles)
      return { label: e.clave, vals: [...cs.flatMap((c) => suma3(dd, [c])), ...suma3(dd, cs)] }
    })
    return { titulo, primera: 'Escuela', grupos, filas, total: Array.from({ length: (cs.length + 1) * 3 }, (_, i) => filas.reduce((a, f) => a + f.vals[i], 0)) }
  }
  if (modo === 'general') return [sinTurnos(grupo.nombre, cols, true)]

  // Analítico: por escuela, cuatro cuadros (Ciclo Básico y Superior por curso > turno, Programas por curso, Totales)
  const out: RepTabla[] = []
  const porTurno = (cs: typeof cols): RepGrupo[] => [...cs.map((c) => ({ label: c.nombre, subs: siglas })), { label: 'Total', subs: [...cs.map((c) => c.nombre), 'Total'] }]
  const sumaFila = (filas: { vals: number[] }[], n: number) => Array.from({ length: n }, (_, i) => filas.reduce((a, f) => a + f.vals[i], 0))
  const ciclo = (n: number) => cols.filter((c) => c.ciclo === n)
  const planesDe = (n: number) => planes.filter((p) => cicloDe(p.nombre) === n)
  for (const e of es) {
    const dd = (datos.get(e.id) ?? []).filter(visibles)
    for (const n of [0, 1]) {
      const cs = ciclo(n)
      if (!cs.length) continue
      const filas = planesDe(n).map((p) => ({ label: p.nombre, vals: sumas(cs, e, p.id) }))
      out.push({ titulo: `${e.clave} · ${CICLOS[n]}`, primera: 'Plan de estudio', grupos: porTurno(cs), filas, total: sumaFila(filas, (cs.length * siglas.length + cs.length + 1) * 3) })
    }
    const prog = ciclo(2)
    if (prog.length) {
      const filas = planesDe(2).map((p) => {
        const dp = dd.filter((d) => d.plan_id === p.id)
        return { label: p.nombre, vals: [...prog.flatMap((c) => suma3(dp, [c])), ...suma3(dp, prog)] }
      })
      out.push({ titulo: `${e.clave} · ${CICLOS[2]}`, primera: 'Plan de estudio', grupos: [...prog.map((c) => ({ label: c.nombre, subs: [] })), { label: 'Total', subs: [] }], filas, total: sumaFila(filas, (prog.length + 1) * 3) })
    }
    const vals = suma3(dd, cols)
    out.push({ titulo: `${e.clave} · Totales`, primera: 'Escuela', grupos: [{ label: 'Total de la escuela', subs: [] }], filas: [{ label: e.clave, vals }], total: vals })
  }
  return out
}

export function TablaReporte({ t }: { t: RepTabla }) {
  const th = 'border border-slate-300 bg-sky-100 px-1.5 py-1 text-center text-xs font-semibold'
  const td = 'border border-slate-200 px-1.5 py-1 text-right tabular-nums'
  const sub = ['Sec', 'Mat', 'Asist']
  const conSup = t.grupos.some((g) => g.sup !== undefined)
  const conSubs = t.grupos.some((g) => g.subs.length > 0)
  const filasTh = (conSubs ? 3 : 2)
  const sups: [string, number][] = []
  t.grupos.forEach((g, i) => {
    const w = Math.max(g.subs.length, 1) * 3
    if (i && g.sup === t.grupos[i - 1].sup) sups[sups.length - 1][1] += w
    else sups.push([g.sup ?? '', w])
  })
  return (
    <div class="overflow-x-auto">
      <table class="border-collapse text-xs">
        <thead>
          {conSup && (
            <tr>
              <th rowSpan={filasTh + 1} class={th + ' sticky left-0 z-10 min-w-24 text-left'}>{t.primera}</th>
              {sups.map(([label, w], i) => <th key={i} colSpan={w} class={th}>{label}</th>)}
            </tr>
          )}
          <tr>
            {!conSup && <th rowSpan={filasTh} class={th + ' sticky left-0 z-10 min-w-24 text-left'}>{t.primera}</th>}
            {t.grupos.map((g) => <th key={g.label} colSpan={Math.max(g.subs.length, 1) * 3} class={th}>{g.label}</th>)}
          </tr>
          {conSubs && <tr>{t.grupos.flatMap((g) => g.subs.map((s) => <th key={g.label + s} colSpan={3} class={th}>{s}</th>))}</tr>}
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
  const cfg = grupo ? CFG[norm(grupo.nombre)] : undefined
  const tab = cfg?.tabs?.find(([id]) => id === params.get('rt'))?.[0] ?? cfg?.tabs?.[0][0]
  const definido = !!cfg
  const rep = useAsync(async () => (per && grupo && definido ? armar(per, grupo, escuelas, tab ?? 'general') : null), [per?.id, grupo?.id, definido, tab])

  if (!periodos.length || !grupos.length) return <Card><EmptyState title="Sin datos para reportar" text="Se necesita al menos un período y un agrupamiento." /></Card>
  const sufijo = cfg?.tabs ? ` · ${cfg.tabs.find(([id]) => id === tab)?.[1]}` : ''
  const nombre = per && grupo ? `Matrícula ${grupo.nombre}${sufijo} · ${nombrePeriodo(per)}` : ''
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
      {cfg?.tabs && per && (
        <TabBar label="Tipo de reporte" class="mt-3" items={cfg.tabs.map(([id, label]) => ({ id, label, icon: id === 'general' ? 'layers' as const : 'search' as const, color: id === 'general' ? 'sky' as const : 'violet' as const }))} active={tab ?? ''} onChange={(id) => setParams({ rt: id === cfg.tabs![0][0] ? null : id })} />
      )}
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
