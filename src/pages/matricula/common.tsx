import { useState } from 'preact/hooks'
import { supabase, check, checkOpt } from '../../lib/supabase'
import { useAsync } from '../../lib/hooks'
import { descargarMatriz, type FilaMatriz } from '../../lib/download'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, Modal, Spinner, toast } from '../../ui/kit'
import { Icon } from '../../ui/Icon'

export const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const MAXV = 99999
export const fdia = (s?: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—')
export const hoyAR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)

export interface Periodo { id: number; ciclo: number; mes: number; fecha_apertura: string; fecha_cierre: string; carga: boolean }
export const nombrePeriodo = (p: { mes: number; ciclo: number }) => `${MESES[p.mes]} ${p.ciclo}`

export type Fila = FilaMatriz

export async function cargaFilas(cargaId: number): Promise<Fila[]> {
  const r = check(await supabase.from('matricula_datos')
    .select('secciones,matricula,inclusion,asistencia,planes_estudio(nombre),planes_cursos(nombre,orden),turnos(nombre,hora_desde)').eq('carga_id', cargaId))
  return r.map((x: any) => ({ plan: x.planes_estudio.nombre, curso: x.planes_cursos.nombre, turno: x.turnos.nombre, hora: x.turnos.hora_desde ?? null, secciones: x.secciones, matricula: x.matricula, inclusion: x.inclusion, asistencia: x.asistencia, _o: x.planes_cursos.orden }))
    .sort((a: any, b: any) => a.plan.localeCompare(b.plan) || a._o - b._o)
}

const sum = (rs: Fila[], f: 'secciones' | 'matricula' | 'inclusion' | 'asistencia') => rs.reduce((a, r) => a + (r[f] ?? 0), 0)

/** Cuadro cruzado: cursos × turnos, con secciones, matrícula y asistencia, subtotales y totales */
export function CuadroCarga({ filas, especial = false }: { filas: Fila[]; especial?: boolean }) {
  const planes = [...new Set(filas.map((f) => f.plan))]
  return (
    <div class="space-y-4">
      {planes.map((pl) => {
        const rs = filas.filter((f) => f.plan === pl)
        const turnos = [...new Map(rs.slice().sort((x, y) => String(x.hora ?? '99').localeCompare(String(y.hora ?? '99')) || x.turno.localeCompare(y.turno)).map((f) => [f.turno, f.turno])).keys()]
        const cursos = [...new Set(rs.map((f) => f.curso))]
        const tot = (p: (f: Fila) => boolean) => ({ secciones: sum(rs.filter(p), 'secciones'), matricula: sum(rs.filter(p), 'matricula'), inclusion: sum(rs.filter(p), 'inclusion'), asistencia: sum(rs.filter(p), 'asistencia') })
        const Tres = ({ v, cls = '' }: { v?: { secciones: number; matricula: number; inclusion?: number; asistencia: number }; cls?: string }) => (
          <>
            <td class={'border-l border-slate-200 px-2 py-2 text-right ' + cls}>{v ? v.secciones : '—'}</td>
            <td class={'px-2 py-2 text-right ' + cls}>{v ? v.matricula : '—'}</td>
            {especial && <td class={'px-2 py-2 text-right ' + cls}>{v ? v.inclusion ?? 0 : '—'}</td>}
            <td class={'px-2 py-2 text-right ' + cls}>{v ? v.asistencia : '—'}</td>
          </>
        )
        const medidas = especial ? ['Secc.', 'Matr.', 'Incl.', 'Asist.'] : ['Secc.', 'Matr.', 'Asist.']
        const ancho = medidas.length
        return (
          <Card key={pl} title={pl}>
            <div class="-mx-4 overflow-x-auto px-4">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th rowSpan={2} class="py-2 pr-3 align-bottom">Curso</th>
                    {turnos.map((t) => <th key={t} colSpan={ancho} class="border-l border-slate-200 px-2 py-2 text-center">{t}</th>)}
                    <th colSpan={ancho} class="border-l border-slate-300 px-2 py-2 text-center text-slate-700">Total curso</th>
                  </tr>
                  <tr>{[...turnos, 'Total'].map((t) => medidas.map((h, j) => <th key={t + h} class={'px-2 pb-2 text-right font-medium ' + (j === 0 ? 'border-l border-slate-200' : '')}>{h}</th>))}</tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  {cursos.map((cu) => (
                    <tr key={cu}>
                      <td class="whitespace-nowrap py-2 pr-3 font-medium">{cu}</td>
                      {turnos.map((t) => { const f = rs.find((x) => x.curso === cu && x.turno === t); return <Tres key={t} v={f} /> })}
                      <Tres v={tot((f) => f.curso === cu)} cls="bg-slate-50 font-semibold" />
                    </tr>
                  ))}
                  <tr class="bg-slate-100 font-semibold">
                    <td class="py-2 pr-3">Total del plan</td>
                    {turnos.map((t) => <Tres key={t} v={tot((f) => f.turno === t)} />)}
                    <Tres v={tot(() => true)} />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        )
      })}
      <p class="rounded-md bg-sky-50 p-3 text-sm text-sky-900">Total general: <strong>{sum(filas, 'secciones')}</strong> secciones · <strong>{sum(filas, 'matricula')}</strong> de matrícula{especial && <> · <strong>{sum(filas, 'inclusion')}</strong> de inclusión</>} · <strong>{sum(filas, 'asistencia')}</strong> de asistencia.</p>
    </div>
  )
}

