import { supabase, check } from '../../lib/supabase'
import { useAsync } from '../../lib/hooks'
import { setParams, useRoute } from '../../lib/router'
import { descargarTabla } from '../../lib/download'
import type { Table } from '../../lib/export'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Spinner, toast } from '../../ui/kit'
import { Icon } from '../../ui/Icon'
import { nombrePeriodo, type Periodo } from './common'

interface Grupo { id: number; nombre: string; codigos: string[] }
interface Escuela { id: number; codigo: string | null }
interface Carga { escuela_id: number; matricula_datos: Dato[] }
interface Dato { secciones: number; matricula: number; inclusion: number; asistencia: number }
interface Fila { nombre: string; secciones: number; estudiantes: number; asistencia: number; porcentaje: number }

const descargar = (tipo: 'xlsx' | 'pdf', tabla: Table, name: string) =>
  descargarTabla(tipo, tabla, name, 'Consolidación').catch((e) => toast.error(e.message))

export function Consolidacion({ periodos, grupos, escuelas }: { periodos: Periodo[]; grupos: Grupo[]; escuelas: Escuela[] }) {
  const { params } = useRoute()
  const periodo = periodos.find((p) => String(p.id) === params.get('rp')) ?? periodos[0]
  const { data, error, loading } = useAsync(async () => {
    const ids = escuelas.map((e) => e.id)
    if (!ids.length) return [] as Carga[]
    const cargas = await supabase.from('matricula_cargas')
      .select('escuela_id,matricula_datos(secciones,matricula,inclusion,asistencia)')
      .eq('ciclo', periodo.ciclo).eq('mes', periodo.mes)
      .not('confirmada_at', 'is', null).in('escuela_id', ids)
    return check(cargas) as unknown as Carga[]
  }, [periodo?.id, escuelas])

  if (!periodos.length) return <Card class="mt-3"><EmptyState title="Sin períodos de carga" text="Creá un período para generar la consolidación." /></Card>
  if (!periodo) return <Card class="mt-3"><EmptyState title="Sin período seleccionado" text="Elegí un período para continuar." /></Card>
  if (loading && !data) return <Spinner />
  if (error || !data) return <Alert tone="error">{error}</Alert>

  const cargaPorEscuela = new Map(data.map((k) => [k.escuela_id, k.matricula_datos]))
  const filas: Fila[] = grupos.map((g) => {
    const ids = escuelas.filter((e) => e.codigo && g.codigos.includes(e.codigo)).map((e) => e.id)
    const especial = g.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'especial'
    const datos = ids.flatMap((id) => cargaPorEscuela.get(id) ?? [])
    const secciones = datos.reduce((a, d) => a + d.secciones, 0)
    const estudiantes = datos.reduce((a, d) => a + d.matricula + (especial ? d.inclusion : 0), 0)
    const asistencia = datos.reduce((a, d) => a + d.asistencia, 0)
    return { nombre: g.nombre, secciones, estudiantes, asistencia, porcentaje: estudiantes ? Math.round(asistencia / estudiantes * 100) : 0 }
  })
  const totals = filas.reduce((a, f) => ({
    secciones: a.secciones + f.secciones,
    estudiantes: a.estudiantes + f.estudiantes,
    asistencia: a.asistencia + f.asistencia,
  }), { secciones: 0, estudiantes: 0, asistencia: 0 })
  const total: Fila = {
    nombre: 'TOTAL GENERAL',
    ...totals,
    porcentaje: totals.estudiantes ? Math.round(totals.asistencia / totals.estudiantes * 100) : 0,
  }
  const tabla: Table = {
    title: `Consolidación de Matrícula · ${nombrePeriodo(periodo)}`,
    subtitle: 'Cargas confirmadas de todos los agrupamientos. Estudiantes en Especial = matrícula sede + matrícula con inclusión. % asistencia = asistencia / estudiantes, redondeado al entero.',
    headers: ['Agrupamiento', 'Secciones', 'Estudiantes', 'Asistencia', '% Asistencia'],
    widths: [3, 1.2, 1.4, 1.2, 1.2],
    rows: [
      ...filas.map((f) => [f.nombre, String(f.secciones), String(f.estudiantes), String(f.asistencia), `${f.porcentaje}%`]),
      ['TOTAL GENERAL', String(total.secciones), String(total.estudiantes), String(total.asistencia), `${total.porcentaje}%`],
    ],
  }
  const bajar = (tipo: 'xlsx' | 'pdf') => descargar(tipo, tabla, `consolidacion-matricula-${periodo.ciclo}-${String(periodo.mes).padStart(2, '0')}`)

  return (
    <div class="mt-3 space-y-3">
      <Card>
        <div class="flex flex-wrap items-end justify-between gap-3">
          <Lbl label="Período">
            <select class={FIELD} aria-label="Período de consolidación" value={periodo.id} onChange={(e) => setParams({ rp: e.currentTarget.value || null })}>
              {periodos.map((p) => <option key={p.id} value={p.id}>{nombrePeriodo(p)}</option>)}
            </select>
          </Lbl>
          <div class="flex gap-2">
            <button class={BTN_PRIMARY} onClick={() => bajar('xlsx')}><Icon name="download" class="size-5" />Excel</button>
            <button class={BTN_SECONDARY} onClick={() => bajar('pdf')}><Icon name="download" class="size-5" />PDF</button>
          </div>
        </div>
      </Card>
      <Card title={`Consolidación · ${nombrePeriodo(periodo)}`}>
        {!filas.length ? <EmptyState title="Sin agrupamientos" text="No hay agrupamientos configurados." /> : (
          <div class="-m-4 overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>{tabla.headers.map((h, i) => <th key={h} class={`px-3 py-2 ${i ? 'text-right' : ''}`}>{h}</th>)}</tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                {filas.map((f) => (
                  <tr key={f.nombre}>
                    <td class="px-3 py-2.5 font-medium">{f.nombre}</td>
                    <td class="px-3 py-2.5 text-right tabular-nums">{f.secciones}</td>
                    <td class="px-3 py-2.5 text-right tabular-nums">{f.estudiantes}</td>
                    <td class="px-3 py-2.5 text-right tabular-nums">{f.asistencia}</td>
                    <td class="px-3 py-2.5 text-right tabular-nums">{f.porcentaje}%</td>
                  </tr>
                ))}
                <tr class="bg-slate-100 font-bold">
                  <td class="px-3 py-2.5">TOTAL GENERAL</td>
                  <td class="px-3 py-2.5 text-right tabular-nums">{total.secciones}</td>
                  <td class="px-3 py-2.5 text-right tabular-nums">{total.estudiantes}</td>
                  <td class="px-3 py-2.5 text-right tabular-nums">{total.asistencia}</td>
                  <td class="px-3 py-2.5 text-right tabular-nums">{total.porcentaje}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p class="mt-6 text-xs text-slate-500">Cada fila muestra el subtotal de su agrupamiento. Porcentaje de asistencia = asistencia ÷ estudiantes × 100, redondeado al entero más cercano. Solo se incluyen cargas confirmadas; las escuelas sin carga cuentan como cero.</p>
      </Card>
    </div>
  )
}
