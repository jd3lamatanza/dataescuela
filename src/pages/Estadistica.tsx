import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { descargar, descargarPdf, XLSX_MIME } from '../lib/download'
import { diferencia, diferenciaPba, fechaPba, leerMatriculaPba, numeroPba, type MatriculaPba } from '../lib/estadisticaPba'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, PAGE_SIZE, PageHeader, Pager, Spinner, TabBar, toast, type TabItem } from '../ui/kit'

interface Escuela { clave: string | null; cue: string; codigo: string | null; numero: number | null; nombre: string | null; localidad: string | null }
interface Registro extends MatriculaPba { fecha: string }
interface Fila extends Registro { escuela: Escuela }
const TABS: TabItem[] = [{ id: 'pba', label: 'Matrícula PBA', icon: 'chart', color: 'cyan' }]
const nombre = (e: Escuela) => [e.codigo, e.numero].filter(Boolean).join(' ') || e.nombre || e.cue
const mensaje = (e: unknown) => e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)

async function cargar() {
  const escuelas: Escuela[] = []
  const registros: Registro[] = []
  const size = 1000
  for (let desde = 0; ; desde += size) {
    const r = await supabase.from('escuelas').select('clave,cue,codigo,numero,nombre,localidad').order('id').range(desde, desde + size - 1)
    if (r.error) throw r.error
    escuelas.push(...(r.data as Escuela[]))
    if (r.data.length < size) break
  }
  for (let desde = 0; ; desde += size) {
    const r = await supabase.from('estadistica_matricula_pba').select('clave,fecha,activa,anterior,inicial').order('clave').range(desde, desde + size - 1)
    if (r.error) throw r.error
    registros.push(...(r.data as Registro[]))
    if (r.data.length < size) break
  }
  const porClave = new Map<string, Escuela>()
  for (const e of escuelas) if (e.clave && !porClave.has(e.clave)) porClave.set(e.clave, e)
  const filas: Fila[] = []
  for (const r of registros) {
    const escuela = porClave.get(r.clave)
    if (escuela) filas.push({ ...r, escuela })
  }
  return { claves: porClave, filas }
}