export const bajarCarga = (tipo: 'xlsx' | 'pdf', filas: Fila[], periodo: { mes: number; ciclo: number }, clave: string, confirmada?: string | null, especial = false) =>
  descargarMatriz(tipo, `Matrícula ${nombrePeriodo(periodo)}`, `Escuela ${clave} · Confirmada el ${fdia(confirmada)}`, filas, `matricula-${clave}-${periodo.ciclo}-${String(periodo.mes).padStart(2, '0')}`.replace(/[^\w-]/g, '_'), especial).catch((e) => toast.error(e.message))

export function DescargasCarga({ filas, periodo, clave, confirmada, especial = false }: { filas: Fila[]; periodo: { mes: number; ciclo: number }; clave: string; confirmada?: string | null; especial?: boolean }) {
  return (
    <div class="flex gap-2">
      <button class={BTN_PRIMARY} onClick={() => bajarCarga('xlsx', filas, periodo, clave, confirmada, especial)}><Icon name="download" class="size-5" />Excel</button>
      <button class={BTN_SECONDARY} onClick={() => bajarCarga('pdf', filas, periodo, clave, confirmada, especial)}><Icon name="download" class="size-5" />PDF</button>
    </div>
  )
}

/** Vista de una carga confirmada con descargas */
export function VistaCarga({ cargaId, volver }: { cargaId: number; volver(): void }) {
  const { data, error, loading } = useAsync(async () => {
    const k = check(await supabase.from('matricula_cargas').select('id,ciclo,mes,confirmada_at,escuelas(clave,codigo)').eq('id', cargaId).single()) as any
    return { k, filas: await cargaFilas(cargaId) }
  }, [cargaId])
  if (loading && !data) return <Spinner />
  if (error || !data) return <Alert tone="error">{error}</Alert>
  const { k, filas } = data
  return (
    <>
      <button class="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline" onClick={volver}>← Volver</button>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold tracking-tight sm:text-2xl">Matrícula {nombrePeriodo(k)}</h1>
          <p class="text-sm text-slate-500">{k.escuelas.clave} · Confirmada el {fdia(k.confirmada_at)}</p>
        </div>
        <DescargasCarga filas={filas} periodo={k} clave={k.escuelas.clave} confirmada={k.confirmada_at} especial={['EE', 'EL', 'ET'].includes(k.escuelas.codigo)} />
      </div>
      <CuadroCarga filas={filas} especial={['EE', 'EL', 'ET'].includes(k.escuelas.codigo)} />
    </>
  )
}

interface Celda { plan_id: number; plan: string; curso_id: number; curso: string; orden: number; turno_id: number; turno: string; hora: string | null; secciones: number }

