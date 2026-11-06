import { useMemo, useState } from 'preact/hooks'
import { useAsync } from '../lib/hooks'
import { coincideAgrupamiento, fechaPba, type MatriculaPba } from '../lib/estadisticaPba'
import { CATEGORIAS_FICHA, porcentajeTexto, type FichaInscripcion } from '../lib/estadisticaFichas'
import { nombreTrimestre } from '../lib/estadisticaDesempeno'
import { completamiento, correlacion, deficitMatricula, porcentaje, porcentajeAgregado, prioridadConjunta, type RegistroAsistencia, type RegistroDesempeno } from '../lib/indicadoresComparados'
import { cargar, cargarRegistros, descargarTabla, mensaje, nombre, type Escuela } from './estadisticaDatos'
import { Alert, BTN_SECONDARY, Card, EmptyState, FIELD, PAGE_SIZE, Pager, Spinner, TabBar, toast, type TabItem } from '../ui/kit'

type Pba = MatriculaPba & { fecha: string }
type Ficha = FichaInscripcion & { fecha: string }
type Salida = { clave: string; fecha: string }
type Cierre = { clave: string; fecha: string; sin_cierre: number | null }
type Metrica = { valor: number | null; detalle: string; fecha: string }
type Comparacion = { clave: string; escuela: Escuela; x: Metrica; y: Metrica }

const TABS: TabItem[] = [
  { id: 'carga', label: 'Cargas y Ausentismo', icon: 'users', color: 'cyan' },
  { id: 'asistencia', label: 'Ausentismo y Desempeño', icon: 'calendar', color: 'violet' },
  { id: 'cierre', label: 'Salidas sin ingreso / Matrícula sin cerrar', icon: 'clock', color: 'amber' },
  { id: 'salidas-asistencia', label: 'Salidas sin ingreso / Asistencia', icon: 'transfer', color: 'rose' },
  { id: 'salidas-desempeno', label: 'Salidas sin ingreso / Desempeño', icon: 'shield', color: 'sky' },
  { id: 'fichas', label: 'Completamiento de Datos', icon: 'clipboard', color: 'indigo' },
]
const sinDato: Metrica = { valor: null, detalle: 'Sin datos suficientes', fecha: '' }
const fecha = (f: string) => f ? fechaPba(f) : 'Sin fecha'
const formato = (v: number | null, unidad: string) => v === null ? 'Sin dato' : unidad === '%' ? porcentajeTexto(v) : v.toLocaleString('es-AR')
const fechas = (filas: { fecha: string }[]) => {
  const ordenadas = [...new Set(filas.map((f) => f.fecha).filter(Boolean))].sort()
  return ordenadas.length > 1 ? `${fecha(ordenadas[0])}–${fecha(ordenadas[ordenadas.length - 1])}` : ordenadas.length ? fecha(ordenadas[0]) : ''
}

async function cargarComparados(distrito: boolean) {
  const [base, fichas, salidas, cierres, asistencia, desempeno] = await Promise.all([
    cargar<Pba>(distrito, 'estadistica_matricula_pba', 'clave,fecha,activa,inicial,anterior'),
    cargarRegistros<Ficha>('estadistica_fichas_inscripcion', ['clave', 'fecha', 'matricula', ...CATEGORIAS_FICHA.map((c) => c.key)].join(','), ['clave']),
    cargarRegistros<Salida>('estadistica_salidas_sin_ingreso', 'clave,fecha', ['id']),
    cargarRegistros<Cierre>('estadistica_matricula_sin_cierre', 'clave,fecha,sin_cierre', ['clave']),
    cargarRegistros<RegistroAsistencia>('estadistica_asistencia', 'clave,fecha,ciclo,matricula,de_28_44,mas_45', ['clave', 'anio']),
    cargarRegistros<RegistroDesempeno>('estadistica_desempeno', 'clave,fecha,ciclo,trimestre,matricula,de_3_4,mas_5,ninguna', ['clave', 'ciclo', 'trimestre', 'anio']),
  ])
  return { base, fichas, salidas, cierres, asistencia, desempeno }
}

