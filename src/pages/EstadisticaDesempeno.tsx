import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { coincideAgrupamiento, fechaPba, numeroPba } from '../lib/estadisticaPba'
import { CATEGORIAS_DESEMPENO, leerDesempeno, nombreTrimestre, type Desempeno } from '../lib/estadisticaDesempeno'
import { ordenAnio, porcentajeAsistencia as pct } from '../lib/estadisticaAsistencia'
import { porcentajeTexto } from '../lib/estadisticaFichas'
import { cargar, descargarTabla as descargarBase, mensaje, nombre, type Escuela } from './estadisticaDatos'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Modal, PAGE_SIZE, Pager, Spinner, toast } from '../ui/kit'

type Fila = Desempeno & { ciclo: number; trimestre: number; fecha: string; escuela: Escuela }
type Totales = { matricula: number } & Record<typeof CATEGORIAS_DESEMPENO[number]['key'], number>
interface Periodo extends Totales { trimestre: number; fecha: string; anios: Fila[] }
interface Resumen { clave: string; escuela: Escuela; periodos: Map<number, Periodo> }
const TRIMESTRES = [1, 2, 3]
const CAMPOS = ['clave', 'ciclo', 'trimestre', 'anio', 'fecha', 'matricula', ...CATEGORIAS_DESEMPENO.map((c) => c.key)].join(',')
const vacio = (): Totales => ({ matricula: 0, aprobadas: 0, de_1_2: 0, de_3_4: 0, mas_5: 0, ninguna: 0, sin_info: 0 })
const sumar = (t: Totales, f: Totales | Fila) => { t.matricula += f.matricula ?? 0; for (const c of CATEGORIAS_DESEMPENO) t[c.key] += f[c.key] ?? 0 }
const enRiesgo = (t: Totales) => t.de_3_4 + t.mas_5 + t.ninguna
const descargarTabla = (tipo: 'xlsx' | 'pdf' | 'pptx', archivo: string, ...resto: Parameters<typeof descargarBase> extends [unknown, unknown, unknown, ...infer R] ? R : never) => descargarBase(tipo, archivo, 'Desempeño', ...resto)
const textoCat = (t: Totales, c: typeof CATEGORIAS_DESEMPENO[number]) => `${numeroPba(t[c.key])} (${porcentajeTexto(pct(t[c.key], t.matricula))})`

function Barra({ t }: { t: Totales }) {
  const suma = CATEGORIAS_DESEMPENO.reduce((s, x) => s + t[x.key], 0)
  return <div class="flex h-2.5 min-w-24 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={CATEGORIAS_DESEMPENO.map((x) => `${x.label}: ${t[x.key]}`).join(', ')}>
    {suma > 0 && CATEGORIAS_DESEMPENO.map((x) => <div key={x.key} class={x.color} style={{ width: `${t[x.key] * 100 / suma}%` }} />)}
  </div>
}
const Leyenda = () => <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
  {CATEGORIAS_DESEMPENO.map((c) => <span key={c.key} class="inline-flex items-center gap-1.5"><span class={`size-2.5 rounded-full ${c.color}`} />{c.label}</span>)}
</div>