/** Formulario de carga: una celda de matrícula y asistencia por cada curso/turno con secciones en la planta */
export function FormCarga({ escuelaId, ciclo, mes, editable, clave, onSaved }: { escuelaId: number; ciclo: number; mes: number; editable: boolean; clave: string; onSaved(): void }) {
  const { data, error, loading } = useAsync(async () => {
    const pl: { id: number } | null = checkOpt(await supabase.from('plantas').select('id').eq('escuela_id', escuelaId).maybeSingle())
    if (!pl) return null
    const escuela = check(await supabase.from('escuelas').select('codigo').eq('id', escuelaId).single()) as { codigo: string | null }
    const especial = ['EE', 'EL', 'ET'].includes(escuela.codigo ?? '')
    const ps = check(await supabase.from('planta_secciones').select('plan_id,curso_id,turno_id,secciones,planes_estudio(nombre),planes_cursos(nombre,orden),turnos(nombre,hora_desde)').eq('planta_id', pl.id).gt('secciones', 0)) as any[]
    const celdas: Celda[] = ps.map((x) => ({ plan_id: x.plan_id, plan: x.planes_estudio.nombre, curso_id: x.curso_id, curso: x.planes_cursos.nombre, orden: x.planes_cursos.orden, turno_id: x.turno_id, turno: x.turnos.nombre, hora: x.turnos.hora_desde, secciones: x.secciones }))
      .sort((a, b) => a.plan.localeCompare(b.plan) || a.orden - b.orden)
    const k: { id: number; confirmada_at: string | null } | null = checkOpt(await supabase.from('matricula_cargas').select('id,confirmada_at').eq('escuela_id', escuelaId).eq('ciclo', ciclo).eq('mes', mes).maybeSingle())
    const vals: Record<string, { m: string; i: string; a: string }> = {}
    if (k) for (const d of check(await supabase.from('matricula_datos').select('curso_id,turno_id,matricula,inclusion,asistencia').eq('carga_id', k.id))) vals[`${d.curso_id}:${d.turno_id}`] = { m: String(d.matricula), i: String(d.inclusion), a: String(d.asistencia) }
    return { celdas, vals, confirmada: k?.confirmada_at ?? null, especial }
  }, [escuelaId, ciclo, mes])
  if (loading && !data) return <Spinner />
  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <Card><EmptyState title="Primero configurá la planta" text="Para cargar la matrícula la escuela tiene que tener confirmada su planta." /></Card>
  return <Form key={`${ciclo}-${mes}-${data.confirmada}`} {...{ escuelaId, ciclo, mes, editable, clave, onSaved }} celdas={data.celdas} inicial={data.vals} confirmada={data.confirmada} especial={data.especial} />
}

