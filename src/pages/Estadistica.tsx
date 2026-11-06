import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync } from '../lib/hooks'
import { descargar, XLSX_MIME } from '../lib/download'
import { buildPdf } from '../lib/export'
import { coincideAgrupamiento, diferencia, diferenciaPba, fechaPba, leerMatriculaPba, numeroPba, type MatriculaPba } from '../lib/estadisticaPba'
import { BRAND } from '../modules'
import { cargar, mensaje, nombre, type Escuela } from './estadisticaDatos'
import { FichasInscripcion } from './EstadisticaFichas'
import { SalidasSinIngreso } from './EstadisticaSalidas'
import { MatriculaSinCierre } from './EstadisticaSinCierre'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, PAGE_SIZE, PageHeader, Pager, Spinner, TabBar, toast, type TabItem } from '../ui/kit'
import { Icon } from '../ui/Icon'

interface Registro extends MatriculaPba { fecha: string }
interface Fila extends Registro { escuela: Escuela }
const TABS: TabItem[] = [
  { id: 'pba', label: 'Matrícula PBA', icon: 'chart', color: 'cyan' },
  { id: 'fichas', label: 'Fichas de Inscripción', icon: 'chart', color: 'indigo' },
  { id: 'salidas', label: 'Salidas sin ingreso', icon: 'chart', color: 'rose' },
  { id: 'sincierre', label: 'Matrícula sin cerrar', icon: 'chart', color: 'amber' },
]
export function Estadistica() {
  const { user } = useAuth()
  const [tab, setTab] = useState('pba')
  const distrito = user?.role === 'distrital'
  return <>
    <PageHeader title="Estadística" subtitle={distrito ? 'Información provincial de las escuelas del distrito' : 'Información provincial de tus escuelas asignadas'} />
    <TabBar label="Estadística" items={TABS} active={tab} onChange={setTab} />
    {tab === 'pba' ? <EstadisticaVista key={`${user?.id}:${user?.role}`} distrito={distrito} /> : tab === 'fichas' ? <FichasInscripcion key={`${user?.id}:${user?.role}`} distrito={distrito} /> : tab === 'salidas' ? <SalidasSinIngreso key={`${user?.id}:${user?.role}`} distrito={distrito} /> : <MatriculaSinCierre key={`${user?.id}:${user?.role}`} distrito={distrito} />}
  </>
}