export function DesempenoEstadistica({ distrito }: { distrito: boolean }) {
  const { data, loading, error, reload } = useAsync(() => cargar<Fila>(distrito, 'estadistica_desempeno', CAMPOS, ['ciclo', 'trimestre', 'anio']), [distrito])
  const [ciclo, setCiclo] = useState('')
  const [q, setQ] = useState('')
  const [inspector, setInspector] = useState('')
  const [grupo, setGrupo] = useState('')
  const [orden, setOrden] = useState('clave')
  const [pagina, setPagina] = useState(1)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState('')
  const [abierta, setAbierta] = useState<Resumen | null>(null)

  const ciclos = useMemo(() => {
    const s = new Set((data?.filas ?? []).map((f) => f.ciclo))
    s.add(new Date().getFullYear())
    return [...s].sort((a, b) => b - a)
  }, [data])
  const cicloActivo = ciclo || String(ciclos[0])

  const resumenes = useMemo(() => {
    const mapa = new Map<string, Resumen>()
    for (const f of data?.filas ?? []) {
      if (String(f.ciclo) !== cicloActivo) continue
      let r = mapa.get(f.clave)
      if (!r) mapa.set(f.clave, r = { clave: f.clave, escuela: f.escuela, periodos: new Map() })
      let p = r.periodos.get(f.trimestre)
      if (!p) r.periodos.set(f.trimestre, p = { ...vacio(), trimestre: f.trimestre, fecha: f.fecha, anios: [] })
      sumar(p, f)
      if (f.fecha > p.fecha) p.fecha = f.fecha
      p.anios.push(f)
    }
    for (const r of mapa.values()) for (const p of r.periodos.values()) p.anios.sort((a, b) => ordenAnio(a.anio) - ordenAnio(b.anio))
    return [...mapa.values()]
  }, [data, cicloActivo])

  const ultimo = (r: Resumen) => [...r.periodos.values()].sort((a, b) => b.trimestre - a.trimestre)[0]

  const filas = useMemo(() => {
    const buscar = q.trim().toLocaleLowerCase('es-AR')
    const seleccion = inspector && distrito ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
    const asignadas = inspector && distrito ? new Set(seleccion?.escuelas_asignadas ?? []) : null
    const codigos = grupo ? new Set(data?.codigosGrupo.filter((c) => String(c.agrupamiento_id) === grupo).map((c) => c.codigo) ?? []) : null
    const valor = (r: Resumen): number | null => {
      const p = ultimo(r)
      return !p ? null : orden === 'matricula' ? p.matricula : orden.startsWith('riesgo') ? pct(enRiesgo(p), p.matricula) : pct(p.aprobadas, p.matricula)
    }
    return resumenes.filter((r) =>
      (!asignadas || asignadas.has(r.clave)) &&
      coincideAgrupamiento(data?.codigosPorClave.get(r.clave), codigos) &&
      [r.clave, r.escuela.cue, r.escuela.codigo, r.escuela.numero, r.escuela.nombre, r.escuela.localidad].join(' ').toLocaleLowerCase('es-AR').includes(buscar))
      .sort((a, b) => {
        if (orden === 'clave') return a.clave.localeCompare(b.clave)
        const x = valor(a), y = valor(b)
        if (x === null) return y === null ? a.clave.localeCompare(b.clave) : 1
        if (y === null) return -1
        return (orden.endsWith('-asc') ? x - y : y - x) || a.clave.localeCompare(b.clave)
      })
  }, [resumenes, data, q, orden, inspector, distrito, grupo])

  const importar = async (archivo: File) => {
    setImportando(true)
    setResultado('')
    try {
      if (!data) throw new Error('Esperá a que termine la carga de escuelas.')
      if (!archivo.name.toLowerCase().endsWith('.csv')) throw new Error('Seleccioná un archivo CSV descargado de ABC.')
      const doc = await leerDesempeno(await archivo.text())
      const filasDistrito = doc.filas.filter((f) => data.claves.has(f.clave))
      if (!filasDistrito.length) throw new Error('El archivo no contiene escuelas del padrón distrital.')
      const r = await supabase.rpc('estadistica_desempeno_importar', { p_fecha: doc.fecha, p_ciclo: doc.ciclo, p_trimestre: doc.trimestre, p_filas: filasDistrito })
      if (r.error) throw r.error
      const total = r.data as { guardadas: number; anteriores: number }
      setResultado(`${nombreTrimestre(doc.trimestre)} del ciclo ${doc.ciclo}, al ${fechaPba(doc.fecha)}. ${total.guardadas} registros por año guardados; ${total.anteriores} conservaron datos más recientes. ${doc.filas.length - filasDistrito.length} filas fuera del padrón distrital no se importaron. Los demás trimestres no se modificaron.`)
      setCiclo(String(doc.ciclo))
      toast.ok('Importación finalizada')
      setPagina(1)
      reload()
    } catch (e) { toast.error(mensaje(e)) }
    finally { setImportando(false) }
  }

  const exportar = async (tipo: 'xlsx' | 'pdf' | 'pptx') => {
    try {
      const seleccionado = distrito && inspector ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
      const agrupamiento = data?.grupos.find((g) => String(g.id) === grupo)
      const filtros = [`Ciclo ${cicloActivo}`, seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`].filter(Boolean).join(' · ')
      const lineas = filas.flatMap((r) => TRIMESTRES.filter((t) => r.periodos.has(t)).map((t) => ({ r, p: r.periodos.get(t)! })))
      await descargarTabla(tipo, `desempeno-${cicloActivo}`, 'Desempeño académico', `${filas.length} escuelas · ${filtros}`,
        ['Clave', 'Escuela', 'Trimestre', 'Fecha', 'Matrícula', ...CATEGORIAS_DESEMPENO.map((c) => c.label)], [13, 24, 12, 11, 10, ...CATEGORIAS_DESEMPENO.map(() => 14)],
        lineas.map(({ r, p }) => [r.clave, nombre(r.escuela), nombreTrimestre(p.trimestre), fechaPba(p.fecha), p.matricula, ...CATEGORIAS_DESEMPENO.map((c) => p[c.key])]),
        lineas.map(({ r, p }) => [r.clave, nombre(r.escuela), nombreTrimestre(p.trimestre), fechaPba(p.fecha), numeroPba(p.matricula), ...CATEGORIAS_DESEMPENO.map((c) => textoCat(p, c))]))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  return (
    <>
      <Card title="Desempeño académico" action={distrito ? <label class={`${BTN_PRIMARY} cursor-pointer focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2 ${importando || !data ? 'pointer-events-none opacity-50' : ''}`}>
        {importando ? 'Importando…' : 'Importar CSV de ABC'}
        <input type="file" accept=".csv,text/csv" class="sr-only" disabled={importando || !data} onChange={(e) => {
          const archivo = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (archivo) void importar(archivo)
        }} />
      </label> : undefined}>
        <p class="text-sm text-slate-600">{distrito
          ? 'Distribución de estudiantes según sus materias no aprobadas. Cada ciclo lectivo tiene un informe por trimestre; importar un trimestre nunca modifica los otros. Cada escuela se abre para ver el informe completo por año de estudio.'
          : 'Vista de solo lectura de tus escuelas asignadas. El distrito actualiza los datos mediante la importación de ABC.'}</p>
        {resultado && <div class="mt-3"><Alert tone="success">{resultado}</Alert></div>}
      </Card>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      {loading && !data ? <Spinner /> : data && <>
        <div class={`mt-4 grid gap-2 sm:grid-cols-2 ${distrito ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
          <select class={FIELD} aria-label="Ciclo lectivo" value={cicloActivo} onChange={(e) => { setCiclo(e.currentTarget.value); setPagina(1) }}>
            {ciclos.map((c) => <option key={c} value={c}>Ciclo lectivo {c}</option>)}
          </select>
          <input class={FIELD} type="search" aria-label="Buscar escuela" placeholder="Buscar por escuela, clave, CUE o localidad" value={q} onInput={(e) => { setQ(e.currentTarget.value); setPagina(1) }} />
          {distrito && <select class={FIELD} aria-label="Filtrar por inspector" value={inspector} onChange={(e) => { setInspector(e.currentTarget.value); setPagina(1) }}>
            <option value="">Todos los inspectores</option>
            {data.inspectores.map((i) => <option key={i.id} value={i.id}>{i.nombre || i.cuil}</option>)}
          </select>}
          <select class={FIELD} aria-label="Filtrar por agrupamiento de matrícula" value={grupo} onChange={(e) => { setGrupo(e.currentTarget.value); setPagina(1) }}>
            <option value="">Todos los agrupamientos</option>
            {data.grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
          </select>
          <select class={FIELD} aria-label="Ordenar escuelas" value={orden} onChange={(e) => { setOrden(e.currentTarget.value); setPagina(1) }}>
            <option value="clave">Ordenar por clave</option><option value="matricula">Mayor matrícula</option>
            <option value="riesgo">Mayor % con 3 o más no aprobadas</option><option value="aprob">Mayor % con todas aprobadas</option><option value="aprob-asc">Menor % con todas aprobadas</option>
          </select>
        </div>
        <p class="mt-2 text-xs text-slate-500">El orden usa el último trimestre cargado de cada escuela.</p>
        <Card class="mt-4" title={`Escuelas · ${filas.length}`} action={<div class="flex flex-wrap gap-2">
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('xlsx')}>Excel</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('pdf')}>PDF</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('pptx')}>PPTX</button>
        </div>}>
          {!filas.length ? <EmptyState title="Sin datos" text={q || inspector || grupo ? 'Probá con otros filtros.' : distrito ? `No hay informes del ciclo ${cicloActivo}. Importá un CSV de ABC para comenzar.` : `Todavía no hay datos del ciclo ${cicloActivo} para tus escuelas asignadas.`} /> : (
            <div class="-m-4 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  <th class="px-3 py-2">Escuela</th>
                  {TRIMESTRES.map((t) => <th key={t} class="whitespace-nowrap px-3 py-2">{nombreTrimestre(t)}</th>)}
                  <th class="px-3 py-2" />
                </tr></thead>
                <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => <tr key={r.clave} class="hover:bg-slate-50">
                  <td class="min-w-44 px-3 py-2.5"><span class="font-semibold">{nombre(r.escuela)}</span><span class="block font-mono text-xs text-slate-500">{r.clave} · {r.escuela.cue}</span></td>
                  {TRIMESTRES.map((t) => {
                    const p = r.periodos.get(t)
                    return <td key={t} class="min-w-32 px-3 py-2.5">{!p ? <span class="text-xs text-slate-400">Sin informe</span> : <>
                      <span class="text-xs text-slate-500">{numeroPba(p.matricula)} est. · {fechaPba(p.fecha)}</span>
                      <div class="mt-1"><Barra t={p} /></div>
                      <span class="mt-1 block text-xs"><b class="text-emerald-700">{porcentajeTexto(pct(p.aprobadas, p.matricula))}</b> aprob. · <b class="text-red-700">{porcentajeTexto(pct(enRiesgo(p), p.matricula))}</b> con 3+</span>
                    </>}</td>
                  })}
                  <td class="px-3 py-2.5"><button class={BTN_SECONDARY} onClick={() => setAbierta(r)}>Ver informe</button></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Pager page={pagina} total={filas.length} onPage={setPagina} />
        <Leyenda />
      </>}
      {abierta && <Informe resumen={abierta} ciclo={cicloActivo} onClose={() => setAbierta(null)} />}
    </>
  )
}

function Informe({ resumen, ciclo, onClose }: { resumen: Resumen; ciclo: string; onClose(): void }) {
  const anios = [...new Set([...resumen.periodos.values()].flatMap((p) => p.anios.map((a) => a.anio)))].sort((a, b) => ordenAnio(a) - ordenAnio(b))
  const lineas = [...anios.map((a) => ({ etiqueta: a, trimestres: TRIMESTRES.map((t) => {
    const f = resumen.periodos.get(t)?.anios.find((x) => x.anio === a)
    return f ? { t, fecha: f.fecha, tot: { matricula: f.matricula ?? 0, ...Object.fromEntries(CATEGORIAS_DESEMPENO.map((c) => [c.key, f[c.key] ?? 0])) } as Totales } : { t, fecha: '', tot: null }
  }) })),
  { etiqueta: 'Total escuela', trimestres: TRIMESTRES.map((t) => { const p = resumen.periodos.get(t); return { t, fecha: p?.fecha ?? '', tot: p ?? null } }) }]
  const exportar = async (tipo: 'xlsx' | 'pdf' | 'pptx') => {
    try {
      const planas = lineas.flatMap((l) => l.trimestres.filter((x) => x.tot).map((x) => ({ etiqueta: l.etiqueta, ...x, tot: x.tot! })))
      await descargarTabla(tipo, `desempeno-${resumen.clave}-${ciclo}`, `Desempeño ${resumen.clave}`, `${nombre(resumen.escuela)} · Ciclo ${ciclo} · informe por año de estudio`,
        ['Año', 'Trimestre', 'Fecha', 'Matrícula', ...CATEGORIAS_DESEMPENO.flatMap((c) => [c.label, `% ${c.label}`])], [14, 12, 11, 10, ...CATEGORIAS_DESEMPENO.flatMap(() => [12, 12])],
        planas.map((l) => [l.etiqueta, nombreTrimestre(l.t), fechaPba(l.fecha), l.tot.matricula, ...CATEGORIAS_DESEMPENO.flatMap((c) => [l.tot[c.key], pct(l.tot[c.key], l.tot.matricula)])]),
        planas.map((l) => [l.etiqueta, nombreTrimestre(l.t), fechaPba(l.fecha), numeroPba(l.tot.matricula), ...CATEGORIAS_DESEMPENO.map((c) => textoCat(l.tot, c))]))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }
  return <Modal title={`Desempeño · ${nombre(resumen.escuela)}`} onClose={onClose} wide>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-slate-600">{resumen.clave} · Ciclo lectivo {ciclo}</p>
      <div class="flex flex-wrap gap-2"><button class={BTN_SECONDARY} onClick={() => void exportar('xlsx')}>Excel</button><button class={BTN_SECONDARY} onClick={() => void exportar('pdf')}>PDF</button><button class={BTN_SECONDARY} onClick={() => void exportar('pptx')}>PPTX</button></div>
    </div>
    <div class="overflow-x-auto rounded-md border border-slate-200">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
          <th class="px-3 py-2">Año</th>{TRIMESTRES.map((t) => <th key={t} class="whitespace-nowrap px-3 py-2">{nombreTrimestre(t)}</th>)}
        </tr></thead>
        <tbody class="divide-y divide-slate-100">{lineas.map((l) => <tr key={l.etiqueta} class={l.etiqueta === 'Total escuela' ? 'bg-slate-50 font-semibold' : ''}>
          <td class="whitespace-nowrap px-3 py-2 align-top">{l.etiqueta}</td>
          {l.trimestres.map(({ t, fecha, tot }) => <td key={t} class="min-w-52 px-3 py-2 align-top">{!tot ? <span class="text-xs font-normal text-slate-400">Sin informe</span> : <>
            <span class="text-xs font-normal text-slate-500">{numeroPba(tot.matricula)} est. · {fechaPba(fecha)}</span>
            <div class="mt-1"><Barra t={tot} /></div>
            <div class="mt-1 grid grid-cols-2 gap-x-2 text-xs font-normal">
              {CATEGORIAS_DESEMPENO.map((c) => <span key={c.key} class={c.texto} title={c.label}>{numeroPba(tot[c.key])} · {porcentajeTexto(pct(tot[c.key], tot.matricula))}</span>)}
            </div>
          </>}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <Leyenda />
    <p class="mt-2 text-xs text-slate-500">Orden de los valores en cada celda: ver colores de la leyenda (todas aprobadas, 1 o 2, 3 o 4, 5 o más, todas no aprobadas, sin información).</p>
  </Modal>
}
