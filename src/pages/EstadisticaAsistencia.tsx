import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { coincideAgrupamiento, fechaPba, numeroPba } from '../lib/estadisticaPba'
import { leerAsistencia, ordenAnio, porcentajeAsistencia, TRAMOS_ASISTENCIA, type Asistencia } from '../lib/estadisticaAsistencia'
import { porcentajeTexto } from '../lib/estadisticaFichas'
import { cargar, descargarTabla as descargarBase, type DescargaArgs, mensaje, nombre, type Escuela } from './estadisticaDatos'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Modal, PAGE_SIZE, Pager, Spinner, toast } from '../ui/kit'

type DescargaResto = DescargaArgs extends [unknown, unknown, unknown, ...infer R] ? R : never
type Fila = Asistencia & { fecha: string; ciclo: number | null; escuela: Escuela }
type Totales = { matricula: number } & Record<typeof TRAMOS_ASISTENCIA[number]['key'], number>
interface Resumen extends Totales { clave: string; escuela: Escuela; fecha: string; ciclo: number | null; anios: Fila[] }
const CAMPOS = ['clave', 'anio', 'fecha', 'ciclo', 'matricula', ...TRAMOS_ASISTENCIA.map((t) => t.key)].join(',')
const vacio = (): Totales => ({ matricula: 0, menos_10: 0, de_10_19: 0, de_20_27: 0, de_28_44: 0, mas_45: 0, sin_info: 0 })
const sumar = (t: Totales, f: Fila) => { t.matricula += f.matricula ?? 0; for (const x of TRAMOS_ASISTENCIA) t[x.key] += f[x.key] ?? 0 }
const criticos = (t: Totales) => t.de_28_44 + t.mas_45
const pct = (n: number, t: number) => porcentajeAsistencia(n, t)

const descargarTabla = (tipo: 'xlsx' | 'pdf', archivo: string, ...resto: DescargaResto) => descargarBase(tipo, archivo, 'Asistencia', ...resto)

function Barra({ t }: { t: Totales }) {
  const suma = TRAMOS_ASISTENCIA.reduce((s, x) => s + t[x.key], 0)
  return <div class="flex h-2.5 min-w-32 overflow-hidden rounded-full bg-slate-100" role="img"
    aria-label={TRAMOS_ASISTENCIA.map((x) => `${x.label}: ${t[x.key]}`).join(', ')}>
    {suma > 0 && TRAMOS_ASISTENCIA.map((x) => <div key={x.key} class={x.color} style={{ width: `${t[x.key] * 100 / suma}%` }} />)}
  </div>
}

