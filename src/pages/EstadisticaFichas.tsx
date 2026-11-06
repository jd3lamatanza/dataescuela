import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { descargar, XLSX_MIME } from '../lib/download'
import { buildPdf } from '../lib/export'
import { coincideAgrupamiento, fechaPba, numeroPba } from '../lib/estadisticaPba'
import { CATEGORIAS_FICHA, leerFichasInscripcion, porcentajeFicha, porcentajeTexto, type FichaInscripcion } from '../lib/estadisticaFichas'
import { BRAND } from '../modules'
import { cargar, mensaje, nombre, type Escuela } from './estadisticaDatos'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, PAGE_SIZE, Pager, Spinner, toast } from '../ui/kit'

type Fila = FichaInscripcion & { fecha: string; escuela: Escuela }
const CAMPOS = ['clave', 'fecha', 'matricula', ...CATEGORIAS_FICHA.map((c) => c.key)].join(',')

const colorPorcentaje = (p: number | null) => p === null ? 'text-slate-500' : p >= 50 ? 'text-red-700' : p >= 20 ? 'text-amber-700' : 'text-emerald-700'

export function FichasInscripcion({ distrito }: { distrito: boolean }) {
  const { data, loading, error, reload } = useAsync(() => cargar<Fila>(distrito, 'estadistica_fichas_inscripcion', CAMPOS), [distrito])
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
    const [modo, campo] = orden.split(':')
    const valor = (r: Fila): number | null => modo === 'matricula' ? r.matricula
      : modo === 'n' ? r[campo as keyof FichaInscripcion] as number | null
        : modo === 'p' ? porcentajeFicha(r[campo as keyof FichaInscripcion] as number | null, r.matricula) : null
    return lista.sort((a, b) => {
      if (orden === 'clave') return a.clave.localeCompare(b.clave)
      const x = valor(a), y = valor(b)
      if (x === null) return y === null ? a.clave.localeCompare(b.clave) : 1
      if (y === null) return -1
      return (orden === 'matricula:asc' ? x - y : y - x) || a.clave.localeCompare(b.clave)
    })
  }, [data, q, orden, inspector, distrito, grupo])

  const importar = async (archivo: File) => {
    setImportando(true)
    setResultado('')
    try {
      if (!data) throw new Error('Esperá a que termine la carga de escuelas.')
      if (!archivo.name.toLowerCase().endsWith('.csv')) throw new Error('Seleccioná un archivo CSV descargado de ABC.')
      const doc = await leerFichasInscripcion(await archivo.text())
      const escuelas = doc.filas.filter((f) => data.claves.has(f.clave))
      if (!escuelas.length) throw new Error('El archivo no contiene escuelas del padrón distrital.')
      const r = await supabase.rpc('estadistica_fichas_importar', { p_fecha: doc.fecha, p_filas: escuelas })
      if (r.error) throw r.error
      const total = r.data as { guardadas: number; anteriores: number }
      setResultado(`Fecha del archivo: ${fechaPba(doc.fecha)}. ${total.guardadas} escuelas guardadas; ${total.anteriores} conservaron datos más recientes. ${doc.filas.length - escuelas.length} filas fuera del padrón distrital no se importaron.`)
      toast.ok('Importación finalizada')
      setPagina(1)
      reload()
    } catch (e) { toast.error(mensaje(e)) }
    finally { setImportando(false) }
  }

  const celda = (r: Fila, key: typeof CATEGORIAS_FICHA[number]['key']) => `${numeroPba(r[key])} (${porcentajeTexto(porcentajeFicha(r[key], r.matricula))})`

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    try {
      if (tipo === 'xlsx') {
        const XLSX = await import('xlsx')
        const headers = ['Clave', 'CUE', 'Escuela', 'Fecha', 'Matrícula total', ...CATEGORIAS_FICHA.flatMap((c) => [c.label, `% ${c.label}`])]
        const datos = filas.map((r) => [r.clave, r.escuela.cue, nombre(r.escuela), fechaPba(r.fecha), r.matricula,
          ...CATEGORIAS_FICHA.flatMap((c) => [r[c.key], porcentajeFicha(r[c.key], r.matricula)])])
        const hoja = XLSX.utils.aoa_to_sheet([headers, ...datos])
        hoja['!cols'] = headers.map((_, i) => ({ wch: i < 3 ? 16 : 13 }))
        const libro = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(libro, hoja, 'Fichas de inscripción')
        descargar(new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' })), 'fichas-inscripcion.xlsx', XLSX_MIME)
      } else {
        const respuesta = await fetch(`${import.meta.env.BASE_URL}icon-192.png`)
        if (!respuesta.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        const seleccionado = distrito && inspector ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
        const agrupamiento = data?.grupos.find((g) => String(g.id) === grupo)
        const pdf = await buildPdf({
          title: 'Fichas de inscripción con datos faltantes',
          subtitle: `${filas.length} escuelas · ${[seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`].filter(Boolean).join(' · ') || 'datos filtrados'}`,
          headers: ['Clave', 'Escuela', 'Fecha', 'Matrícula', ...CATEGORIAS_FICHA.map((c) => c.label)],
          widths: [12, 16, 10, 9, ...CATEGORIAS_FICHA.map(() => 11)],
          rows: filas.map((r) => [r.clave, nombre(r.escuela), fechaPba(r.fecha), numeroPba(r.matricula), ...CATEGORIAS_FICHA.map((c) => celda(r, c.key))]),
        }, { brand: { name: BRAND.name, logo: new Uint8Array(await respuesta.arrayBuffer()) } })
        descargar(pdf, 'fichas-inscripcion.pdf', 'application/pdf')
      }
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  return (
    <>
      <Card title="Fichas de Inscripción" action={distrito ? <label class={`${BTN_PRIMARY} cursor-pointer focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2 ${importando || !data ? 'pointer-events-none opacity-50' : ''}`}>
        {importando ? 'Importando…' : 'Importar CSV de ABC'}
        <input type="file" accept=".csv,text/csv" class="sr-only" disabled={importando || !data} onChange={(e) => {
          const archivo = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (archivo) void importar(archivo)
        }} />
      </label> : undefined}>
        <p class="text-sm text-slate-600">{distrito
          ? 'Cantidad de estudiantes con datos incompletos en la ficha de inscripción. Se actualizan solo las escuelas del padrón distrital; los datos más recientes y las escuelas ausentes del archivo se conservan.'
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
            <option value="clave">Ordenar por clave</option>
            <option value="matricula:desc">Mayor matrícula</option><option value="matricula:asc">Menor matrícula</option>
            <optgroup label="Mayor cantidad de faltantes">{CATEGORIAS_FICHA.map((c) => <option key={c.key} value={`n:${c.key}`}>{c.label}</option>)}</optgroup>
            <optgroup label="Mayor porcentaje de faltantes">{CATEGORIAS_FICHA.map((c) => <option key={c.key} value={`p:${c.key}`}>{c.label}</option>)}</optgroup>
          </select>
        </div>
        <Graficos filas={filas} />
        <Card class="mt-4" title={`Escuelas · ${filas.length}`} action={<div class="flex flex-wrap gap-2">
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('xlsx')}>Excel</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('pdf')}>PDF</button>
        </div>}>
          {!filas.length ? <EmptyState title="Sin datos" text={q || inspector || grupo ? 'Probá con otros filtros.' : distrito ? 'Importá un CSV de ABC para comenzar.' : 'Todavía no hay datos para tus escuelas asignadas.'} /> : (
            <div class="-m-4 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {['Escuela', 'Fecha ABC', 'Matrícula', ...CATEGORIAS_FICHA.map((c) => c.label)].map((h) => <th key={h} class="px-3 py-2 align-bottom">{h}</th>)}
                </tr></thead>
                <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => <tr key={r.clave} class="hover:bg-slate-50">
                  <td class="min-w-44 px-3 py-2.5"><span class="font-semibold">{nombre(r.escuela)}</span><span class="block font-mono text-xs text-slate-500">{r.clave} · {r.escuela.cue}</span></td>
                  <td class="whitespace-nowrap px-3 py-2.5">{fechaPba(r.fecha)}</td>
                  <td class="px-3 py-2.5 font-semibold">{numeroPba(r.matricula)}</td>
                  {CATEGORIAS_FICHA.map((c) => {
                    const p = porcentajeFicha(r[c.key], r.matricula)
                    return <td key={c.key} class="whitespace-nowrap px-3 py-2.5"><span class="font-medium">{numeroPba(r[c.key])}</span><span class={`block text-xs font-medium ${colorPorcentaje(p)}`}>{porcentajeTexto(p)}</span></td>
                  })}
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Pager page={pagina} total={filas.length} onPage={setPagina} />
        <p class="mt-3 text-xs text-slate-500">El porcentaje se calcula sobre la matrícula total de cada escuela (verde: menos del 20 %, ámbar: 20 % o más, rojo: 50 % o más). Un mismo estudiante puede tener faltantes en varias categorías. Excel y PDF incluyen todas las filas filtradas.</p>
      </>}
    </>
  )
}

function Graficos({ filas }: { filas: Fila[] }) {
  const matricula = filas.reduce((s, f) => s + (f.matricula ?? 0), 0)
  return <Card class="mt-4" title="Faltantes por categoría">
    <p class="mb-3 text-xs text-slate-500">{filas.length} escuelas · {numeroPba(matricula)} estudiantes de matrícula total · según filtros</p>
    <div class="grid gap-x-6 gap-y-3 md:grid-cols-2">
      {CATEGORIAS_FICHA.map((c) => {
        const n = filas.reduce((s, f) => s + (f[c.key] ?? 0), 0)
        const p = matricula ? n * 100 / matricula : null
        return <div key={c.key}>
          <div class="flex justify-between text-xs text-slate-600"><span>{c.label}</span><strong>{numeroPba(n)} · {porcentajeTexto(p)}</strong></div>
          <div class="mt-1 h-3 overflow-hidden rounded-full bg-slate-100"><div class={`h-full rounded-full ${p !== null && p >= 50 ? 'bg-red-500' : p !== null && p >= 20 ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${Math.min(p ?? 0, 100)}%` }} /></div>
        </div>
      })}
    </div>
  </Card>
}
