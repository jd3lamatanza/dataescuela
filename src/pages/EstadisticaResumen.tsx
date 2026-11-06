import { useMemo, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { coincideAgrupamiento, fechaPba, numeroPba } from '../lib/estadisticaPba'
import { CATEGORIAS_FICHA, porcentajeTexto } from '../lib/estadisticaFichas'
import { TRAMOS_ASISTENCIA, ordenAnio } from '../lib/estadisticaAsistencia'
import { CATEGORIAS_DESEMPENO, nombreTrimestre } from '../lib/estadisticaDesempeno'
import { cargar, descargarTabla, mensaje, nombre } from './estadisticaDatos'
import { Alert, BTN_SECONDARY, Card, FIELD, Spinner, toast } from '../ui/kit'
import { Apilada, Barras, Leyenda, Lineas, Torta, type Dato } from '../ui/charts'

interface Pba { clave: string; fecha: string; activa: number | null; anterior: number | null; inicial: number | null }
type Fila = { clave: string; fecha: string } & Record<string, number | string | null>

async function traer(tabla: string, campos: string, orden: string[]) {
  const filas: Fila[] = []
  const size = 1000
  for (let desde = 0; ; desde += size) {
    const r = await orden.reduce((c, col) => c.order(col), supabase.from(tabla).select(campos)).range(desde, desde + size - 1)
    if (r.error) throw r.error
    filas.push(...(r.data as unknown as Fila[]))
    if (r.data.length < size) break
  }
  return filas
}

async function cargarTodo(distrito: boolean) {
  const base = await cargar<Pba>(distrito, 'estadistica_matricula_pba', 'clave,fecha,activa,anterior,inicial')
  const [fichas, salidas, cierre, boletin, asistencia, desempeno] = await Promise.all([
    traer('estadistica_fichas_inscripcion', 'clave,fecha,matricula,' + CATEGORIAS_FICHA.map((c) => c.key).join(','), ['clave']),
    traer('estadistica_salidas_sin_ingreso', 'clave,fecha,nivel', ['id']),
    traer('estadistica_matricula_sin_cierre', 'clave,fecha,sin_cierre', ['clave']),
    traer('estadistica_boletin_digital', 'clave,fecha,completo,parcial,sin_carga', ['clave']),
    traer('estadistica_asistencia', 'clave,fecha,anio,matricula,' + TRAMOS_ASISTENCIA.map((c) => c.key).join(','), ['clave', 'anio']),
    traer('estadistica_desempeno', 'clave,fecha,ciclo,trimestre,anio,matricula,' + CATEGORIAS_DESEMPENO.map((c) => c.key).join(','), ['clave', 'ciclo', 'trimestre', 'anio']),
  ])
  return { base, fichas, salidas, cierre, boletin, asistencia, desempeno }
}

const n = (v: unknown) => typeof v === 'number' ? v : 0
const suma = (xs: Fila[], k: string) => xs.reduce((s, x) => s + n(x[k]), 0)
const maxFecha = (xs: { fecha?: unknown }[]) => xs.reduce((m, x) => String(x.fecha) > m ? String(x.fecha) : m, '')
const pc = (a: number, t: number) => t ? a * 100 / t : null
const pt = (a: number, t: number) => porcentajeTexto(pc(a, t))
const verde = '#10b981', ambar = '#fbbf24', rojo = '#ef4444', gris = '#94a3b8', azul = '#0ea5e9', indigo = '#6366f1', rosa = '#f43f5e', violeta = '#8b5cf6'
const NIVELES: Record<string, string> = { inicial: 'Inicial', primario: 'Primario', secundario: 'Secundario' }

function Kpi({ t, v, c = 'text-slate-900' }: { t: string; v: string; c?: string }) {
  return <div class="rounded-lg border border-slate-200 bg-white p-3 text-center"><div class={`text-xl font-bold ${c}`}>{v}</div><div class="text-xs text-slate-500">{t}</div></div>
}
function Seccion({ titulo, fecha, vacio, children }: { titulo: string; fecha: string; vacio: boolean; children: ComponentChildren }) {
  return <Card class="mt-4" title={titulo} action={<span class="text-xs text-slate-500">{fecha ? `Datos al ${fechaPba(fecha)}` : 'Sin datos'}</span>}>
    {vacio ? <p class="text-sm text-slate-500">No hay datos para los filtros elegidos.</p> : children}
  </Card>
}
const Grafico = ({ t, children }: { t: string; children: ComponentChildren }) => <div class="rounded-lg border border-slate-100 p-3"><h4 class="mb-3 text-sm font-semibold text-slate-700">{t}</h4>{children}</div>

export function ReporteDistrital({ distrito }: { distrito: boolean }) {
  const { data, loading, error } = useAsync(() => cargarTodo(distrito), [distrito])
  const [q, setQ] = useState('')
  const [inspector, setInspector] = useState('')
  const [grupo, setGrupo] = useState('')
  const [escuela, setEscuela] = useState('')
  const [cicloElegido, setCicloElegido] = useState('')

  const escuelas = useMemo(() => data ? [...data.base.claves.values()].filter((e) => e.clave).sort((a, b) => a.clave!.localeCompare(b.clave!)) : [], [data])
  const claves = useMemo(() => {
    if (!data) return new Set<string>()
    const buscar = q.trim().toLocaleLowerCase('es-AR')
    const seleccion = inspector && distrito ? data.base.inspectores.find((i) => String(i.id) === inspector) : undefined
    const asignadas = inspector && distrito ? new Set(seleccion?.escuelas_asignadas ?? []) : null
    const codigos = grupo ? new Set(data.base.codigosGrupo.filter((c) => String(c.agrupamiento_id) === grupo).map((c) => c.codigo)) : null
    return new Set(escuelas.filter((e) =>
      (!escuela || e.clave === escuela) && (!asignadas || asignadas.has(e.clave!)) &&
      coincideAgrupamiento(data.base.codigosPorClave.get(e.clave!), codigos) &&
      [e.clave, e.cue, e.codigo, e.numero, e.nombre, e.localidad].join(' ').toLocaleLowerCase('es-AR').includes(buscar)).map((e) => e.clave!))
  }, [data, escuelas, q, inspector, grupo, escuela, distrito])

  const m = useMemo(() => {
    if (!data) return null
    const en = <T extends { clave: unknown }>(xs: T[]) => xs.filter((x) => claves.has(String(x.clave)))
    const pba = en(data.base.filas as Pba[]).filter((r) => r.activa !== null)
    const activa = pba.reduce((s, r) => s + n(r.activa), 0)
    const comparar = (k: 'inicial' | 'anterior') => {
      const c = pba.filter((r) => r[k] !== null)
      const base = c.reduce((s, r) => s + n(r[k]), 0), actual = c.reduce((s, r) => s + n(r.activa), 0)
      return { base, actual, dif: actual - base, suben: c.filter((r) => n(r.activa) > n(r[k])).length, bajan: c.filter((r) => n(r.activa) < n(r[k])).length, igual: c.filter((r) => n(r.activa) === n(r[k])).length }
    }
    const fichas = en(data.fichas)
    const salidas = en(data.salidas)
    const cierre = en(data.cierre)
    const boletin = en(data.boletin)
    const asistencia = en(data.asistencia)
    const desempeno = en(data.desempeno)
    const ciclos = [...new Set(desempeno.map((d) => n(d.ciclo)))].sort((a, b) => b - a)
    const ciclo = ciclos.includes(Number(cicloElegido)) ? Number(cicloElegido) : (ciclos.includes(new Date().getFullYear()) ? new Date().getFullYear() : ciclos[0])
    const trimestres = [1, 2, 3].map((t) => ({ t, filas: desempeno.filter((d) => n(d.ciclo) === ciclo && n(d.trimestre) === t) }))
    return {
      pba, activa, ini: comparar('inicial'), ant: comparar('anterior'), fechaPba: maxFecha(pba),
      fichas, fichasMat: suma(fichas, 'matricula'), fichasTotal: CATEGORIAS_FICHA.reduce((s, c) => s + suma(fichas, c.key), 0), fechaFichas: maxFecha(fichas),
      salidas, porNivel: Object.keys(NIVELES).map((k) => ({ k, v: salidas.filter((s) => s.nivel === k).length })), fechaSalidas: maxFecha(salidas),
      cierre, cierreTotal: suma(cierre, 'sin_cierre'), cierreEsc: cierre.filter((c) => n(c.sin_cierre) > 0), fechaCierre: maxFecha(cierre),
      boletin, bol: { completo: suma(boletin, 'completo'), parcial: suma(boletin, 'parcial'), sin: suma(boletin, 'sin_carga') }, fechaBoletin: maxFecha(boletin),
      asistencia, asisMat: suma(asistencia, 'matricula'), fechaAsistencia: maxFecha(asistencia),
      anios: [...new Set(asistencia.map((a) => String(a.anio)))].sort((a, b) => ordenAnio(a) - ordenAnio(b) || a.localeCompare(b)),
      desempeno, ciclos, ciclo, trimestres, fechaDesempeno: maxFecha(desempeno.filter((d) => n(d.ciclo) === ciclo)),
    }
  }, [data, claves, cicloElegido])

  const lineasExport = useMemo(() => {
    if (!m) return []
    const l: [string, string, number | null, string][] = []
    l.push(['Matrícula PBA', 'Escuelas con datos', m.pba.length, ''], ['Matrícula PBA', 'Matrícula activa', m.activa, ''])
    for (const [t, c] of [['relevamiento inicial', m.ini], ['ciclo anterior', m.ant]] as const) l.push(['Matrícula PBA', `Diferencia vs. ${t}`, c.dif, porcentajeTexto(pc(c.dif, c.base))])
    l.push(['Fichas de Inscripción', 'Matrícula relevada', m.fichasMat, ''])
    for (const c of CATEGORIAS_FICHA) l.push(['Fichas de Inscripción', c.label, suma(m.fichas, c.key), pt(suma(m.fichas, c.key), m.fichasMat)])
    l.push(['Salidas sin ingreso', 'Total de estudiantes', m.salidas.length, ''])
    for (const x of m.porNivel) l.push(['Salidas sin ingreso', NIVELES[x.k], x.v, pt(x.v, m.salidas.length)])
    l.push(['Matrícula sin cerrar', 'Total de estudiantes', m.cierreTotal, pt(m.cierreTotal, m.activa)], ['Matrícula sin cerrar', 'Escuelas con casos', m.cierreEsc.length, pt(m.cierreEsc.length, m.cierre.length)])
    const tb = m.bol.completo + m.bol.parcial + m.bol.sin
    l.push(['Boletín Digital', 'Completo', m.bol.completo, pt(m.bol.completo, tb)], ['Boletín Digital', 'Parcial', m.bol.parcial, pt(m.bol.parcial, tb)], ['Boletín Digital', 'Sin carga', m.bol.sin, pt(m.bol.sin, tb)])
    for (const t of TRAMOS_ASISTENCIA) l.push(['Asistencia', `Estudiantes ${t.label}`, suma(m.asistencia, t.key), pt(suma(m.asistencia, t.key), m.asisMat)])
    for (const { t, filas } of m.trimestres) {
      const mat = suma(filas, 'matricula')
      for (const c of CATEGORIAS_DESEMPENO) l.push(['Desempeño', `${nombreTrimestre(t)} ${m.ciclo ?? ''} · ${c.label}`, filas.length ? suma(filas, c.key) : null, filas.length ? pt(suma(filas, c.key), mat) : ''])
    }
    return l
  }, [m])

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    try {
      const seleccionado = distrito && inspector ? data?.base.inspectores.find((i) => String(i.id) === inspector) : undefined
      const agrupamiento = data?.base.grupos.find((g) => String(g.id) === grupo)
      const filtros = [seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`, escuela && `Escuela: ${escuela}`].filter(Boolean).join(' · ')
      await descargarTabla(tipo, 'reporte-distrital', 'Reporte distrital', 'Reporte Distrital', `${claves.size} escuelas · ${filtros || 'datos filtrados'}`,
        ['Sección', 'Indicador', 'Valor', '%'], [24, 44, 14, 10],
        lineasExport.map(([s, i, v, p]) => [s, i, v, p]), lineasExport.map(([s, i, v, p]) => [s, i, numeroPba(v), p]))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  const dif = (c: { dif: number; base: number }) => <span class={c.dif > 0 ? 'text-emerald-700' : c.dif < 0 ? 'text-red-700' : 'text-slate-500'}>{c.dif > 0 ? '▲ +' : c.dif < 0 ? '▼ ' : '= '}{c.dif.toLocaleString('es-AR')} ({pt(Math.abs(c.dif), c.base)})</span>
  const colorAvance = (p: number | null) => p === null ? 'text-slate-500' : p >= 90 ? 'text-emerald-700' : p >= 70 ? 'text-amber-700' : 'text-red-700'

  return (
    <>
      <Card title="Reporte Distrital" action={<div class="flex flex-wrap gap-2">
        <button class={BTN_SECONDARY} disabled={!m} onClick={() => void exportar('xlsx')}>Excel</button>
        <button class={BTN_SECONDARY} disabled={!m} onClick={() => void exportar('pdf')}>PDF</button>
      </div>}>
        <p class="text-sm text-slate-600">Resumen general de todas las pestañas de Estadística con totales, porcentajes y gráficos. Todo respeta los filtros elegidos.</p>
      </Card>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      {loading && !data ? <Spinner /> : data && m && <>
        <div class={`mt-4 grid gap-2 sm:grid-cols-2 ${distrito ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
          <input class={FIELD} type="search" aria-label="Buscar escuela" placeholder="Buscar por escuela, clave, CUE o localidad" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          <select class={FIELD} aria-label="Filtrar por escuela" value={escuela} onChange={(e) => setEscuela(e.currentTarget.value)}>
            <option value="">Todas las escuelas</option>
            {escuelas.map((e) => <option key={e.clave} value={e.clave!}>{nombre(e)} · {e.clave}</option>)}
          </select>
          {distrito && <select class={FIELD} aria-label="Filtrar por inspector" value={inspector} onChange={(e) => setInspector(e.currentTarget.value)}>
            <option value="">Todos los inspectores</option>
            {data.base.inspectores.map((i) => <option key={i.id} value={i.id}>{i.nombre || i.cuil}</option>)}
          </select>}
          <select class={FIELD} aria-label="Filtrar por agrupamiento de matrícula" value={grupo} onChange={(e) => setGrupo(e.currentTarget.value)}>
            <option value="">Todos los agrupamientos</option>
            {data.base.grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
          </select>
        </div>
        <p class="mt-3 text-sm font-medium text-slate-700">{claves.size} escuelas seleccionadas</p>

        <Seccion titulo="Matrícula PBA" fecha={m.fechaPba} vacio={!m.pba.length}>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi t="Escuelas con datos" v={numeroPba(m.pba.length)} />
            <Kpi t="Matrícula activa" v={numeroPba(m.activa)} />
            <div class="rounded-lg border border-slate-200 bg-white p-3 text-center"><div class="text-base font-bold">{dif(m.ini)}</div><div class="text-xs text-slate-500">Vs. relevamiento inicial</div></div>
            <div class="rounded-lg border border-slate-200 bg-white p-3 text-center"><div class="text-base font-bold">{dif(m.ant)}</div><div class="text-xs text-slate-500">Vs. ciclo anterior</div></div>
          </div>
          <div class="mt-3 grid gap-3 lg:grid-cols-3">
            <Grafico t="Matrícula por referencia"><Barras datos={[{ label: 'Ciclo anterior', value: m.ant.base, color: gris }, { label: 'Relevamiento inicial', value: m.ini.base, color: azul }, { label: 'Activa actual', value: m.activa, color: verde }]} /></Grafico>
            <Grafico t="Escuelas vs. relevamiento inicial"><Torta centro={String(m.ini.suben + m.ini.bajan + m.ini.igual)} datos={[{ label: 'Crecen', value: m.ini.suben, color: verde }, { label: 'Descienden', value: m.ini.bajan, color: rojo }, { label: 'Sin cambios', value: m.ini.igual, color: gris }]} /></Grafico>
            <Grafico t="Escuelas vs. ciclo anterior"><Torta centro={String(m.ant.suben + m.ant.bajan + m.ant.igual)} datos={[{ label: 'Crecen', value: m.ant.suben, color: verde }, { label: 'Descienden', value: m.ant.bajan, color: rojo }, { label: 'Sin cambios', value: m.ant.igual, color: gris }]} /></Grafico>
          </div>
        </Seccion>

        <Seccion titulo="Fichas de Inscripción" fecha={m.fechaFichas} vacio={!m.fichas.length}>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi t="Escuelas con datos" v={numeroPba(m.fichas.length)} />
            <Kpi t="Matrícula relevada" v={numeroPba(m.fichasMat)} />
            <Kpi t="Datos faltantes (suma)" v={numeroPba(m.fichasTotal)} c="text-indigo-700" />
            <Kpi t="Sin DNI argentino" v={pt(suma(m.fichas, 'sin_dni'), m.fichasMat)} c="text-rose-700" />
          </div>
          <div class="mt-3"><Grafico t="Faltantes por categoría (% sobre matrícula relevada)">
            <Barras total={m.fichasMat} datos={CATEGORIAS_FICHA.map((c) => ({ label: c.label, value: suma(m.fichas, c.key), color: indigo }))} />
          </Grafico></div>
        </Seccion>

        <Seccion titulo="Salidas sin ingreso" fecha={m.fechaSalidas} vacio={!m.salidas.length}>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Kpi t="Estudiantes" v={numeroPba(m.salidas.length)} c="text-rose-700" />
            <Kpi t="Escuelas con salidas" v={numeroPba(new Set(m.salidas.map((s) => s.clave)).size)} />
            <Kpi t="Cada 1000 de matrícula" v={m.activa ? (m.salidas.length * 1000 / m.activa).toLocaleString('es-AR', { maximumFractionDigits: 1 }) : '—'} />
          </div>
          <div class="mt-3"><Grafico t="Por nivel"><Torta centro={String(m.salidas.length)} datos={m.porNivel.map((x, i) => ({ label: NIVELES[x.k], value: x.v, color: [azul, violeta, rosa][i] }))} /></Grafico></div>
        </Seccion>

        <Seccion titulo="Matrícula sin cerrar" fecha={m.fechaCierre} vacio={!m.cierre.length}>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi t="Estudiantes sin cerrar" v={numeroPba(m.cierreTotal)} c="text-amber-700" />
            <Kpi t="% de la matrícula activa" v={pt(m.cierreTotal, m.activa)} />
            <Kpi t="Escuelas con casos" v={numeroPba(m.cierreEsc.length)} />
            <Kpi t="% de escuelas" v={pt(m.cierreEsc.length, m.cierre.length)} />
          </div>
          <div class="mt-3"><Grafico t="Escuelas con más casos">
            <Barras datos={[...m.cierreEsc].sort((a, b) => n(b.sin_cierre) - n(a.sin_cierre)).slice(0, 8).map((c) => ({ label: nombre(data.base.claves.get(String(c.clave))!), value: n(c.sin_cierre), color: ambar }))} />
          </Grafico></div>
        </Seccion>

        <Seccion titulo="Carga de Boletín Digital" fecha={m.fechaBoletin} vacio={!m.boletin.length}>
          {(() => {
            const t = m.bol.completo + m.bol.parcial + m.bol.sin
            return <>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi t="Boletines" v={numeroPba(t)} />
                <Kpi t="Completos" v={pt(m.bol.completo, t)} c={colorAvance(pc(m.bol.completo, t))} />
                <Kpi t="Parciales" v={pt(m.bol.parcial, t)} c="text-amber-700" />
                <Kpi t="Sin carga" v={pt(m.bol.sin, t)} c="text-red-700" />
              </div>
              <div class="mt-3 grid gap-3 lg:grid-cols-2">
                <Grafico t="Estado de carga"><Torta centro={pt(m.bol.completo, t)} datos={[{ label: 'Completo', value: m.bol.completo, color: verde }, { label: 'Parcial', value: m.bol.parcial, color: ambar }, { label: 'Sin carga', value: m.bol.sin, color: rojo }]} /></Grafico>
                <Grafico t="Escuelas por avance"><Barras total={m.boletin.length} datos={[
                  { label: '90 % o más', value: m.boletin.filter((b) => (pc(n(b.completo), n(b.completo) + n(b.parcial) + n(b.sin_carga)) ?? -1) >= 90).length, color: verde },
                  { label: '70 % a 89 %', value: m.boletin.filter((b) => { const p = pc(n(b.completo), n(b.completo) + n(b.parcial) + n(b.sin_carga)) ?? -1; return p >= 70 && p < 90 }).length, color: ambar },
                  { label: 'Menos de 70 %', value: m.boletin.filter((b) => (pc(n(b.completo), n(b.completo) + n(b.parcial) + n(b.sin_carga)) ?? -1) < 70).length, color: rojo },
                ]} /></Grafico>
              </div>
            </>
          })()}
        </Seccion>

        <Seccion titulo="Asistencia" fecha={m.fechaAsistencia} vacio={!m.asistencia.length}>
          {(() => {
            const riesgo = suma(m.asistencia, 'de_28_44') + suma(m.asistencia, 'mas_45')
            const colores = [verde, '#a3e635', ambar, '#f97316', rojo, gris]
            return <>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi t="Estudiantes" v={numeroPba(m.asisMat)} />
                <Kpi t="Menos de 10 inasistencias" v={pt(suma(m.asistencia, 'menos_10'), m.asisMat)} c="text-emerald-700" />
                <Kpi t="28 o más (riesgo)" v={pt(riesgo, m.asisMat)} c="text-red-700" />
                <Kpi t="45 o más" v={pt(suma(m.asistencia, 'mas_45'), m.asisMat)} c="text-red-700" />
              </div>
              <div class="mt-3 grid gap-3 lg:grid-cols-2">
                <Grafico t="Distribución por inasistencias"><Torta centro={numeroPba(m.asisMat)} datos={TRAMOS_ASISTENCIA.map((t, i) => ({ label: t.label, value: suma(m.asistencia, t.key), color: colores[i] }))} /></Grafico>
                <Grafico t="% con 28 o más inasistencias por año de estudio"><Barras datos={m.anios.map((a) => {
                  const f = m.asistencia.filter((x) => x.anio === a)
                  return { label: a, value: Math.round((pc(suma(f, 'de_28_44') + suma(f, 'mas_45'), suma(f, 'matricula')) ?? 0) * 10) / 10, color: rojo }
                })} sufijo="%" /></Grafico>
              </div>
            </>
          })()}
        </Seccion>

        <Seccion titulo={`Desempeño académico${m.ciclo ? ` · ciclo ${m.ciclo}` : ''}`} fecha={m.fechaDesempeno} vacio={!m.desempeno.length}>
          {(() => {
            const cargados = m.trimestres.filter((t) => t.filas.length)
            const ultimo = cargados[cargados.length - 1]
            const mat = ultimo ? suma(ultimo.filas, 'matricula') : 0
            const colores = [verde, '#a3e635', ambar, '#f97316', rojo, gris]
            const serie = (f: (x: Fila[]) => number) => m.trimestres.map((t) => t.filas.length ? Math.round((pc(f(t.filas), suma(t.filas, 'matricula')) ?? 0) * 10) / 10 : null)
            return <>
              {m.ciclos.length > 1 && <select class={`${FIELD} mb-3 sm:max-w-48`} aria-label="Ciclo lectivo" value={String(m.ciclo)} onChange={(e) => setCicloElegido(e.currentTarget.value)}>
                {m.ciclos.map((c) => <option key={c} value={c}>Ciclo {c}</option>)}
              </select>}
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi t="Último trimestre" v={ultimo ? nombreTrimestre(ultimo.t) : '—'} />
                <Kpi t="Todas aprobadas" v={ultimo ? pt(suma(ultimo.filas, 'aprobadas'), mat) : '—'} c="text-emerald-700" />
                <Kpi t="3 o más no aprobadas" v={ultimo ? pt(suma(ultimo.filas, 'de_3_4') + suma(ultimo.filas, 'mas_5') + suma(ultimo.filas, 'ninguna'), mat) : '—'} c="text-red-700" />
                <Kpi t="Estudiantes" v={numeroPba(mat)} />
              </div>
              <div class="mt-3 grid gap-3 lg:grid-cols-2">
                <Grafico t="Evolución por trimestre"><Lineas etiquetas={['1.º', '2.º', '3.º']} series={[
                  { label: 'Todas aprobadas', color: verde, puntos: serie((f) => suma(f, 'aprobadas')) },
                  { label: '3 o más no aprobadas', color: rojo, puntos: serie((f) => suma(f, 'de_3_4') + suma(f, 'mas_5') + suma(f, 'ninguna')) },
                ]} /></Grafico>
                <Grafico t={ultimo ? `Distribución · ${nombreTrimestre(ultimo.t)}` : 'Distribución'}>
                  {ultimo ? <Torta centro={numeroPba(mat)} datos={CATEGORIAS_DESEMPENO.map((c, i) => ({ label: c.label, value: suma(ultimo.filas, c.key), color: colores[i] }))} /> : <Leyenda datos={[]} />}
                </Grafico>
              </div>
            </>
          })()}
        </Seccion>
        <p class="mt-3 text-xs text-slate-500">Los porcentajes se calculan con los totales de las escuelas seleccionadas (no son promedios de porcentajes). Asistencia en riesgo: 28 o más inasistencias.</p>
      </>}
    </>
  )
}