function grafico(filas: Comparacion[], tituloX: string, tituloY: string, unidadX: string, unidadY: string) {
  const pares = filas.filter((r): r is Comparacion & { x: Metrica & { valor: number }; y: Metrica & { valor: number } } => r.x.valor !== null && r.y.valor !== null)
  const r = correlacion(pares.map((p) => [p.x.valor, p.y.valor]))
  const xmax = Math.max(1, ...pares.map((p) => p.x.valor))
  const ymax = Math.max(1, ...pares.map((p) => p.y.valor))
  return <div>
    <p class="text-sm text-slate-600">Escuelas con ambos indicadores: <strong>{pares.length}</strong>. Correlación de Pearson: <strong>{r === null ? 'no calculable' : r.toLocaleString('es-AR', { maximumFractionDigits: 2 })}</strong>.</p>
    <p class="mt-1 text-xs text-slate-500">La correlación describe una asociación entre escuelas, no demuestra causalidad. No es calculable con menos de tres pares o si un indicador no varía.</p>
    {pares.length > 0 && <div class="mt-3 overflow-hidden rounded-lg border border-slate-100 p-3">
      <p class="text-xs font-medium text-slate-600">Vertical: {tituloY}</p>
      <svg viewBox="0 0 400 205" class="mx-auto mt-2 w-full max-w-2xl" role="img" aria-label={`Dispersión: ${tituloX} y ${tituloY}. Cada punto representa una escuela.`}>
        <line x1="42" y1="8" x2="42" y2="175" stroke="#94a3b8" />
        <line x1="42" y1="175" x2="390" y2="175" stroke="#94a3b8" />
        <text x="38" y="12" text-anchor="end" font-size="9" fill="#64748b">{formato(ymax, unidadY)}</text>
        <text x="38" y="178" text-anchor="end" font-size="9" fill="#64748b">0</text>
        <text x="390" y="190" text-anchor="end" font-size="9" fill="#64748b">{formato(xmax, unidadX)}</text>
        {pares.map((p) => <circle key={p.clave} cx={42 + p.x.valor / xmax * 345} cy={175 - p.y.valor / ymax * 163} r="4" fill="#0891b2" fill-opacity="0.7">
          <title>{`${nombre(p.escuela)} · ${p.clave}: ${formato(p.x.valor, unidadX)}, ${formato(p.y.valor, unidadY)}`}</title>
        </circle>)}
      </svg>
      <p class="text-center text-xs font-medium text-slate-600">Horizontal: {tituloX}</p>
    </div>}
  </div>
}