export function AsistenciaEstadistica({ distrito }: { distrito: boolean }) {
  const { data, loading, error, reload } = useAsync(() => cargar<Fila>(distrito, 'estadistica_asistencia', CAMPOS, 'anio'), [distrito])
  const [q, setQ] = useState('')
  const [inspector, setInspector] = useState('')
  const [grupo, setGrupo] = useState('')
  const [orden, setOrden] = useState('clave')
  const [pagina, setPagina] = useState(1)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState('')
  const [abierta, setAbierta] = useState<Resumen | null>(null)

  const resumenes = useMemo(() => {
    const mapa = new Map<string, Resumen>()
    for (const f of data?.filas ?? []) {
      let r = mapa.get(f.clave)
      if (!r) mapa.set(f.clave, r = { ...vacio(), clave: f.clave, escuela: f.escuela, fecha: f.fecha, ciclo: f.ciclo, anios: [] })
      sumar(r, f)
      if (f.fecha > r.fecha) r.fecha = f.fecha
      r.anios.push(f)
    }
    for (const r of mapa.values()) r.anios.sort((a, b) => ordenAnio(a.anio) - ordenAnio(b.anio))
    return [...mapa.values()]
  }, [data])

  const filas = useMemo(() => {
    const buscar = q.trim().toLocaleLowerCase('es-AR')
    const seleccion = inspector && distrito ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
    const asignadas = inspector && distrito ? new Set(seleccion?.escuelas_asignadas ?? []) : null
    const codigos = grupo ? new Set(data?.codigosGrupo.filter((c) => String(c.agrupamiento_id) === grupo).map((c) => c.codigo) ?? []) : null
    const valor = (r: Resumen): number | null => orden === 'matricula' ? r.matricula
      : orden === 'criticos' ? pct(criticos(r), r.matricula)
        : orden === 'mas45' ? pct(r.mas_45, r.matricula)
          : orden === 'regulares' ? pct(r.menos_10, r.matricula) : null
    return resumenes.filter((r) =>
      (!asignadas || asignadas.has(r.clave)) &&
      coincideAgrupamiento(data?.codigosPorClave.get(r.clave), codigos) &&
      [r.clave, r.escuela.cue, r.escuela.codigo, r.escuela.numero, r.escuela.nombre, r.escuela.localidad].join(' ').toLocaleLowerCase('es-AR').includes(buscar))
      .sort((a, b) => {
        if (orden === 'clave') return a.clave.localeCompare(b.clave)
        const x = valor(a), y = valor(b)
        if (x === null) return y === null ? a.clave.localeCompare(b.clave) : 1
        if (y === null) return -1
        return (orden === 'regulares-asc' ? x - y : y - x) || a.clave.localeCompare(b.clave)
      })
  }, [resumenes, data, q, orden, inspector, distrito, grupo])

  const importar = async (archivo: File) => {
    setImportando(true)
    setResultado('')
    try {
      if (!data) throw new Error('Esperá a que termine la carga de escuelas.')
      if (!archivo.name.toLowerCase().endsWith('.csv')) throw new Error('Seleccioná un archivo CSV descargado de ABC.')
      const doc = await leerAsistencia(await archivo.text())
      const filasDistrito = doc.filas.filter((f) => data.claves.has(f.clave))
      if (!filasDistrito.length) throw new Error('El archivo no contiene escuelas del padrón distrital.')
      const r = await supabase.rpc('estadistica_asistencia_importar', { p_fecha: doc.fecha, p_ciclo: doc.ciclo, p_filas: filasDistrito })
      if (r.error) throw r.error
      const total = r.data as { guardadas: number; anteriores: number }
      setResultado(`Fecha del archivo: ${fechaPba(doc.fecha)}${doc.ciclo ? ` (ciclo ${doc.ciclo})` : ''}. ${total.guardadas} registros por año guardados; ${total.anteriores} conservaron datos más recientes. ${doc.filas.length - filasDistrito.length} filas fuera del padrón distrital no se importaron.`)
      toast.ok('Importación finalizada')
      setPagina(1)
      reload()
    } catch (e) { toast.error(mensaje(e)) }
    finally { setImportando(false) }
  }

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    try {
      const seleccionado = distrito && inspector ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
      const agrupamiento = data?.grupos.find((g) => String(g.id) === grupo)
      const filtros = [seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`].filter(Boolean).join(' · ')
      await descargarTabla(tipo, 'asistencia', 'Asistencia: condición de inasistencias', `${filas.length} escuelas · ${filtros || 'datos filtrados'}`,
        ['Clave', 'CUE', 'Escuela', 'Fecha', 'Matrícula', ...TRAMOS_ASISTENCIA.flatMap((t) => [t.label, `% ${t.label}`])], [14, 14, 28, 12, 11, ...TRAMOS_ASISTENCIA.flatMap(() => [11, 11])],
        filas.map((r) => [r.clave, r.escuela.cue, nombre(r.escuela), fechaPba(r.fecha), r.matricula, ...TRAMOS_ASISTENCIA.flatMap((t) => [r[t.key], pct(r[t.key], r.matricula)])]),
        filas.map((r) => [r.clave, nombre(r.escuela), fechaPba(r.fecha), numeroPba(r.matricula), ...TRAMOS_ASISTENCIA.map((t) => `${numeroPba(r[t.key])} (${porcentajeTexto(pct(r[t.key], r.matricula))})`)]))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  const total = filas.reduce((t, r) => { sumar(t, { ...r, anio: '', clave: '', fecha: '', ciclo: null } as Fila); return t }, vacio())

  return (
    <>
      <Card title="Asistencia" action={distrito ? <label class={`${BTN_PRIMARY} cursor-pointer focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2 ${importando || !data ? 'pointer-events-none opacity-50' : ''}`}>
        {importando ? 'Importando…' : 'Importar CSV de ABC'}
        <input type="file" accept=".csv,text/csv" class="sr-only" disabled={importando || !data} onChange={(e) => {
          const archivo = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (archivo) void importar(archivo)
        }} />
      </label> : undefined}>
        <p class="text-sm text-slate-600">{distrito
          ? 'Distribución de estudiantes según su cantidad de inasistencias. Cada escuela se abre para ver el informe por año de estudio. Los datos se actualizan por escuela y año; lo más reciente y lo ausente del archivo se conserva.'
          : 'Vista de solo lectura de tus escuelas asignadas. El distrito actualiza los datos mediante la importación de ABC.'}</p>
        {resultado && <div class="mt-3"><Alert tone="success">{resultado}</Alert></div>}
      </Card>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      {loading && !data ? <Spinner /> : data && <>
        <div class={`mt-4 grid gap-2 ${distrito ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
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
            <option value="criticos">Mayor % con 28 o más inasistencias</option><option value="mas45">Mayor % con 45 y más</option>
            <option value="regulares">Mayor % con menos de 10</option><option value="regulares-asc">Menor % con menos de 10</option>
          </select>
        </div>
        <Card class="mt-4" title="Resumen según filtros">
          <p class="mb-3 text-xs text-slate-500">{filas.length} escuelas · {numeroPba(total.matricula)} estudiantes</p>
          <Barra t={total} />
          <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {TRAMOS_ASISTENCIA.map((t) => <div key={t.key} class="rounded-lg border border-slate-200 bg-white p-2 text-center">
              <div class={`text-lg font-bold ${t.texto}`}>{numeroPba(total[t.key])}</div>
              <div class="text-xs text-slate-500">{t.label}</div>
              <div class={`text-xs font-medium ${t.texto}`}>{porcentajeTexto(pct(total[t.key], total.matricula))}</div>
            </div>)}
          </div>
        </Card>
        <Card class="mt-4" title={`Escuelas · ${filas.length}`} action={<div class="flex flex-wrap gap-2">
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('xlsx')}>Excel</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('pdf')}>PDF</button>
        </div>}>
          {!filas.length ? <EmptyState title="Sin datos" text={q || inspector || grupo ? 'Probá con otros filtros.' : distrito ? 'Importá un CSV de ABC para comenzar.' : 'Todavía no hay datos para tus escuelas asignadas.'} /> : (
            <div class="-m-4 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {['Escuela', 'Fecha ABC', 'Matrícula', 'Distribución', '< 10', '28 o más', ''].map((h) => <th key={h} class="whitespace-nowrap px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => <tr key={r.clave} class="hover:bg-slate-50">
                  <td class="min-w-44 px-3 py-2.5"><span class="font-semibold">{nombre(r.escuela)}</span><span class="block font-mono text-xs text-slate-500">{r.clave} · {r.escuela.cue}</span></td>
                  <td class="whitespace-nowrap px-3 py-2.5">{fechaPba(r.fecha)}</td>
                  <td class="px-3 py-2.5 font-semibold">{numeroPba(r.matricula)}</td>
                  <td class="px-3 py-2.5"><Barra t={r} /></td>
                  <td class="whitespace-nowrap px-3 py-2.5 font-medium text-emerald-700">{porcentajeTexto(pct(r.menos_10, r.matricula))}</td>
                  <td class="whitespace-nowrap px-3 py-2.5 font-medium text-red-700">{porcentajeTexto(pct(criticos(r), r.matricula))}</td>
                  <td class="px-3 py-2.5"><button class={BTN_SECONDARY} onClick={() => setAbierta(r)}>Ver informe</button></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Pager page={pagina} total={filas.length} onPage={setPagina} />
        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {TRAMOS_ASISTENCIA.map((t) => <span key={t.key} class="inline-flex items-center gap-1.5"><span class={`size-2.5 rounded-full ${t.color}`} />{t.label}</span>)}
        </div>
      </>}
      {abierta && <Informe resumen={abierta} onClose={() => setAbierta(null)} />}
    </>
  )
}

function Informe({ resumen, onClose }: { resumen: Resumen; onClose(): void }) {
  const filas = [...resumen.anios.map((a) => ({ etiqueta: a.anio, t: { matricula: a.matricula ?? 0, ...Object.fromEntries(TRAMOS_ASISTENCIA.map((x) => [x.key, a[x.key] ?? 0])) } as Totales, fecha: a.fecha })),
    { etiqueta: 'Total escuela', t: resumen as Totales, fecha: resumen.fecha }]
  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    try {
      await descargarTabla(tipo, `asistencia-${resumen.clave}`, `Asistencia ${resumen.clave}`, `${nombre(resumen.escuela)} · ${resumen.ciclo ? `Ciclo ${resumen.ciclo} · ` : ''}informe por año de estudio`,
        ['Año', 'Fecha', 'Matrícula', ...TRAMOS_ASISTENCIA.flatMap((t) => [t.label, `% ${t.label}`])], [14, 12, 11, ...TRAMOS_ASISTENCIA.flatMap(() => [11, 11])],
        filas.map((f) => [f.etiqueta, fechaPba(f.fecha), f.t.matricula, ...TRAMOS_ASISTENCIA.flatMap((t) => [f.t[t.key], pct(f.t[t.key], f.t.matricula)])]),
        filas.map((f) => [f.etiqueta, fechaPba(f.fecha), numeroPba(f.t.matricula), ...TRAMOS_ASISTENCIA.map((t) => `${numeroPba(f.t[t.key])} (${porcentajeTexto(pct(f.t[t.key], f.t.matricula))})`)]))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }
  return <Modal title={`Asistencia · ${nombre(resumen.escuela)}`} onClose={onClose} wide>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-slate-600">{resumen.clave}{resumen.ciclo ? ` · Ciclo lectivo ${resumen.ciclo}` : ''} · {resumen.anios.length} años de estudio</p>
      <div class="flex gap-2"><button class={BTN_SECONDARY} onClick={() => void exportar('xlsx')}>Excel</button><button class={BTN_SECONDARY} onClick={() => void exportar('pdf')}>PDF</button></div>
    </div>
    <div class="overflow-x-auto rounded-md border border-slate-200">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
          <th class="px-3 py-2">Año</th><th class="px-3 py-2">Matrícula</th><th class="px-3 py-2">Distribución</th>
          {TRAMOS_ASISTENCIA.map((t) => <th key={t.key} class="whitespace-nowrap px-3 py-2">{t.label}</th>)}
        </tr></thead>
        <tbody class="divide-y divide-slate-100">{filas.map((f) => <tr key={f.etiqueta} class={f.etiqueta === 'Total escuela' ? 'bg-slate-50 font-semibold' : ''}>
          <td class="whitespace-nowrap px-3 py-2">{f.etiqueta}<span class="block text-xs font-normal text-slate-500">{fechaPba(f.fecha)}</span></td>
          <td class="px-3 py-2">{numeroPba(f.t.matricula)}</td>
          <td class="px-3 py-2"><Barra t={f.t} /></td>
          {TRAMOS_ASISTENCIA.map((t) => <td key={t.key} class="whitespace-nowrap px-3 py-2"><span class={`font-medium ${t.texto}`}>{numeroPba(f.t[t.key])}</span><span class="block text-xs text-slate-500">{porcentajeTexto(pct(f.t[t.key], f.t.matricula))}</span></td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {TRAMOS_ASISTENCIA.map((t) => <span key={t.key} class="inline-flex items-center gap-1.5"><span class={`size-2.5 rounded-full ${t.color}`} />{t.label}</span>)}
    </div>
  </Modal>
}