export function Estadistica() {
  const { data, loading, error, reload } = useAsync(cargar)
  const [q, setQ] = useState('')
  const [orden, setOrden] = useState('clave')
  const [pagina, setPagina] = useState(1)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState('')
  const filas = useMemo(() => {
    const buscar = q.trim().toLocaleLowerCase('es-AR')
    const lista = (data?.filas ?? []).filter((r) =>
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
  }, [data, q, orden])

  const importar = async (archivo: File) => {
    setImportando(true)
    setResultado('')
    try {
      if (!data) throw new Error('Esperá a que termine la carga de escuelas.')
      if (!archivo.name.toLowerCase().endsWith('.csv')) throw new Error('Seleccioná un archivo CSV descargado de ABC.')
      const doc = await leerMatriculaPba(await archivo.text())
      const asignadas = doc.filas.filter((f) => data.claves.has(f.clave))
      if (!asignadas.length) throw new Error('El archivo no contiene escuelas asignadas a tu área.')
      const r = await supabase.rpc('estadistica_pba_importar', { p_fecha: doc.fecha, p_filas: asignadas })
      if (r.error) throw r.error
      const total = r.data as { guardadas: number; anteriores: number }
      setResultado(`Fecha del archivo: ${fechaPba(doc.fecha)}. ${total.guardadas} escuelas guardadas; ${total.anteriores} conservaron datos más recientes. ${doc.filas.length - asignadas.length} filas fuera de tu área no se importaron.`)
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
        await descargarPdf({ title: 'Matrícula PBA', subtitle: `${filas.length} escuelas · datos filtrados · porcentajes en puntos`, headers,
          widths: [14, 12, 20, 12, 8, 8, 8, 11, 10, 11, 10],
          rows: datos.map((r) => r.map((v) => v === null ? '-' : typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 1 }) : v)) }, 'matricula-pba')
      }
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  return (
    <>
      <PageHeader title="Estadística" subtitle="Información provincial de tus escuelas asignadas" />
      <TabBar label="Estadística" items={TABS} active="pba" onChange={() => {}} />
      <Card title="Matrícula PBA" action={<label class={`${BTN_PRIMARY} cursor-pointer focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2 ${importando || !data ? 'pointer-events-none opacity-50' : ''}`}>
        {importando ? 'Importando…' : 'Importar CSV de ABC'}
        <input type="file" accept=".csv,text/csv" class="sr-only" disabled={importando || !data} onChange={(e) => {
          const archivo = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (archivo) void importar(archivo)
        }} />
      </label>}>
        <p class="text-sm text-slate-600">Se actualizan solo tus escuelas asignadas. Los datos más recientes y las escuelas ausentes del archivo se conservan.</p>
        {resultado && <div class="mt-3"><Alert tone="success">{resultado}</Alert></div>}
      </Card>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      {loading && !data ? <Spinner /> : data && <>
        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <input class={FIELD} type="search" aria-label="Buscar escuela" placeholder="Buscar por escuela, clave, CUE o localidad" value={q} onInput={(e) => { setQ(e.currentTarget.value); setPagina(1) }} />
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
          {!filas.length ? <EmptyState title="Sin datos" text={q ? 'Probá con otra búsqueda.' : 'Importá un CSV de ABC para comenzar.'} /> : <>
            <div class="-m-4 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {['Escuela', 'Fecha ABC', 'Activa', 'Año anterior', 'Relev. inicial', 'Dif. inicial', 'Dif. año anterior'].map((h) => <th key={h} class="whitespace-nowrap px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => <tr key={r.clave} class="hover:bg-slate-50">
                  <td class="min-w-44 px-3 py-2.5"><span class="font-semibold">{nombre(r.escuela)}</span><span class="block font-mono text-xs text-slate-500">{r.clave} · {r.escuela.cue}</span></td>
                  <td class="whitespace-nowrap px-3 py-2.5">{fechaPba(r.fecha)}</td>
                  <td class="px-3 py-2.5 font-semibold">{numeroPba(r.activa)}</td><td class="px-3 py-2.5">{numeroPba(r.anterior)}</td><td class="px-3 py-2.5">{numeroPba(r.inicial)}</td>
                  <td class="whitespace-nowrap px-3 py-2.5">{diferenciaPba(r.activa, r.inicial)}</td><td class="whitespace-nowrap px-3 py-2.5">{diferenciaPba(r.activa, r.anterior)}</td>
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

function Graficos({ filas }: { filas: Fila[] }) {
  const pares = (base: 'inicial' | 'anterior') => {
    const validas = filas.filter((f) => f.activa !== null && f[base] !== null)
    return { cantidad: validas.length, activa: validas.reduce((s, f) => s + f.activa!, 0), base: validas.reduce((s, f) => s + f[base]!, 0) }
  }
  const inicial = pares('inicial'), anterior = pares('anterior')
  const grafico = (titulo: string, dato: ReturnType<typeof pares>) => {
    const max = Math.max(dato.activa, dato.base, 1)
    return <Card title={titulo}>
      <p class="mb-3 text-xs text-slate-500">{dato.cantidad} escuelas con ambos valores · según búsqueda</p>
      {([['Activa', dato.activa, 'bg-cyan-500'], ['Referencia', dato.base, 'bg-indigo-400']] as const).map(([label, valor, color]) => <div key={label} class="mb-2">
        <div class="flex justify-between text-xs text-slate-600"><span>{label}</span><strong>{numeroPba(valor)}</strong></div>
        <div class="mt-1 h-3 overflow-hidden rounded-full bg-slate-100"><div class={`h-full rounded-full ${color}`} style={{ width: `${valor * 100 / max}%` }} /></div>
      </div>)}
      {!dato.cantidad && <p class="text-xs text-slate-500">Sin datos comparables.</p>}
    </Card>
  }
  return <div class="mt-4 grid gap-3 md:grid-cols-2">{grafico('Activa vs. relevamiento inicial', inicial)}{grafico('Activa vs. año anterior', anterior)}</div>
}
