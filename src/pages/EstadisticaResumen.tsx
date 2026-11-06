import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { coincideAgrupamiento, diferencia, fechaPba, numeroPba } from '../lib/estadisticaPba'
import { CATEGORIAS_FICHA, porcentajeTexto } from '../lib/estadisticaFichas'
import { nombreTrimestre } from '../lib/estadisticaDesempeno'
import { cargar, descargarTabla, mensaje, nombre, type Escuela } from './estadisticaDatos'
import { Alert, BTN_SECONDARY, Card, EmptyState, FIELD, PAGE_SIZE, Pager, Spinner, toast } from '../ui/kit'

interface Pba { clave: string; fecha: string; activa: number | null; anterior: number | null; inicial: number | null }
type Dato = Record<string, number | string | null>
interface Resumen {
  clave: string; escuela: Escuela
  activa: number | null; anterior: number | null; inicial: number | null
  fichas: number | null; salidas: number; sinCierre: number | null
  boletin: number | null; riesgo: number | null; aprobadas: number | null; trimestre: number | null
}

async function traer(tabla: string, campos: string, orden: string[]) {
  const filas: Dato[] = []
  const size = 1000
  for (let desde = 0; ; desde += size) {
    const r = await orden.reduce((c, col) => c.order(col), supabase.from(tabla).select(campos)).range(desde, desde + size - 1)
    if (r.error) throw r.error
    filas.push(...(r.data as unknown as Dato[]))
    if (r.data.length < size) break
  }
  return filas
}