function Form({ escuelaId, ciclo, mes, editable, clave, onSaved, celdas, inicial, confirmada, especial }: { escuelaId: number; ciclo: number; mes: number; editable: boolean; clave: string; onSaved(): void; celdas: Celda[]; inicial: Record<string, { m: string; i: string; a: string }>; confirmada: string | null; especial: boolean }) {
  const [vals, setVals] = useState(inicial)
  const [prev, setPrev] = useState(false)
  const [saving, setSaving] = useState(false)
  const key = (c: Celda) => `${c.curso_id}:${c.turno_id}`
  const num = (c: Celda, f: 'm' | 'i' | 'a') => parseInt(vals[key(c)]?.[f], 10) || 0
  const excede = (c: Celda) => { const v = vals[key(c)]; return !!v && v.m !== '' && v.a !== '' && parseInt(v.a, 10) > parseInt(v.m, 10) }
  const planes = [...new Set(celdas.map((c) => c.plan))]
  const turnos = [...new Map(celdas.slice().sort((a, b) => String(a.hora ?? '99').localeCompare(String(b.hora ?? '99')) || a.turno.localeCompare(b.turno)).map((c) => [c.turno_id, c.turno])).entries()]
  const filas: Fila[] = celdas.map((c) => ({ plan: c.plan, curso: c.curso, turno: c.turno, hora: c.hora, secciones: c.secciones, matricula: num(c, 'm'), inclusion: especial ? num(c, 'i') : undefined, asistencia: num(c, 'a') }))
  const set = (c: Celda, f: 'm' | 'i' | 'a', v: string) => setVals({ ...vals, [key(c)]: { ...(vals[key(c)] ?? { m: '', i: '', a: '' }), [f]: v } })

  const revisar = () => {
    const mal = celdas.find(excede)
    if (mal) return toast.error(`La asistencia no puede ser mayor que la matrícula (${mal.curso} · ${mal.turno})`)
    if (celdas.some((c) => !vals[key(c)] || vals[key(c)].m === '' || vals[key(c)].a === '' || (especial && vals[key(c)].i === ''))) return toast.error(`Completá la matrícula${especial ? ', inclusión' : ''} y la asistencia de todos los cursos (usá 0 si no hay)`)
    if (celdas.some((c) => num(c, 'm') > MAXV || num(c, 'a') > MAXV || (especial && num(c, 'i') > MAXV))) return toast.error(`Los valores deben estar entre 0 y ${MAXV}`)
    setPrev(true)
  }
  const guardar = async () => {
    setSaving(true)
    const { error } = await supabase.rpc('matricula_guardar', { p_escuela: escuelaId, p_ciclo: ciclo, p_mes: mes, p_items: celdas.map((c) => ({ curso_id: c.curso_id, turno_id: c.turno_id, matricula: vals[key(c)].m, inclusion: especial ? vals[key(c)].i : '0', asistencia: vals[key(c)].a })) })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.ok('Matrícula guardada')
    setPrev(false)
    onSaved()
  }

  return (
    <div class="space-y-4">
      {confirmada && <p class="text-sm text-slate-500">Última confirmación: {fdia(confirmada)}</p>}
      {planes.map((pl) => {
        const cs = celdas.filter((c) => c.plan === pl)
        const cursos = [...new Map(cs.map((c) => [c.curso_id, c.curso])).entries()]
        return (
          <Card key={pl} title={`${pl} · ${MESES[mes]} ${ciclo}`}>
            <p class="-mt-1 mb-3 text-sm text-slate-600">Por cada curso y turno se indica la cantidad de secciones. Cargá la matrícula{especial && ' y la inclusión'} y la asistencia de ese grupo.</p>
            <div class="-mx-4 overflow-x-auto px-4">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 text-xs uppercase text-slate-500"><tr><th class="px-2 py-2">Curso</th>{turnos.map(([id, n]) => <th key={id} class="px-2 py-2 text-center">{n}</th>)}</tr></thead>
                <tbody class="divide-y divide-slate-100">
                  {cursos.map(([cid, cn]) => (
                    <tr key={cid}>
                      <td class="whitespace-nowrap px-2 py-2 align-top font-medium">{cn}</td>
                      {turnos.map(([tid, tn]) => {
                        const c = cs.find((x) => x.curso_id === cid && x.turno_id === tid)
                        if (!c) return <td key={tid} class="px-2 py-2 text-center text-slate-300">—</td>
                        const bad = excede(c)
                        return (
                          <td key={tid} class="min-w-40 px-2 py-2 align-top">
                            <p class="mb-1 text-center text-xs font-semibold text-sky-700">{c.secciones} {c.secciones === 1 ? 'sección' : 'secciones'}</p>
                            <div class={`grid ${especial ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5`}>
                              {(especial ? [['m', 'Matrícula'], ['i', 'Inclusión'], ['a', 'Asistencia']] as const : [['m', 'Matrícula'], ['a', 'Asistencia']] as const).map(([f, lab]) => (
                                <label key={f} class="block">
                                  <span class="block text-center text-[10px] uppercase text-slate-500">{lab}</span>
                                  <input type="number" min={0} max={MAXV} inputMode="numeric" disabled={!editable} aria-label={`${lab} ${cn} ${tn}`} value={vals[key(c)]?.[f] ?? ''}
                                    class={'min-h-11 w-full rounded-md border px-2 text-center text-base focus:outline-none focus:ring-2 disabled:bg-slate-50 sm:text-sm ' + (bad ? 'border-rose-500 ring-rose-200 focus:ring-rose-200' : 'border-slate-300 focus:border-sky-500 focus:ring-sky-200')}
                                    onInput={(e) => set(c, f, e.currentTarget.value)} />
                                </label>
                              ))}
                            </div>
                            {bad && <p class="mt-1 text-center text-xs font-medium text-rose-600">Asistencia mayor que matrícula</p>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      })}
      <Card class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-slate-600">Secciones: <strong class="text-slate-900">{sum(filas, 'secciones')}</strong> · Matrícula: <strong class="text-slate-900">{sum(filas, 'matricula')}</strong>{especial && <> · Inclusión: <strong class="text-slate-900">{sum(filas, 'inclusion')}</strong></>} · Asistencia: <strong class="text-slate-900">{sum(filas, 'asistencia')}</strong></p>
        {editable ? <button class={BTN_PRIMARY} onClick={revisar}>Revisar y confirmar</button> : <p class="text-sm font-medium text-amber-700">Carga deshabilitada</p>}
      </Card>
      {prev && (
        <Modal title={`Previsualización · ${MESES[mes]} ${ciclo} · ${clave}`} wide onClose={() => setPrev(false)}>
          <p class="mb-3 text-sm text-slate-500">Revisá los valores antes de confirmar.</p>
          <CuadroCarga filas={filas} especial={especial} />
          <div class="mt-4 flex justify-end gap-2">
            <button class={BTN_SECONDARY} onClick={() => setPrev(false)}>Volver a editar</button>
            <button class={BTN_PRIMARY} disabled={saving} onClick={guardar}>Confirmar y guardar</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
