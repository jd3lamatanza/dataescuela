import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { descargar, XLSX_MIME } from '../lib/download'
import { coincideAgrupamiento, fechaPba, numeroPba } from '../lib/estadisticaPba'
import { leerSalidasSinIngreso, nivelDesdeNombre, NIVELES_SALIDAS } from '../lib/estadisticaSalidas'
import { BRAND } from '../modules'
import { buildInforme, cargar, mensaje, nombre, PPTX_MIME, type Escuela, type FormatoEstadistica } from './estadisticaDatos'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, confirmar, EmptyState, FIELD, Modal, PAGE_SIZE, Pager, Spinner, toast } from '../ui/kit'

interface Registro {
  id: number; nivel: string; fecha: string; clave: string
  nombre: string | null; apellido: string | null; dni: string | null; turno: string | null; anio: string | null; seccion: string | null; estado: string | null
}
interface Resumen { clave: string; escuela: Escuela; nivel: string; fecha: string; total: number; pendientes: number; rechazados: number; estudiantes: Registro[] }
const CAMPOS = 'id,nivel,fecha,clave,nombre,apellido,dni,turno,anio,seccion,estado'
const etiquetaNivel = (n: string) => NIVELES_SALIDAS.find((x) => x.id === n)?.label ?? n
const esPendiente = (e: string | null) => /pendiente/i.test(e ?? '')
const esRechazado = (e: string | null) => /rechazad/i.test(e ?? '')
const HEAD_NOMINA = ['Apellido', 'Nombre', 'DNI', 'Turno', 'Año', 'Sección', 'Estado de pase']
const filaNomina = (r: Registro) => [r.apellido ?? '', r.nombre ?? '', r.dni ?? '', r.turno ?? '', r.anio ?? '', r.seccion ?? '', r.estado ?? '']

async function descargarTabla(tipo: FormatoEstadistica, archivo: string, titulo: string, subtitulo: string, headers: string[], widths: number[], filas: (string | number)[][]) {
  if (tipo === 'xlsx') {
    const XLSX = await import('xlsx')
    const hoja = XLSX.utils.aoa_to_sheet([headers, ...filas])
    hoja['!cols'] = widths.map((w) => ({ wch: Math.max(10, w) }))
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, titulo.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))
    descargar(new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' })), `${archivo}.xlsx`, XLSX_MIME)
    return
  }
  const respuesta = tipo === 'pdf' ? await fetch(`${import.meta.env.BASE_URL}icon-192.png`) : null
  if (respuesta && !respuesta.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
  const pdf = await buildInforme(tipo, { title: titulo, subtitle: subtitulo, headers, widths, rows: filas.map((f) => f.map(String)) },
    { brand: respuesta ? { name: BRAND.name, logo: new Uint8Array(await respuesta.arrayBuffer()) } : undefined })
  descargar(pdf, `${archivo}.${tipo}`, tipo === 'pdf' ? 'application/pdf' : PPTX_MIME)
}