export function IndicadoresComparados({ distrito }: { distrito: boolean }) {
  const { data, loading, error } = useAsync(() => cargarComparados(distrito), [distrito])
  const [tab, setTab] = useState('carga')
  const [q, setQ] = useState('')
  const [inspector, setInspector] = useState('')
  const [grupo, setGrupo] = useState('')
  const [escuela, setEscuela] = useState('')
  const [orden, setOrden] = useState('conjunta')
  const [pagina, setPagina] = useState(1)
  const [ciclo, setCiclo] = useState(String(new Date().getFullYear()))
  const [trimestre, setTrimestre] = useState('')

  const ciclos = useMemo(() => [...new Set([new Date().getFullYear(), ...(data?.desempeno.map((d) => d.ciclo) ?? [])])].sort((a, b) => b - a), [data])
  const trimestreActivo = trimestre || String(Math.max(0, ...(data?.desempeno.filter((d) => String(d.ciclo) === ciclo).map((d) => d.trimestre) ?? []))) || '0'
  const nombres: Record<string, [string, string, string, string]> = {
    carga: ['Déficit relativo de matrícula', '28 o más inasistencias', '%', '%'],
    asistencia: ['28 o más inasistencias', '3 o más materias no aprobadas', '%', '%'],
    cierre: ['Salidas sin ingreso registradas', 'Inscripciones sin cerrar', 'cantidad', 'cantidad'],
    'salidas-asistencia': ['Salidas por cada 100 estudiantes activos', '28 o más inasistencias', 'tasa', '%'],
    'salidas-desempeno': ['Salidas por cada 100 estudiantes activos', '3 o más materias no aprobadas', 'tasa', '%'],
    fichas: ['Completamiento promedio por categoría', '28 o más inasistencias', '%', '%'],
  }
  const [tituloX, tituloY, unidadX, unidadY] = nombres[tab]

  const filas = useMemo(() => {
    if (!data) return []
    const porClave = <T extends { clave: string }>(registros: T[]) => {
      const mapa = new Map<string, T[]>()
      for (const r of registros) {
        const anteriores = mapa.get(r.clave)
        if (anteriores) anteriores.push(r)
        else mapa.set(r.clave, [r])
      }
      return mapa
    }
    const pbas = new Map(data.base.filas.map((p) => [p.clave, p]))
    const fichas = new Map(data.fichas.map((f) => [f.clave, f]))
    const cierres = new Map(data.cierres.map((c) => [c.clave, c]))
    const salidas = porClave(data.salidas), asistencias = porClave(data.asistencia), desempenos = porClave(data.desempeno)
    const asignadas = inspector && distrito ? new Set(data.base.inspectores.find((i) => String(i.id) === inspector)?.escuelas_asignadas ?? []) : null
    const codigos = grupo ? new Set(data.base.codigosGrupo.filter((c) => String(c.agrupamiento_id) === grupo).map((c) => c.codigo)) : null
    const buscar = q.trim().toLocaleLowerCase('es-AR')
    const lista: Comparacion[] = []
    for (const [clave, e] of data.base.claves) {
      if (escuela && escuela !== clave || asignadas && !asignadas.has(clave) || !coincideAgrupamiento(data.base.codigosPorClave.get(clave), codigos) ||
        ![clave, e.cue, e.codigo, e.numero, e.nombre, e.localidad].join(' ').toLocaleLowerCase('es-AR').includes(buscar)) continue
      const p = pbas.get(clave), f = fichas.get(clave), c = cierres.get(clave)
      const s = salidas.get(clave) ?? [], a = asistencias.get(clave) ?? []
      const d = (desempenos.get(clave) ?? []).filter((v) => String(v.ciclo) === ciclo && String(v.trimestre) === trimestreActivo)
      const ciclosAsistencia = new Set(a.map((v) => v.ciclo))
      const asistencia: Metrica = a.length ? {
        valor: ciclosAsistencia.size > 1 ? null : porcentajeAgregado(a, ['de_28_44', 'mas_45'], 'matricula'),
        detalle: ciclosAsistencia.size > 1 ? 'Ciclos de asistencia diferentes' : `28 o más inasistencias · ciclo ${a[0].ciclo ?? 'no informado'}`,
        fecha: fechas(a),
      } : sinDato
      const desempeno: Metrica = d.length ? {
        valor: porcentajeAgregado(d, ['de_3_4', 'mas_5', 'ninguna'], 'matricula'),
        detalle: `3 o más materias no aprobadas · ${nombreTrimestre(Number(trimestreActivo))} ${ciclo}`,
        fecha: fechas(d),
      } : sinDato
      const deficit: Metrica = p ? { valor: deficitMatricula(p.activa, p.inicial), detalle: `Activa ${p.activa ?? '—'} / inicial ${p.inicial ?? '—'}`, fecha: fecha(p.fecha) } : sinDato
      const completitud: Metrica = f ? { valor: completamiento(f, CATEGORIAS_FICHA), detalle: 'Promedio de categorías; no equivale a fichas completas', fecha: fecha(f.fecha) } : sinDato
      const salida: Metrica = s.length ? { valor: s.length, detalle: 'Estudiantes registrados', fecha: fechas(s) } : { valor: null, detalle: 'Sin registros; puede ser cero o no haberse importado', fecha: '' }
      const salidaTasa: Metrica = s.length ? { valor: porcentaje(s.length, p?.activa ?? null), detalle: `${s.length} salidas / ${p?.activa ?? '—'} activos; datos de fuentes distintas`, fecha: `Salidas ${fechas(s)}; matrícula ${p ? fecha(p.fecha) : 'sin dato'}` } : salida
      const cierre: Metrica = c ? { valor: c.sin_cierre, detalle: 'Inscripciones de ciclos anteriores', fecha: fecha(c.fecha) } : sinDato
      const valores: Record<string, [Metrica, Metrica]> = {
        carga: [deficit, asistencia], asistencia: [asistencia, desempeno], cierre: [salida, cierre],
        'salidas-asistencia': [salidaTasa, asistencia], 'salidas-desempeno': [salidaTasa, desempeno], fichas: [completitud, asistencia],
      }
      const [x, y] = valores[tab]
      lista.push({ clave, escuela: e, x, y })
    }
    const rangos = prioridadConjunta(lista.map((f) => [f.x.valor, f.y.valor]), tab === 'fichas')
    const prioridad = new Map(lista.map((f, i) => [f.clave, rangos[i]]))
    return lista.sort((a, b) => {
      if (orden === 'clave') return a.clave.localeCompare(b.clave)
      if (orden === 'conjunta') {
        const x = prioridad.get(a.clave) ?? null, y = prioridad.get(b.clave) ?? null
        if (x === null) return y === null ? a.clave.localeCompare(b.clave) : 1
        if (y === null) return -1
        return x - y || a.clave.localeCompare(b.clave)
      }
      const eje = orden.startsWith('y') ? 'y' : 'x'
      const x = a[eje].valor, y = b[eje].valor
      if (x === null) return y === null ? a.clave.localeCompare(b.clave) : 1
      if (y === null) return -1
      return (orden.endsWith('asc') ? x - y : y - x) || a.clave.localeCompare(b.clave)
    })
  }, [data, distrito, inspector, grupo, escuela, q, ciclo, trimestreActivo, tab, orden])

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    try {
      const seleccionado = distrito && inspector ? data?.base.inspectores.find((i) => String(i.id) === inspector) : undefined
      const agrupamiento = data?.base.grupos.find((g) => String(g.id) === grupo)
      const filtros = [q.trim() && `Búsqueda: ${q.trim()}`, escuela && `Escuela: ${escuela}`, seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`].filter(Boolean).join(' · ')
      const periodo = tab === 'asistencia' || tab === 'salidas-desempeno' ? ` · ciclo ${ciclo}${trimestreActivo !== '0' ? `, ${nombreTrimestre(Number(trimestreActivo))}` : ''}` : ''
      const subtitulo = `${TABS.find((t) => t.id === tab)?.label} · ${filas.length} escuelas${periodo}${filtros ? ` · ${filtros}` : ''}`
      const headers = ['Clave', 'CUE', 'Escuela', `${tituloX} (${unidadX})`, 'Detalle / fecha', `${tituloY} (${unidadY})`, 'Detalle / fecha']
      await descargarTabla(tipo, `indicadores-${tab}`, 'Indicadores', 'Indicadores Comparados', subtitulo, headers, [15, 14, 24, 20, 32, 20, 32],
        filas.map((f) => [f.clave, f.escuela.cue, nombre(f.escuela), f.x.valor, [f.x.detalle, f.x.fecha].filter(Boolean).join(' · '), f.y.valor, [f.y.detalle, f.y.fecha].filter(Boolean).join(' · ')]),
        filas.map((f) => [f.clave, f.escuela.cue, nombre(f.escuela), formato(f.x.valor, unidadX), [f.x.detalle, f.x.fecha].filter(Boolean).join(' · '), formato(f.y.valor, unidadY), [f.y.detalle, f.y.fecha].filter(Boolean).join(' · ')]))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  const cambiarTab = (id: string) => { setTab(id); setOrden('conjunta'); setPagina(1) }
  const muestraDesempeno = tab === 'asistencia' || tab === 'salidas-desempeno'
  return <>
    <Card title="Indicadores Comparados">
      <p class="text-sm text-slate-600">Comparación por escuela de indicadores informados en distintos reportes. Los datos pueden corresponder a fechas y poblaciones distintas.</p>
    </Card>
    <TabBar class="mt-4 mb-4" label="Comparaciones de indicadores" items={TABS} active={tab} onChange={cambiarTab} />
    {error && <Alert tone="error">{error}</Alert>}
    {loading && !data ? <Spinner /> : data && <>
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <input class={FIELD} type="search" aria-label="Buscar escuela" placeholder="Buscar escuela, clave, CUE o localidad" value={q} onInput={(e) => { setQ(e.currentTarget.value); setPagina(1) }} />
        <select class={FIELD} aria-label="Filtrar por escuela" value={escuela} onChange={(e) => { setEscuela(e.currentTarget.value); setPagina(1) }}>
          <option value="">Todas las escuelas</option>
          {[...data.base.claves].sort(([a], [b]) => a.localeCompare(b)).map(([k, e]) => <option key={k} value={k}>{nombre(e)} · {k}</option>)}
        </select>
        {distrito && <select class={FIELD} aria-label="Filtrar por inspector" value={inspector} onChange={(e) => { setInspector(e.currentTarget.value); setPagina(1) }}>
          <option value="">Todos los inspectores</option>{data.base.inspectores.map((i) => <option key={i.id} value={i.id}>{i.nombre || i.cuil}</option>)}
        </select>}
        <select class={FIELD} aria-label="Filtrar por agrupamiento de matrícula" value={grupo} onChange={(e) => { setGrupo(e.currentTarget.value); setPagina(1) }}>
          <option value="">Todos los agrupamientos</option>{data.base.grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
        </select>
        <select class={FIELD} aria-label="Ordenar escuelas" value={orden} onChange={(e) => { setOrden(e.currentTarget.value); setPagina(1) }}>
          <option value="conjunta">Mayor prioridad conjunta</option>
          <option value="clave">Clave provincial</option>
          <option value="x-desc">Mayor {tituloX}</option><option value="x-asc">Menor {tituloX}</option>
          <option value="y-desc">Mayor {tituloY}</option><option value="y-asc">Menor {tituloY}</option>
        </select>
      </div>
      {muestraDesempeno && <div class="mt-2 grid gap-2 sm:grid-cols-2 sm:max-w-xl">
        <select class={FIELD} aria-label="Ciclo de desempeño" value={ciclo} onChange={(e) => { setCiclo(e.currentTarget.value); setTrimestre(''); setPagina(1) }}>
          {ciclos.map((c) => <option key={c} value={c}>Ciclo {c}</option>)}
        </select>
        <select class={FIELD} aria-label="Trimestre de desempeño" value={trimestreActivo} onChange={(e) => { setTrimestre(e.currentTarget.value); setPagina(1) }}>
          {trimestreActivo === '0' && <option value="0">Sin trimestres cargados</option>}
          {[1, 2, 3].map((t) => <option key={t} value={t}>{nombreTrimestre(t)}</option>)}
        </select>
      </div>}
      <Card class="mt-4" title="Relación entre indicadores">
        {grafico(filas, tituloX, tituloY, unidadX, unidadY)}
      </Card>
      <Card class="mt-4" title={`Escuelas · ${filas.length}`} action={<div class="flex flex-wrap gap-2">
        <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('xlsx')}>Excel</button>
        <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('pdf')}>PDF</button>
      </div>}>
        {!filas.length ? <EmptyState title="Sin escuelas" text="Probá con otros filtros." /> : <div class="-m-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-3 py-2">Escuela</th><th class="px-3 py-2">{tituloX}</th><th class="px-3 py-2">{tituloY}</th></tr></thead>
            <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((f) => <tr key={f.clave}>
              <td class="min-w-40 px-3 py-3"><strong>{nombre(f.escuela)}</strong><span class="block font-mono text-xs text-slate-500">{f.clave} · {f.escuela.cue}</span></td>
              {([['x', unidadX], ['y', unidadY]] as const).map(([eje, unidad]) => <td key={eje} class="min-w-48 px-3 py-3"><span class="font-semibold">{formato(f[eje].valor, unidad)}</span><span class="block text-xs text-slate-500">{f[eje].detalle}</span>{f[eje].fecha && <span class="block text-xs text-slate-500">{f[eje].fecha}</span>}</td>)}
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>
      <Pager page={pagina} total={filas.length} onPage={setPagina} />
      <div class="mt-4 space-y-1 text-xs text-slate-500">
        <p>Déficit relativo: máximo entre cero y (matrícula inicial − activa) / matrícula inicial. Es una aproximación, no prueba que falte cargar matrícula.</p>
        <p>Ausentismo: estudiantes con 28 o más inasistencias sobre matrícula del reporte de asistencia. Desempeño: estudiantes con 3 o más materias no aprobadas sobre matrícula del trimestre elegido.</p>
        <p>Completamiento: promedio de los porcentajes sin faltantes de las categorías de ficha; no es el porcentaje de fichas completas. Las categorías pueden superponerse.</p>
        <p>La prioridad conjunta promedia la posición relativa de cada escuela en los dos indicadores entre las escuelas con ambos datos. Para completamiento se priorizan valores menores; en los demás indicadores, valores mayores. No es un diagnóstico.</p>
        <p>Las salidas no registradas se muestran como «Sin dato»: el sistema no distingue una escuela sin casos de una sin archivo importado. Las tasas de salidas usan matrícula activa de otra fuente y pueden superar 100.</p>
      </div>
    </>}
  </>
}