const num = (v: unknown) => typeof v === 'number' ? v : null
const pct = (n: number, d: number) => d ? n * 100 / d : null
const suma = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0)
const maxFecha = (xs: Dato[]) => xs.reduce((m, x) => String(x.fecha) > m ? String(x.fecha) : m, '')
const colorAvance = (p: number | null) => p === null ? 'text-slate-500' : p >= 90 ? 'text-emerald-700' : p >= 70 ? 'text-amber-700' : 'text-red-700'
const colorRiesgo = (p: number | null) => p === null ? 'text-slate-500' : p <= 10 ? 'text-emerald-700' : p <= 25 ? 'text-amber-700' : 'text-red-700'
const colorDif = (n: number | null) => n === null || n === 0 ? 'text-slate-500' : n > 0 ? 'text-emerald-700' : 'text-red-700'
const flecha = (n: number | null) => n === null ? '' : n > 0 ? '▲ ' : n < 0 ? '▼ ' : '= '
const difTexto = (actual: number | null, base: number | null) => {
  const d = diferencia(actual, base)
  return d.valor === null ? 'Sin dato' : `${flecha(d.valor)}${d.valor > 0 ? '+' : ''}${d.valor.toLocaleString('es-AR')}${d.porcentaje === null ? '' : ` (${d.porcentaje.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%)`}`
}

async function cargarResumen(distrito: boolean) {
  const base = await cargar<Pba>(distrito, 'estadistica_matricula_pba', 'clave,fecha,activa,anterior,inicial')
  const [fichas, salidas, sinCierre, boletin, asistencia, desempeno] = await Promise.all([
    traer('estadistica_fichas_inscripcion', 'clave,fecha,' + CATEGORIAS_FICHA.map((c) => c.key).join(','), ['clave']),
    traer('estadistica_salidas_sin_ingreso', 'clave,fecha', ['id']),
    traer('estadistica_matricula_sin_cierre', 'clave,fecha,sin_cierre', ['clave']),
    traer('estadistica_boletin_digital', 'clave,fecha,completo,parcial,sin_carga', ['clave']),
    traer('estadistica_asistencia', 'clave,fecha,matricula,de_28_44,mas_45', ['clave', 'anio']),
    traer('estadistica_desempeno', 'clave,fecha,ciclo,trimestre,matricula,aprobadas', ['clave', 'ciclo', 'trimestre', 'anio']),
  ])
  const porClave = <T extends Dato>(xs: T[]) => {
    const m = new Map<string, T[]>()
    for (const x of xs) {
      const k = String(x.clave)
      if (!base.claves.has(k)) continue
      m.set(k, [...(m.get(k) ?? []), x])
    }
    return m
  }
  const mPba = new Map(base.filas.map((f) => [f.clave, f]))
  const mFichas = porClave(fichas), mSalidas = porClave(salidas), mCierre = porClave(sinCierre)
  const mBoletin = porClave(boletin), mAsist = porClave(asistencia), mDesempeno = porClave(desempeno)
  const ciclo = desempeno.reduce((m, d) => Math.max(m, num(d.ciclo) ?? 0), 0)
  const resumenes: Resumen[] = [...base.claves].map(([clave, escuela]) => {
    const p = mPba.get(clave)
    const f = mFichas.get(clave)?.[0]
    const c = mCierre.get(clave)?.[0]
    const b = mBoletin.get(clave)?.[0]
    const a = mAsist.get(clave)
    const d = (mDesempeno.get(clave) ?? []).filter((x) => num(x.ciclo) === ciclo)
    const trimestre = d.reduce<number | null>((m, x) => Math.max(m ?? 0, num(x.trimestre) ?? 0), null)
    const dt = d.filter((x) => num(x.trimestre) === trimestre)
    const totalB = b ? suma([num(b.completo), num(b.parcial), num(b.sin_carga)]) : 0
    const matA = a ? suma(a.map((x) => num(x.matricula))) : 0
    const matD = suma(dt.map((x) => num(x.matricula)))
    return {
      clave, escuela,
      activa: p?.activa ?? null, anterior: p?.anterior ?? null, inicial: p?.inicial ?? null,
      fichas: f ? suma(CATEGORIAS_FICHA.map((k) => num(f[k.key]))) : null,
      salidas: mSalidas.get(clave)?.length ?? 0,
      sinCierre: c ? num(c.sin_cierre) : null,
      boletin: b && totalB ? pct(num(b.completo) ?? 0, totalB) : null,
      riesgo: a && matA ? pct(suma(a.map((x) => suma([num(x.de_28_44), num(x.mas_45)]))), matA) : null,
      aprobadas: dt.length && matD ? pct(suma(dt.map((x) => num(x.aprobadas))), matD) : null,
      trimestre,
    }
  }).sort((x, y) => x.clave.localeCompare(y.clave))
  const fechas = {
    'Matrícula PBA': maxFecha(base.filas as unknown as Dato[]), 'Fichas': maxFecha(fichas), 'Salidas': maxFecha(salidas),
    'Sin cerrar': maxFecha(sinCierre), 'Boletín': maxFecha(boletin), 'Asistencia': maxFecha(asistencia), 'Desempeño': maxFecha(desempeno),
  }
  return { base, resumenes, fechas, ciclo }
}

const ORDENES: [string, string][] = [
  ['clave', 'Ordenar por clave'], ['matricula', 'Mayor matrícula'], ['fichas', 'Más fichas con faltantes'], ['salidas', 'Más salidas sin ingreso'],
  ['sincierre', 'Más matrícula sin cerrar'], ['boletin', 'Menor % boletín completo'], ['riesgo', 'Mayor % asistencia en riesgo'], ['desempeno', 'Menor % aprobadas'],
]

export function ReporteDistrital({ distrito }: { distrito: boolean }) {
  const { data, loading, error } = useAsync(() => cargarResumen(distrito), [distrito])
  const [q, setQ] = useState('')
  const [inspector, setInspector] = useState('')
  const [grupo, setGrupo] = useState('')
  const [escuela, setEscuela] = useState('')
  const [orden, setOrden] = useState('clave')
  const [pagina, setPagina] = useState(1)

  const filas = useMemo(() => {
    if (!data) return []
    const buscar = q.trim().toLocaleLowerCase('es-AR')
    const seleccion = inspector && distrito ? data.base.inspectores.find((i) => String(i.id) === inspector) : undefined
    const asignadas = inspector && distrito ? new Set(seleccion?.escuelas_asignadas ?? []) : null
    const codigos = grupo ? new Set(data.base.codigosGrupo.filter((c) => String(c.agrupamiento_id) === grupo).map((c) => c.codigo)) : null
    const mayor = (f: (r: Resumen) => number | null, asc = false) => (a: Resumen, b: Resumen) => {
      const x = f(a), y = f(b)
      if (x === null) return y === null ? a.clave.localeCompare(b.clave) : 1
      if (y === null) return -1
      return (asc ? x - y : y - x) || a.clave.localeCompare(b.clave)
    }
    const criterio = {
      matricula: mayor((r) => r.activa), fichas: mayor((r) => r.fichas), salidas: mayor((r) => r.salidas), sincierre: mayor((r) => r.sinCierre),
      boletin: mayor((r) => r.boletin, true), riesgo: mayor((r) => r.riesgo), desempeno: mayor((r) => r.aprobadas, true),
    }[orden]
    return data.resumenes.filter((r) =>
      (!escuela || r.clave === escuela) && (!asignadas || asignadas.has(r.clave)) &&
      coincideAgrupamiento(data.base.codigosPorClave.get(r.clave), codigos) &&
      [r.clave, r.escuela.cue, r.escuela.codigo, r.escuela.numero, r.escuela.nombre, r.escuela.localidad].join(' ').toLocaleLowerCase('es-AR').includes(buscar))
      .sort(criterio ?? ((a, b) => a.clave.localeCompare(b.clave)))
  }, [data, q, inspector, grupo, escuela, orden, distrito])

  const total = useMemo(() => {
    const con = (f: (r: Resumen) => number | null) => filas.filter((r) => f(r) !== null)
    const act = con((r) => r.activa)
    const ini = filas.filter((r) => r.activa !== null && r.inicial !== null)
    const ant = filas.filter((r) => r.activa !== null && r.anterior !== null)
    return {
      activa: suma(act.map((r) => r.activa)),
      conInicial: suma(ini.map((r) => r.activa)), inicial: suma(ini.map((r) => r.inicial)),
      conAnterior: suma(ant.map((r) => r.activa)), anterior: suma(ant.map((r) => r.anterior)),
      fichas: suma(filas.map((r) => r.fichas)), salidas: suma(filas.map((r) => r.salidas)), sinCierre: suma(filas.map((r) => r.sinCierre)),
      boletin: filas.length ? (con((r) => r.boletin).length ? suma(con((r) => r.boletin).map((r) => r.boletin)) / con((r) => r.boletin).length : null) : null,
      riesgo: con((r) => r.riesgo).length ? suma(con((r) => r.riesgo).map((r) => r.riesgo)) / con((r) => r.riesgo).length : null,
      aprobadas: con((r) => r.aprobadas).length ? suma(con((r) => r.aprobadas).map((r) => r.aprobadas)) / con((r) => r.aprobadas).length : null,
    }
  }, [filas])

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    try {
      const seleccionado = distrito && inspector ? data?.base.inspectores.find((i) => String(i.id) === inspector) : undefined
      const agrupamiento = data?.base.grupos.find((g) => String(g.id) === grupo)
      const filtros = [seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`, escuela && `Escuela: ${escuela}`].filter(Boolean).join(' · ')
      const trim = (r: Resumen) => r.trimestre ? nombreTrimestre(r.trimestre) : ''
      await descargarTabla(tipo, 'reporte-distrital', 'Reporte distrital', 'Reporte Distrital', `${filas.length} escuelas · ${filtros || 'datos filtrados'}`,
        ['Clave', 'CUE', 'Escuela', 'Matrícula activa', 'Dif. inicial', 'Dif. ciclo anterior', 'Fichas con faltantes', 'Salidas sin ingreso', 'Matrícula sin cerrar', '% boletín completo', '% asistencia en riesgo', `% aprobadas ${data?.ciclo ?? ''}`, 'Último trimestre'],
        [13, 13, 28, 12, 18, 18, 12, 12, 12, 12, 12, 12, 14],
        filas.map((r) => [r.clave, r.escuela.cue, nombre(r.escuela), r.activa, diferencia(r.activa, r.inicial).valor, diferencia(r.activa, r.anterior).valor, r.fichas, r.salidas, r.sinCierre, r.boletin === null ? null : Math.round(r.boletin * 10) / 10, r.riesgo === null ? null : Math.round(r.riesgo * 10) / 10, r.aprobadas === null ? null : Math.round(r.aprobadas * 10) / 10, trim(r)]),
        filas.map((r) => [r.clave, nombre(r.escuela), numeroPba(r.activa), difTexto(r.activa, r.inicial), difTexto(r.activa, r.anterior), numeroPba(r.fichas), String(r.salidas), numeroPba(r.sinCierre), porcentajeTexto(r.boletin), porcentajeTexto(r.riesgo), porcentajeTexto(r.aprobadas)]))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  const tarjetas: [string, string, string][] = data ? [
    ['Matrícula activa', numeroPba(total.activa), 'text-slate-900'],
    ['Vs. relevamiento inicial', difTexto(total.conInicial, total.inicial), colorDif(total.conInicial - total.inicial)],
    ['Vs. ciclo anterior', difTexto(total.conAnterior, total.anterior), colorDif(total.conAnterior - total.anterior)],
    ['Fichas con datos faltantes', numeroPba(total.fichas), 'text-indigo-700'],
    ['Salidas sin ingreso', numeroPba(total.salidas), 'text-rose-700'],
    ['Matrícula sin cerrar', numeroPba(total.sinCierre), 'text-amber-700'],
    ['Boletín completo (prom.)', porcentajeTexto(total.boletin), colorAvance(total.boletin)],
    ['Asistencia en riesgo (prom.)', porcentajeTexto(total.riesgo), colorRiesgo(total.riesgo)],
    [`Aprobadas ${data.ciclo || ''} (prom.)`, porcentajeTexto(total.aprobadas), colorAvance(total.aprobadas)],
  ] : []

  return (
    <>
      <Card title="Reporte Distrital">
        <p class="text-sm text-slate-600">Resumen general de todas las pestañas de Estadística. Los totales y las tablas respetan los filtros elegidos.</p>
      </Card>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      {loading && !data ? <Spinner /> : data && <>
        <div class={`mt-4 grid gap-2 sm:grid-cols-2 ${distrito ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
          <input class={FIELD} type="search" aria-label="Buscar escuela" placeholder="Buscar por escuela, clave, CUE o localidad" value={q} onInput={(e) => { setQ(e.currentTarget.value); setPagina(1) }} />
          <select class={FIELD} aria-label="Filtrar por escuela" value={escuela} onChange={(e) => { setEscuela(e.currentTarget.value); setPagina(1) }}>
            <option value="">Todas las escuelas</option>
            {data.resumenes.map((r) => <option key={r.clave} value={r.clave}>{nombre(r.escuela)} · {r.clave}</option>)}
          </select>
          {distrito && <select class={FIELD} aria-label="Filtrar por inspector" value={inspector} onChange={(e) => { setInspector(e.currentTarget.value); setPagina(1) }}>
            <option value="">Todos los inspectores</option>
            {data.base.inspectores.map((i) => <option key={i.id} value={i.id}>{i.nombre || i.cuil}</option>)}
          </select>}
          <select class={FIELD} aria-label="Filtrar por agrupamiento de matrícula" value={grupo} onChange={(e) => { setGrupo(e.currentTarget.value); setPagina(1) }}>
            <option value="">Todos los agrupamientos</option>
            {data.base.grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
          </select>
          <select class={FIELD} aria-label="Ordenar escuelas" value={orden} onChange={(e) => { setOrden(e.currentTarget.value); setPagina(1) }}>
            {ORDENES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <Card class="mt-4" title={`Resumen según filtros · ${filas.length} escuelas`}>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tarjetas.map(([t, v, c]) => <div key={t} class="rounded-lg border border-slate-200 bg-white p-3 text-center"><div class={`text-xl font-bold ${c}`}>{v}</div><div class="text-xs text-slate-500">{t}</div></div>)}
          </div>
          <p class="mt-3 text-xs text-slate-500">Datos al: {Object.entries(data.fechas).map(([k, f]) => `${k} ${f ? fechaPba(f) : 'sin datos'}`).join(' · ')}</p>
        </Card>
        <Card class="mt-4" title={`Escuelas · ${filas.length}`} action={<div class="flex flex-wrap gap-2">
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('xlsx')}>Excel</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('pdf')}>PDF</button>
        </div>}>
          {!filas.length ? <EmptyState title="Sin datos" text="Probá con otros filtros." /> : (
            <div class="-m-4 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {['Escuela', 'Matrícula', 'Vs. inicial', 'Vs. anterior', 'Fichas', 'Salidas', 'Sin cerrar', 'Boletín', 'Asistencia', 'Desempeño'].map((h) => <th key={h} class="whitespace-nowrap px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => {
                  const i = diferencia(r.activa, r.inicial).valor, a = diferencia(r.activa, r.anterior).valor
                  return <tr key={r.clave} class="hover:bg-slate-50">
                    <td class="min-w-44 px-3 py-2.5"><span class="font-semibold">{nombre(r.escuela)}</span><span class="block font-mono text-xs text-slate-500">{r.clave} · {r.escuela.cue}</span></td>
                    <td class="px-3 py-2.5 font-medium">{numeroPba(r.activa)}</td>
                    <td class={`whitespace-nowrap px-3 py-2.5 font-medium ${colorDif(i)}`}>{difTexto(r.activa, r.inicial)}</td>
                    <td class={`whitespace-nowrap px-3 py-2.5 font-medium ${colorDif(a)}`}>{difTexto(r.activa, r.anterior)}</td>
                    <td class="px-3 py-2.5">{numeroPba(r.fichas)}</td>
                    <td class="px-3 py-2.5">{r.salidas}</td>
                    <td class="px-3 py-2.5">{numeroPba(r.sinCierre)}</td>
                    <td class={`px-3 py-2.5 font-semibold ${colorAvance(r.boletin)}`}>{porcentajeTexto(r.boletin)}</td>
                    <td class={`px-3 py-2.5 font-semibold ${colorRiesgo(r.riesgo)}`}>{porcentajeTexto(r.riesgo)}</td>
                    <td class={`whitespace-nowrap px-3 py-2.5 font-semibold ${colorAvance(r.aprobadas)}`}>{porcentajeTexto(r.aprobadas)}{r.trimestre && <span class="block text-xs font-normal text-slate-500">{nombreTrimestre(r.trimestre)}</span>}</td>
                  </tr>
                })}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Pager page={pagina} total={filas.length} onPage={setPagina} />
        <p class="mt-3 text-xs text-slate-500">Fichas suma las categorías de datos faltantes. Asistencia en riesgo es el % de estudiantes con 28 o más inasistencias. Desempeño muestra el % con todas las materias aprobadas en el último trimestre cargado del ciclo {data.ciclo || 'actual'}. Los promedios globales son el promedio simple de las escuelas con datos.</p>
      </>}
    </>
  )
}