export function SalidasSinIngreso({ distrito }: { distrito: boolean }) {
  const { data, loading, error, reload } = useAsync(() => cargar<Registro>(distrito, 'estadistica_salidas_sin_ingreso', CAMPOS, 'id'), [distrito])
  const [q, setQ] = useState('')
  const [inspector, setInspector] = useState('')
  const [grupo, setGrupo] = useState('')
  const [nivel, setNivel] = useState('')
  const [orden, setOrden] = useState('clave')
  const [pagina, setPagina] = useState(1)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState('')
  const [abierta, setAbierta] = useState<Resumen | null>(null)

  const resumenes = useMemo(() => {
    const mapa = new Map<string, Resumen>()
    for (const r of data?.filas ?? []) {
      let x = mapa.get(r.clave)
      if (!x) mapa.set(r.clave, x = { clave: r.clave, escuela: r.escuela, nivel: r.nivel, fecha: r.fecha, total: 0, pendientes: 0, rechazados: 0, estudiantes: [] })
      x.total++
      if (esPendiente(r.estado)) x.pendientes++
      if (esRechazado(r.estado)) x.rechazados++
      x.estudiantes.push(r)
    }
    return [...mapa.values()]
  }, [data])

  const filas = useMemo(() => {
    const buscar = q.trim().toLocaleLowerCase('es-AR')
    const seleccion = inspector && distrito ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
    const asignadas = inspector && distrito ? new Set(seleccion?.escuelas_asignadas ?? []) : null
    const codigos = grupo ? new Set(data?.codigosGrupo.filter((c) => String(c.agrupamiento_id) === grupo).map((c) => c.codigo) ?? []) : null
    return resumenes.filter((r) =>
      (!nivel || r.nivel === nivel) &&
      (!asignadas || asignadas.has(r.clave)) &&
      coincideAgrupamiento(data?.codigosPorClave.get(r.clave), codigos) &&
      [r.clave, r.escuela.cue, r.escuela.codigo, r.escuela.numero, r.escuela.nombre, r.escuela.localidad].join(' ').toLocaleLowerCase('es-AR').includes(buscar))
      .sort((a, b) => orden === 'total' ? b.total - a.total || a.clave.localeCompare(b.clave)
        : orden === 'pendientes' ? b.pendientes - a.pendientes || a.clave.localeCompare(b.clave)
          : orden === 'rechazados' ? b.rechazados - a.rechazados || a.clave.localeCompare(b.clave)
            : a.clave.localeCompare(b.clave))
  }, [resumenes, data, q, nivel, orden, inspector, distrito, grupo])

  const importar = async (archivo: File) => {
    setImportando(true)
    setResultado('')
    try {
      if (!data) throw new Error('Esperá a que termine la carga de escuelas.')
      if (!archivo.name.toLowerCase().endsWith('.csv')) throw new Error('Seleccioná un archivo CSV descargado de ABC.')
      const doc = await leerSalidasSinIngreso(await archivo.text())
      const delNombre = nivelDesdeNombre(archivo.name)
      if (!delNombre) throw new Error('El nombre del archivo debe indicar un único nivel: Inicial, Primario o Secundario.')
      if (doc.nivelTitulo && doc.nivelTitulo !== delNombre) throw new Error(`El nombre del archivo indica ${etiquetaNivel(delNombre)} pero el contenido es ${etiquetaNivel(doc.nivelTitulo)}.`)
      const estudiantes = doc.filas.filter((f) => data.claves.has(f.clave))
      const previos = data.filas.filter((f) => f.nivel === delNombre).length
      if (!await confirmar(`Reemplazar el nivel ${etiquetaNivel(delNombre)}`, {
        text: `Se eliminarán los ${numeroPba(previos)} registros actuales del nivel y se cargarán ${numeroPba(estudiantes.length)} estudiantes del archivo (${fechaPba(doc.fecha)}).`, ok: 'Reemplazar', danger: true,
      })) return
      const r = await supabase.rpc('estadistica_salidas_importar', { p_nivel: delNombre, p_fecha: doc.fecha, p_filas: estudiantes })
      if (r.error) throw r.error
      const total = r.data as { guardados: number; eliminados: number }
      setResultado(`Nivel ${etiquetaNivel(delNombre)} al ${fechaPba(doc.fecha)}: ${total.eliminados} registros anteriores eliminados y ${total.guardados} cargados. ${doc.filas.length - estudiantes.length} filas fuera del padrón distrital no se importaron.`)
      toast.ok('Importación finalizada')
      setPagina(1)
      reload()
    } catch (e) { toast.error(mensaje(e)) }
    finally { setImportando(false) }
  }

  const exportarLista = async (tipo: FormatoEstadistica) => {
    try {
      const seleccionado = distrito && inspector ? data?.inspectores.find((i) => String(i.id) === inspector) : undefined
      const agrupamiento = data?.grupos.find((g) => String(g.id) === grupo)
      const filtros = [nivel && `Nivel: ${etiquetaNivel(nivel)}`, seleccionado && `Inspector: ${seleccionado.nombre || seleccionado.cuil}`, agrupamiento && `Agrupamiento: ${agrupamiento.nombre}`].filter(Boolean).join(' · ')
      await descargarTabla(tipo, 'salidas-sin-ingreso', 'Salidas sin ingreso', `${filas.length} escuelas · ${filtros || 'datos filtrados'}`,
        ['Clave', 'Escuela', 'Nivel', 'Fecha', 'Estudiantes', 'Pendientes', 'Rechazados'], [13, 24, 11, 11, 11, 11, 11],
        filas.map((r) => [r.clave, nombre(r.escuela), etiquetaNivel(r.nivel), fechaPba(r.fecha), r.total, r.pendientes, r.rechazados]))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  const exportarNominaCompleta = async (tipo: FormatoEstadistica) => {
    try {
      await descargarTabla(tipo, 'salidas-sin-ingreso-nomina', 'Nómina de salidas sin ingreso', `${filas.reduce((s, r) => s + r.total, 0)} estudiantes de ${filas.length} escuelas`,
        ['Clave', 'Escuela', ...HEAD_NOMINA], [12, 18, 14, 14, 11, 9, 8, 8, 12],
        filas.flatMap((r) => r.estudiantes.map((e) => [r.clave, nombre(r.escuela), ...filaNomina(e)])))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }

  return (
    <>
      <Card title="Salidas sin ingreso" action={distrito ? <label class={`${BTN_PRIMARY} cursor-pointer focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2 ${importando || !data ? 'pointer-events-none opacity-50' : ''}`}>
        {importando ? 'Importando…' : 'Importar CSV de ABC'}
        <input type="file" accept=".csv,text/csv" class="sr-only" disabled={importando || !data} onChange={(e) => {
          const archivo = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          if (archivo) void importar(archivo)
        }} />
      </label> : undefined}>
        <p class="text-sm text-slate-600">{distrito
          ? 'Estudiantes que salieron de una escuela y no registran ingreso a otra. Cada importación reemplaza por completo el nivel indicado en el nombre del archivo (Inicial, Primario o Secundario).'
          : 'Vista de solo lectura de tus escuelas asignadas. El distrito actualiza los datos mediante la importación de ABC.'}</p>
        {resultado && <div class="mt-3"><Alert tone="success">{resultado}</Alert></div>}
      </Card>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      {loading && !data ? <Spinner /> : data && <>
        <div class={`mt-4 grid gap-2 sm:grid-cols-2 ${distrito ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
          <input class={FIELD} type="search" aria-label="Buscar escuela" placeholder="Buscar por escuela, clave, CUE o localidad" value={q} onInput={(e) => { setQ(e.currentTarget.value); setPagina(1) }} />
          <select class={FIELD} aria-label="Filtrar por nivel" value={nivel} onChange={(e) => { setNivel(e.currentTarget.value); setPagina(1) }}>
            <option value="">Todos los niveles</option>
            {NIVELES_SALIDAS.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
          {distrito && <select class={FIELD} aria-label="Filtrar por inspector" value={inspector} onChange={(e) => { setInspector(e.currentTarget.value); setPagina(1) }}>
            <option value="">Todos los inspectores</option>
            {data.inspectores.map((i) => <option key={i.id} value={i.id}>{i.nombre || i.cuil}</option>)}
          </select>}
          <select class={FIELD} aria-label="Filtrar por agrupamiento de matrícula" value={grupo} onChange={(e) => { setGrupo(e.currentTarget.value); setPagina(1) }}>
            <option value="">Todos los agrupamientos</option>
            {data.grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
          </select>
          <select class={FIELD} aria-label="Ordenar escuelas" value={orden} onChange={(e) => { setOrden(e.currentTarget.value); setPagina(1) }}>
            <option value="clave">Ordenar por clave</option><option value="total">Más estudiantes</option>
            <option value="pendientes">Más pases pendientes</option><option value="rechazados">Más pases rechazados</option>
          </select>
        </div>
        <div class="mt-4 grid grid-cols-3 gap-3">
          {[['Estudiantes', filas.reduce((s, r) => s + r.total, 0), 'text-slate-900'], ['Pendientes', filas.reduce((s, r) => s + r.pendientes, 0), 'text-amber-700'], ['Rechazados', filas.reduce((s, r) => s + r.rechazados, 0), 'text-red-700']].map(([t, v, c]) =>
            <div key={t as string} class="rounded-lg border border-slate-200 bg-white p-3 text-center"><div class={`text-2xl font-bold ${c}`}>{numeroPba(v as number)}</div><div class="text-xs text-slate-500">{t}</div></div>)}
        </div>
        <Card class="mt-4" title={`Escuelas · ${filas.length}`} action={<div class="flex flex-wrap gap-2">
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportarLista('xlsx')}>Lista Excel</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportarLista('pdf')}>Lista PDF</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportarLista('pptx')}>Lista PPTX</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportarNominaCompleta('xlsx')}>Nómina Excel</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportarNominaCompleta('pdf')}>Nómina PDF</button>
          <button class={BTN_SECONDARY} disabled={!filas.length} onClick={() => void exportarNominaCompleta('pptx')}>Nómina PPTX</button>
        </div>}>
          {!filas.length ? <EmptyState title="Sin datos" text={q || inspector || grupo || nivel ? 'Probá con otros filtros.' : distrito ? 'Importá un CSV de ABC para comenzar.' : 'Todavía no hay datos para tus escuelas asignadas.'} /> : (
            <div class="-m-4 overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  {['Escuela', 'Nivel', 'Fecha ABC', 'Estudiantes', 'Pendientes', 'Rechazados', ''].map((h) => <th key={h} class="whitespace-nowrap px-3 py-2">{h}</th>)}
                </tr></thead>
                <tbody class="divide-y divide-slate-100">{filas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => <tr key={r.clave} class="hover:bg-slate-50">
                  <td class="min-w-44 px-3 py-2.5"><span class="font-semibold">{nombre(r.escuela)}</span><span class="block font-mono text-xs text-slate-500">{r.clave} · {r.escuela.cue}</span></td>
                  <td class="px-3 py-2.5">{etiquetaNivel(r.nivel)}</td>
                  <td class="whitespace-nowrap px-3 py-2.5">{fechaPba(r.fecha)}</td>
                  <td class="px-3 py-2.5 font-semibold">{numeroPba(r.total)}</td>
                  <td class="px-3 py-2.5 font-medium text-amber-700">{numeroPba(r.pendientes)}</td>
                  <td class="px-3 py-2.5 font-medium text-red-700">{numeroPba(r.rechazados)}</td>
                  <td class="px-3 py-2.5"><button class={BTN_SECONDARY} onClick={() => setAbierta(r)}>Ver nómina</button></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
        <Pager page={pagina} total={filas.length} onPage={setPagina} />
      </>}
      {abierta && <Nomina resumen={abierta} onClose={() => setAbierta(null)} />}
    </>
  )
}

function Nomina({ resumen, onClose }: { resumen: Resumen; onClose(): void }) {
  const [pagina, setPagina] = useState(1)
  const lista = useMemo(() => [...resumen.estudiantes].sort((a, b) => (a.apellido ?? '').localeCompare(b.apellido ?? '', 'es') || (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es')), [resumen])
  const exportar = async (tipo: FormatoEstadistica) => {
    try {
      await descargarTabla(tipo, `nomina-${resumen.clave}`, `Nómina ${resumen.clave}`, `${nombre(resumen.escuela)} · ${etiquetaNivel(resumen.nivel)} · ${fechaPba(resumen.fecha)} · ${lista.length} estudiantes`,
        HEAD_NOMINA, [16, 16, 12, 9, 8, 8, 14], lista.map(filaNomina))
    } catch (e) { toast.error(`No se pudo descargar: ${mensaje(e)}`) }
  }
  return <Modal title={`Nómina · ${nombre(resumen.escuela)}`} onClose={onClose} wide>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-slate-600">{lista.length} estudiantes · {resumen.pendientes} pendientes · {resumen.rechazados} rechazados</p>
      <div class="flex flex-wrap gap-2"><button class={BTN_SECONDARY} onClick={() => void exportar('xlsx')}>Excel</button><button class={BTN_SECONDARY} onClick={() => void exportar('pdf')}>PDF</button><button class={BTN_SECONDARY} onClick={() => void exportar('pptx')}>PPTX</button></div>
    </div>
    <div class="overflow-x-auto rounded-md border border-slate-200">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>{HEAD_NOMINA.map((h) => <th key={h} class="whitespace-nowrap px-3 py-2">{h}</th>)}</tr></thead>
        <tbody class="divide-y divide-slate-100">{lista.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE).map((r) => <tr key={r.id}>
          <td class="px-3 py-2 font-medium">{r.apellido}</td><td class="px-3 py-2">{r.nombre}</td><td class="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.dni}</td>
          <td class="px-3 py-2">{r.turno}</td><td class="whitespace-nowrap px-3 py-2">{r.anio}</td><td class="px-3 py-2">{r.seccion}</td>
          <td class={`whitespace-nowrap px-3 py-2 font-medium ${esRechazado(r.estado) ? 'text-red-700' : 'text-amber-700'}`}>{r.estado}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <Pager page={pagina} total={lista.length} onPage={setPagina} />
  </Modal>
}
