import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { descargar, XLSX_MIME } from '../lib/download'
import { buildPdf } from '../lib/export'
import { coincideAgrupamiento, fechaPba, numeroPba } from '../lib/estadisticaPba'
import { avanceBoletin, leerBoletin, totalBoletin, type Boletin } from '../lib/estadisticaBoletin'
import { porcentajeTexto } from '../lib/estadisticaFichas'
import { BRAND } from '../modules'
import { cargar, mensaje, nombre, type Escuela } from './estadisticaDatos'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, PAGE_SIZE, Pager, Spinner, toast } from '../ui/kit'

type Fila = Boletin & { fecha: string; trimestre: string | null; escuela: Escuela }
const colorAvance = (p: number | null) => p === null ? 'text-slate-500' : p >= 90 ? 'text-emerald-700' : p >= 70 ? 'text-amber-700' : 'text-red-700'
const barraAvance = (p: number | null) => p === null ? 'bg-slate-300' : p >= 90 ? 'bg-emerald-500' : p >= 70 ? 'bg-amber-400' : 'bg-red-500'

export function BoletinDigital({ distrito }: { distrito: boolean }) {
  const { data, loading, error, reload } = useAsync(() => cargar<Fila>(distrito, 'estadistica_boletin_digital', 'clave,fecha,trimestre,completo,parcial,sin_carga'), [distrito])
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
    const valor = (r: Fila): number | null => orden === 'avance-asc' || orden === 'avance-desc' ? avanceBoletin(r)
      : orden === 'parcial' ? r.parcial : orden === 'sin-carga' ? r.sin_carga : null
    return (data?.filas ?? []).filter((r) =>
      (!asignadas || asignadas.has(r.clave)) &&
      coincideAgrupamiento(data?.codigosPorClave.get(r.clave), codigos) &&
      [r.clave, r.escuela.cue, r.escuela.codigo, r.escuela.numero, r.escuela.nombre, r.escuela.localidad].join(' ').toLocaleLowerCase('es-AR').includes(buscar))
      .sort((a, b) => {
        if (orden === 'clave') return a.clave.localeCompare(b.clave)
        const x = valor(a), y = valor(b)
        if (x === null) return y === null ? a.clave.localeCompare(b.clave) : 1
        if (y === null) return -1
        return (orden === 'avance-asc' ? x - y : y - x) || a.clave.localeCompare(b.clave)
      })
  }, [data, q, orden, inspector, distrito, grupo])

  const importar = async (archivo: File) => {
    setImportando(true)
    setResultado('')
    try {
      if (!data) throw new Error('Esperá a que termine la carga de escuelas.')
      if (!archivo.name.toLowerCase().endsWith('.csv')) throw new Error('Seleccioná un archivo CSV descargado de ABC.')
      const doc = await leerBoletin(await archivo.text())
      const escuelas = doc.filas.filter((f) => data.claves.has(f.clave))
      if (!escuelas.length) throw new Error('El archivo no contiene escuelas del padrón distrital.')
      const r = await supabase.rpc('estadistica_boletin_importar', { p_fecha: doc.fecha, p_trimestre: doc.trimestre, p_filas: escuelas })
      if (r.error) throw r.error
      const total = r.data as { guardadas: number; anteriores: number }
      setResultado(`Fecha del archivo: ${fechaPba(doc.fecha)}${doc.trimestre ? ` (${doc.trimestre})` : ''}. ${total.guardadas} escuelas guardadas; ${total.anteriores} conservaron datos más recientes. ${doc.filas.length - escuelas.length} filas fuera del padrón distrital no se importaron.`)
      toast.ok('Importación finalizada')
      setPagina(1)
      reload()
    } catch (e) { toast.error(mensaje(e)) }
    finally { setImportando(false) }
  }

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    try {
      const headers = ['Clave', 'CUE', 'Escuela', 'Fecha', 'Trimestre', 'Completo', 'Parcial', 'Sin carga', 'Total', '% completo']
      if (tipo === 'xlsx') {
        const XLSX = await import('xlsx')
        const hoja = XLSX.utils.aoa_to_sheet([headers, ...filas.map((r) => [r.clave, r.escuela.cue, nombre(r.escuela), fechaPba(r.fecha), r.trimestre ?? '', r.completo, r.parcial, r.sin_carga, totalBoletin(r), avanceBoletin(r)])])
        hoja['!cols'] = [14, 14, 28, 13, 14, 11, 11, 11, 11, 12].map((wch) => ({ wch }))
        const libro = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(libro, hoja, 'Boletín Digital')
        descargar(new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' })), 'boletin-digital.xlsx', XLSX_MIME)
      } else {
        const respuesta = await fetch(`${import.meta.env.BASE_URL}icon-192.png`)
        if (!respuesta.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        const seleccionado = distrito && inspector ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
        const agrupamiento = data?.grupos.find((g) => String(g.id) === grupo)
        const pdf = await buildPdf({
          title: 'Carga de Boletín Digital',
          subtitle: `${filas.length} escuelas · ${[seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`].filter(Boolean).join(' · ') || 'datos filtrados'}`,
          headers: ['Clave', 'Escuela', 'Fecha', 'Trimestre', 'Completo', 'Parcial', 'Sin carga', '% completo'], widths: [13, 28, 11, 12, 10, 10, 10, 11],
          rows: filas.map((r) => [r.clave, nombre(r.escuela), fechaPba(r.fecha), r.trimestre ?? '', numeroPba(r.completo), numeroPba(r.parcial), numeroPba(r.sin_carga), porcentajeTexto(avanceBoletin(r))]),
        }, { brand: { name: BRAND.name, logo: new Uint8Array(await respuesta.arrayBuffer()) } })
        descargar(pdf, 'boletin-digital.pdf', 'application/pdf')
      }
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  const suma = (k: 'completo' | 'parcial' | 'sin_carga') => filas.reduce((s, r) => s + (r[k] ?? 0), 0)
  const completo = suma('completo'), parcial = suma('parcial'), sinCarga = suma('sin_carga')
  const total = completo + parcial + sinCarga
  const avanceTotal = total ? completo * 100 / total : null

  return (
    <>
      <Card title="Carga de Boletín Digital" action={distrito ? <label class={`${BTN_PRIMARY} cursor-pointer focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2 ${importando || !data ? 'pointer-events-none opacity-50' : ''}`}>
        {importando ? 'Importando…' : 'Importar CSV de ABC'}
        <input type="file" accept=".csv,text/csv" class="sr-only" disabled={importando || !data} onChange={(e) => {
          const archivo = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (archivo) void importar(archivo)
        }} />
      </label> : undefined}>
        <p class="text-sm text-slate-600">{distrito
          ? 'Estado de carga del Boletín Digital por escuela: completo, parcial y sin carga. Se actualizan solo las escuelas del padrón distrital; los datos más recientes y las escuelas ausentes del archivo se conservan.'
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
            <option value="clave">Ordenar por clave</option><option value="avance-asc">Menor % completo</option><option value="avance-desc">Mayor % completo</option>
            <option value="parcial">Más boletines parciales</option><option value="sin-carga">Más boletines sin carga</option>
          </select>
        </div>
        <Card class="mt-4" title="Resumen según filtros">
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Completo', completo, 'text-emerald-700'], ['Parcial', parcial, 'text-amber-700'], ['Sin carga', sinCarga, 'text-red-700'], ['% completo', porcentajeTexto(avanceTotal), colorAvance(avanceTotal)]].map(([t, v, c]) =>
              <div key={t as string} class="rounded-lg border border-slate-200 bg-white p-3 text-center"><div class={`text-2xl font-bold ${c}`}>{typeof v === 'number' ? numeroPba(v) : v}</div><div class="text-xs text-slate-500">{t}</div></div>)}
          </div>
          <div class="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Completo ${completo}, parcial ${parcial}, sin carga ${sinCarga}`}>
            {total > 0 && <><div class="bg-emerald-500" style={{ width: `${completo * 100 / total}%` }} /><div class="bg-amber-400" style={{ width: `${parcial * 100 / total}%` }} /><div class="bg-red-500" style={{ width: `${sinCarga * 100 / total}%` }} /></>}
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
                  {['Escuela', 'Fecha ABC', 'Completo', 'Parcial', 'Sin carga', '% completo'].map((h) => <th key={h} class="whitespace-nowrap px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => {
                  const p = avanceBoletin(r)
                  return <tr key={r.clave} class="hover:bg-slate-50">
                    <td class="min-w-44 px-3 py-2.5"><span class="font-semibold">{nombre(r.escuela)}</span><span class="block font-mono text-xs text-slate-500">{r.clave} · {r.escuela.cue}</span></td>
                    <td class="whitespace-nowrap px-3 py-2.5">{fechaPba(r.fecha)}{r.trimestre && <span class="block text-xs text-slate-500">{r.trimestre}</span>}</td>
                    <td class="px-3 py-2.5 font-medium text-emerald-700">{numeroPba(r.completo)}</td>
                    <td class="px-3 py-2.5 font-medium text-amber-700">{numeroPba(r.parcial)}</td>
                    <td class="px-3 py-2.5 font-medium text-red-700">{numeroPba(r.sin_carga)}</td>
                    <td class="min-w-32 px-3 py-2.5"><span class={`font-semibold ${colorAvance(p)}`}>{porcentajeTexto(p)}</span>
                      <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div class={`h-full rounded-full ${barraAvance(p)}`} style={{ width: `${p ?? 0}%` }} /></div></td>
                  </tr>
                })}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Pager page={pagina} total={filas.length} onPage={setPagina} />
        <p class="mt-3 text-xs text-slate-500">El % completo es la proporción de boletines completos sobre el total (completo + parcial + sin carga). Verde desde 90 %, ámbar desde 70 %, rojo por debajo.</p>
      </>}
    </>
  )
}