function EstadisticaVista({ distrito }: { distrito: boolean }) {
  const { data, loading, error, reload } = useAsync(() => cargar<Registro>(distrito, 'estadistica_matricula_pba', 'clave,fecha,activa,anterior,inicial'), [distrito])
  const [q, setQ] = useState('')
  const [inspector, setInspector] = useState('')
  const [grupo, setGrupo] = useState('')
  const [orden, setOrden] = useState('clave')
  const [pagina, setPagina] = useState(1)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState('')
  const filas = useMemo(() => {
    const buscar = q.trim().toLocaleLowerCase('es-AR')
    const seleccion = inspector && distrito ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
    const asignadas = inspector && distrito ? new Set(seleccion?.escuelas_asignadas ?? []) : null
    const codigos = grupo ? new Set(data?.codigosGrupo.filter((c) => String(c.agrupamiento_id) === grupo).map((c) => c.codigo) ?? []) : null
    const lista = (data?.filas ?? []).filter((r) =>
      (!asignadas || asignadas.has(r.clave)) &&
      coincideAgrupamiento(data?.codigosPorClave.get(r.clave), codigos) &&
      [r.clave, r.escuela.cue, r.escuela.codigo, r.escuela.numero, r.escuela.nombre, r.escuela.localidad].join(' ').toLocaleLowerCase('es-AR').includes(buscar))
    const valor = (r: Fila) => orden === 'activa-desc' || orden === 'activa-asc' ? r.activa
      : orden === 'anterior' ? (diferencia(r.activa, r.anterior).valor === null ? null : Math.abs(diferencia(r.activa, r.anterior).valor!))
        : diferencia(r.activa, r.inicial).valor
    return lista.sort((a, b) => {
      if (orden === 'clave') return a.clave.localeCompare(b.clave)
      const x = valor(a), y = valor(b)
      if (x === null) return y === null ? a.clave.localeCompare(b.clave) : 1
      if (y === null) return -1
      return (orden === 'activa-asc' || orden === 'disminucion' ? x - y : y - x) || a.clave.localeCompare(b.clave)
    })
  }, [data, q, orden, inspector, distrito, grupo])

  const importar = async (archivo: File) => {
    setImportando(true)
    setResultado('')
    try {
      if (!data) throw new Error('Esperá a que termine la carga de escuelas.')
      if (!archivo.name.toLowerCase().endsWith('.csv')) throw new Error('Seleccioná un archivo CSV descargado de ABC.')
      const doc = await leerMatriculaPba(await archivo.text())
      const escuelas = doc.filas.filter((f) => data.claves.has(f.clave))
      if (!escuelas.length) throw new Error('El archivo no contiene escuelas del padrón distrital.')
      const r = await supabase.rpc('estadistica_pba_importar', { p_fecha: doc.fecha, p_filas: escuelas })
      if (r.error) throw r.error
      const total = r.data as { guardadas: number; anteriores: number }
      setResultado(`Fecha del archivo: ${fechaPba(doc.fecha)}. ${total.guardadas} escuelas guardadas; ${total.anteriores} conservaron datos más recientes. ${doc.filas.length - escuelas.length} filas fuera del padrón distrital no se importaron.`)
      toast.ok('Importación finalizada')
      setPagina(1)
      reload()
    } catch (e) { toast.error(mensaje(e)) }
    finally { setImportando(false) }
  }

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    try {
      const headers = ['Clave', 'CUE', 'Escuela', 'Fecha', 'Activa', 'Anterior', 'Inicial', 'Dif. inicial', '% inicial', 'Dif. anterior', '% anterior']
      const datos = filas.map((r) => {
        const inicial = diferencia(r.activa, r.inicial), anterior = diferencia(r.activa, r.anterior)
        return [r.clave, r.escuela.cue, nombre(r.escuela), fechaPba(r.fecha), r.activa, r.anterior, r.inicial, inicial.valor, inicial.porcentaje, anterior.valor, anterior.porcentaje]
      })
      if (tipo === 'xlsx') {
        const XLSX = await import('xlsx')
        const hoja = XLSX.utils.aoa_to_sheet([headers, ...datos])
        hoja['!cols'] = [14, 14, 24, 13, 11, 11, 11, 13, 12, 14, 12].map((wch) => ({ wch }))
        const libro = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(libro, hoja, 'Matrícula PBA')
        descargar(new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' })), 'matricula-pba.xlsx', XLSX_MIME)
      } else {
        const respuesta = await fetch(`${import.meta.env.BASE_URL}icon-192.png`)
        if (!respuesta.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        const seleccionado = distrito && inspector ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
        const agrupamiento = data?.grupos.find((g) => String(g.id) === grupo)
        const pdf = await buildPdf({
          title: 'Matrícula PBA',
          subtitle: `${filas.length} escuelas · ${[seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`].filter(Boolean).join(' · ') || 'datos filtrados'}`,
          headers: ['Clave', 'CUE', 'Escuela', 'Fecha', 'Activa', 'Anterior', 'Inicial', 'Dif. inicial', 'Dif. anterior'],
          widths: [13, 12, 18, 12, 8, 8, 8, 17, 17],
          rows: filas.map((r) => [r.clave, r.escuela.cue, nombre(r.escuela), fechaPba(r.fecha),
            numeroPba(r.activa), numeroPba(r.anterior), numeroPba(r.inicial),
            diferenciaPba(r.activa, r.inicial), diferenciaPba(r.activa, r.anterior)]),
        }, {
          brand: { name: BRAND.name, logo: new Uint8Array(await respuesta.arrayBuffer()) },
          indicators: filas.map((r) => [null, null, null, null, null, null, null, diferencia(r.activa, r.inicial).valor, diferencia(r.activa, r.anterior).valor]),
        })
        descargar(pdf, 'matricula-pba.pdf', 'application/pdf')
      }
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  return (
    <>
      <Card title="Matrícula PBA" action={distrito ? <label class={`${BTN_PRIMARY} cursor-pointer focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2 ${importando || !data ? 'pointer-events-none opacity-50' : ''}`}>
        {importando ? 'Importando…' : 'Importar CSV de ABC'}
        <input type="file" accept=".csv,text/csv" class="sr-only" disabled={importando || !data} onChange={(e) => {
          const archivo = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (archivo) void importar(archivo)
        }} />
      </label> : undefined}>
        <p class="text-sm text-slate-600">{distrito
          ? 'Se actualizan solo las escuelas del padrón distrital. Los datos más recientes y las escuelas ausentes del archivo se conservan.'
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
            <option value="clave">Ordenar por clave</option><option value="activa-desc">Mayor matrícula activa</option><option value="activa-asc">Menor matrícula activa</option>
            <option value="incremento">Mayor incremento vs. inicial</option><option value="disminucion">Mayor disminución vs. inicial</option><option value="anterior">Mayor diferencia absoluta vs. año anterior</option>
          </select>
        </div>
        <Graficos filas={filas} />
        <Card class="mt-4" title={`Escuelas · ${filas.length}`} action={<div class="flex flex-wrap gap-2">
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('xlsx')}>Excel</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('pdf')}>PDF</button>
        </div>}>
          {!filas.length ? <EmptyState title="Sin datos" text={q || inspector || grupo ? 'Probá con otros filtros.' : distrito ? 'Importá un CSV de ABC para comenzar.' : 'Todavía no hay datos para tus escuelas asignadas.'} /> : <>
            <div class="-m-4 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {['Escuela', 'Fecha ABC', 'Activa', 'Año anterior', 'Relev. inicial', 'Dif. inicial', 'Dif. año anterior'].map((h) => <th key={h} class="whitespace-nowrap px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => <tr key={r.clave} class="hover:bg-slate-50">
                  <td class="min-w-44 px-3 py-2.5"><span class="font-semibold">{nombre(r.escuela)}</span><span class="block font-mono text-xs text-slate-500">{r.clave} · {r.escuela.cue}</span></td>
                  <td class="whitespace-nowrap px-3 py-2.5">{fechaPba(r.fecha)}</td>
                  <td class="px-3 py-2.5 font-semibold">{numeroPba(r.activa)}</td><td class="px-3 py-2.5">{numeroPba(r.anterior)}</td><td class="px-3 py-2.5">{numeroPba(r.inicial)}</td>
                  <td class="whitespace-nowrap px-3 py-2.5"><Diferencia actual={r.activa} base={r.inicial} /></td>
                  <td class="whitespace-nowrap px-3 py-2.5"><Diferencia actual={r.activa} base={r.anterior} /></td>
                </tr>)}</tbody>
              </table>
            </div>
          </>}
        </Card>
        <Pager page={pagina} total={filas.length} onPage={setPagina} />
        <p class="mt-3 text-xs text-slate-500">Las diferencias se calculan contra la matrícula activa. El porcentaje usa el valor de referencia; si es cero o falta, no se calcula. Los gráficos pueden combinar fechas de actualización distintas. Excel y PDF incluyen todas las filas filtradas.</p>
      </>}
    </>
  )
}

function Diferencia({ actual, base }: { actual: number | null; base: number | null }) {
  const { valor } = diferencia(actual, base)
  if (valor === null) return <span class="text-slate-500">Sin dato</span>
  const estado = valor > 0
    ? { icon: 'arrow-up', color: 'text-emerald-700', label: 'Incremento' } as const
    : valor < 0
      ? { icon: 'arrow-down', color: 'text-red-700', label: 'Descenso' } as const
      : { icon: 'equals', color: 'text-slate-500', label: 'Sin cambios' } as const
  return <span class={`inline-flex items-center gap-1 font-medium ${estado.color}`}>
    <Icon name={estado.icon} class="size-4 shrink-0" />
    <span class="sr-only">{estado.label}: </span>{diferenciaPba(actual, base)}
  </span>
}

function Graficos({ filas }: { filas: Fila[] }) {
  const pares = (base: 'inicial' | 'anterior') => {
    const validas = filas.filter((f) => f.activa !== null && f[base] !== null)
    return { cantidad: validas.length, activa: validas.reduce((s, f) => s + f.activa!, 0), base: validas.reduce((s, f) => s + f[base]!, 0) }
  }
  const inicial = pares('inicial'), anterior = pares('anterior')
  const grafico = (titulo: string, dato: ReturnType<typeof pares>) => {
    const max = Math.max(dato.activa, dato.base, 1)
    return <Card title={titulo}>
      <p class="mb-3 text-xs text-slate-500">{dato.cantidad} escuelas con ambos valores · según filtros</p>
      {([['Activa', dato.activa, 'bg-cyan-500'], ['Referencia', dato.base, 'bg-indigo-400']] as const).map(([label, valor, color]) => <div key={label} class="mb-2">
        <div class="flex justify-between text-xs text-slate-600"><span>{label}</span><strong>{numeroPba(valor)}</strong></div>
        <div class="mt-1 h-3 overflow-hidden rounded-full bg-slate-100"><div class={`h-full rounded-full ${color}`} style={{ width: `${valor * 100 / max}%` }} /></div>
      </div>)}
      {!dato.cantidad && <p class="text-xs text-slate-500">Sin datos comparables.</p>}
    </Card>
  }
  return <div class="mt-4 grid gap-3 md:grid-cols-2">{grafico('Activa vs. relevamiento inicial', inicial)}{grafico('Activa vs. año anterior', anterior)}</div>
}
