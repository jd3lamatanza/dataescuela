import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { descargar, XLSX_MIME } from '../lib/download'
import { buildPdf } from '../lib/export'
import { coincideAgrupamiento, fechaPba, numeroPba } from '../lib/estadisticaPba'
import { leerSinCierre, type SinCierre } from '../lib/estadisticaSinCierre'
import { BRAND } from '../modules'
import { cargar, mensaje, nombre, type Escuela } from './estadisticaDatos'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, PAGE_SIZE, Pager, Spinner, toast } from '../ui/kit'

type Fila = SinCierre & { fecha: string; escuela: Escuela }

export function MatriculaSinCierre({ distrito }: { distrito: boolean }) {
  const { data, loading, error, reload } = useAsync(() => cargar<Fila>(distrito, 'estadistica_matricula_sin_cierre', 'clave,fecha,sin_cierre'), [distrito])
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
    return (data?.filas ?? []).filter((r) =>
      (!asignadas || asignadas.has(r.clave)) &&
      coincideAgrupamiento(data?.codigosPorClave.get(r.clave), codigos) &&
      [r.clave, r.escuela.cue, r.escuela.codigo, r.escuela.numero, r.escuela.nombre, r.escuela.localidad].join(' ').toLocaleLowerCase('es-AR').includes(buscar))
      .sort((a, b) => {
        if (orden === 'clave') return a.clave.localeCompare(b.clave)
        const x = a.sin_cierre, y = b.sin_cierre
        if (x === null) return y === null ? a.clave.localeCompare(b.clave) : 1
        if (y === null) return -1
        return (orden === 'asc' ? x - y : y - x) || a.clave.localeCompare(b.clave)
      })
  }, [data, q, orden, inspector, distrito, grupo])

  const importar = async (archivo: File) => {
    setImportando(true)
    setResultado('')
    try {
      if (!data) throw new Error('Esperá a que termine la carga de escuelas.')
      if (!archivo.name.toLowerCase().endsWith('.csv')) throw new Error('Seleccioná un archivo CSV descargado de ABC.')
      const doc = await leerSinCierre(await archivo.text())
      const escuelas = doc.filas.filter((f) => data.claves.has(f.clave))
      if (!escuelas.length) throw new Error('El archivo no contiene escuelas del padrón distrital.')
      const r = await supabase.rpc('estadistica_sin_cierre_importar', { p_fecha: doc.fecha, p_filas: escuelas })
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
      if (tipo === 'xlsx') {
        const XLSX = await import('xlsx')
        const hoja = XLSX.utils.aoa_to_sheet([['Clave', 'CUE', 'Escuela', 'Fecha', 'Matrícula sin cierre'],
          ...filas.map((r) => [r.clave, r.escuela.cue, nombre(r.escuela), fechaPba(r.fecha), r.sin_cierre])])
        hoja['!cols'] = [14, 14, 28, 13, 20].map((wch) => ({ wch }))
        const libro = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(libro, hoja, 'Matrícula sin cierre')
        descargar(new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' })), 'matricula-sin-cierre.xlsx', XLSX_MIME)
      } else {
        const respuesta = await fetch(`${import.meta.env.BASE_URL}icon-192.png`)
        if (!respuesta.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        const seleccionado = distrito && inspector ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
        const agrupamiento = data?.grupos.find((g) => String(g.id) === grupo)
        const pdf = await buildPdf({
          title: 'Matrícula sin cierre de años anteriores',
          subtitle: `${filas.length} escuelas · ${[seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`].filter(Boolean).join(' · ') || 'datos filtrados'}`,
          headers: ['Clave', 'CUE', 'Escuela', 'Fecha', 'Matrícula sin cierre'], widths: [13, 12, 30, 12, 16],
          rows: filas.map((r) => [r.clave, r.escuela.cue, nombre(r.escuela), fechaPba(r.fecha), numeroPba(r.sin_cierre)]),
        }, { brand: { name: BRAND.name, logo: new Uint8Array(await respuesta.arrayBuffer()) } })
        descargar(pdf, 'matricula-sin-cierre.pdf', 'application/pdf')
      }
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  const total = filas.reduce((s, r) => s + (r.sin_cierre ?? 0), 0)
  const conPendientes = filas.filter((r) => (r.sin_cierre ?? 0) > 0).length
  const maximo = Math.max(...filas.map((r) => r.sin_cierre ?? 0), 1)

  return (
    <>
      <Card title="Matrícula sin cerrar" action={distrito ? <label class={`${BTN_PRIMARY} cursor-pointer focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2 ${importando || !data ? 'pointer-events-none opacity-50' : ''}`}>
        {importando ? 'Importando…' : 'Importar CSV de ABC'}
        <input type="file" accept=".csv,text/csv" class="sr-only" disabled={importando || !data} onChange={(e) => {
          const archivo = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (archivo) void importar(archivo)
        }} />
      </label> : undefined}>
        <p class="text-sm text-slate-600">{distrito
          ? 'Estudiantes cuya inscripción quedó abierta en años anteriores. Se actualizan solo las escuelas del padrón distrital; los datos más recientes y las escuelas ausentes del archivo se conservan.'
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
            <option value="clave">Ordenar por clave</option><option value="desc">Mayor matrícula sin cierre</option><option value="asc">Menor matrícula sin cierre</option>
          </select>
        </div>
        <div class="mt-4 grid grid-cols-3 gap-3">
          {[['Sin cierre', total, 'text-amber-700'], ['Escuelas con casos', conPendientes, 'text-slate-900'], ['Escuelas', filas.length, 'text-slate-900']].map(([t, v, c]) =>
            <div key={t as string} class="rounded-lg border border-slate-200 bg-white p-3 text-center"><div class={`text-2xl font-bold ${c}`}>{numeroPba(v as number)}</div><div class="text-xs text-slate-500">{t}</div></div>)}
        </div>
        <Card class="mt-4" title={`Escuelas · ${filas.length}`} action={<div class="flex flex-wrap gap-2">
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('xlsx')}>Excel</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportar('pdf')}>PDF</button>
        </div>}>
          {!filas.length ? <EmptyState title="Sin datos" text={q || inspector || grupo ? 'Probá con otros filtros.' : distrito ? 'Importá un CSV de ABC para comenzar.' : 'Todavía no hay datos para tus escuelas asignadas.'} /> : (
            <div class="-m-4 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {['Escuela', 'Fecha ABC', 'Matrícula sin cierre'].map((h) => <th key={h} class="whitespace-nowrap px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => <tr key={r.clave} class="hover:bg-slate-50">
                  <td class="min-w-44 px-3 py-2.5"><span class="font-semibold">{nombre(r.escuela)}</span><span class="block font-mono text-xs text-slate-500">{r.clave} · {r.escuela.cue}</span></td>
                  <td class="whitespace-nowrap px-3 py-2.5">{fechaPba(r.fecha)}</td>
                  <td class="min-w-40 px-3 py-2.5">
                    <span class={`font-semibold ${(r.sin_cierre ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{numeroPba(r.sin_cierre)}</span>
                    <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-amber-400" style={{ width: `${(r.sin_cierre ?? 0) * 100 / maximo}%` }} /></div>
                  </td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Pager page={pagina} total={filas.length} onPage={setPagina} />
      </>}
    </>
  )
}
