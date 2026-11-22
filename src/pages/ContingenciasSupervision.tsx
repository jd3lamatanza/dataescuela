import { useState } from 'preact/hooks'
import { useAuth } from '../lib/auth'
import { consultarContingencias, fechaCorta, leerContingencias, SUSPENSIONES, tablaContingencias, TIPOS, type ContingenciaSupervision, type FiltrosContingencias } from '../lib/contingencias'
import { descargar, XLSX_MIME } from '../lib/download'
import { buildListadoXlsx } from '../lib/escuelasListado'
import { buildPdf } from '../lib/export'
import { useAsync, useDebounced } from '../lib/hooks'
import { setParams, useRoute } from '../lib/router'
import { supabase } from '../lib/supabase'
import { BRAND } from '../modules'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Pager, Spinner, toast } from '../ui/kit'

const TAMANO = 20
const VACIOS: FiltrosContingencias = { busqueda: '', tipo: '', suspension: '', desde: '', hasta: '' }

export function ContingenciasSupervision() {
  const { user } = useAuth()
  const { params } = useRoute()
  const valorId = params.get('contingencia')
  const id = valorId && /^[1-9]\d*$/.test(valorId) && Number.isSafeInteger(Number(valorId)) ? Number(valorId) : null
  const [filtros, setFiltros] = useState<FiltrosContingencias>(VACIOS)
  const [pagina, setPagina] = useState(1)
  const [exportando, setExportando] = useState(false)
  const busqueda = useDebounced(filtros.busqueda)
  const actuales = { ...filtros, busqueda }
  const { data, error, loading, reload } = useAsync(async () => ({
    ...await consultarContingencias(supabase, actuales, TAMANO, (pagina - 1) * TAMANO),
    pagina, clave: JSON.stringify(actuales),
  }), [busqueda, filtros.tipo, filtros.suspension, filtros.desde, filtros.hasta, pagina])
  const detalle = useAsync(async () => ({ id, fila: id ? (await consultarContingencias(supabase, { ...VACIOS, id }, 1, 0)).filas[0] ?? null : null }), [id])
  const listo = !loading && !error && busqueda === filtros.busqueda && data?.pagina === pagina && data.clave === JSON.stringify(actuales)
  const cambiar = (k: keyof FiltrosContingencias, valor: string) => { setFiltros({ ...filtros, [k]: valor }); setPagina(1) }

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    setExportando(true)
    try {
      const filas = await leerContingencias(supabase, actuales)
      if (!filas.length) { toast.info('No hay contingencias para exportar con estos filtros.'); return }
      const tabla = tablaContingencias(filas, actuales, BRAND.org)
      if (tipo === 'xlsx') descargar(await buildListadoXlsx(tabla, BRAND.name, 'Contingencias'), 'contingencias.xlsx', XLSX_MIME)
      else {
        const logo = await fetch(`${import.meta.env.BASE_URL}icon-192.png`)
        if (!logo.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        descargar(await buildPdf(tabla, { brand: { name: BRAND.name, logo: new Uint8Array(await logo.arrayBuffer()) }, maxCellLines: 30 }), 'contingencias.pdf', 'application/pdf')
      }
    } catch (e) { toast.error(`No se pudo exportar: ${e instanceof Error ? e.message : String(e)}`) } finally { setExportando(false) }
  }

  return <>
    <PageHeader title="Contingencias" subtitle={user?.role === 'areal' ? 'Contingencias de las escuelas que tenés asignadas.' : 'Contingencias registradas por las escuelas.'} />
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Lbl label="Buscar escuela, clave, CUE o detalle"><input type="search" class={FIELD} value={filtros.busqueda} onInput={(e) => cambiar('busqueda', e.currentTarget.value)} /></Lbl>
      <Lbl label="Tipo de contingencia"><select class={FIELD} value={filtros.tipo} onChange={(e) => cambiar('tipo', e.currentTarget.value)}><option value="">Todos los tipos</option>{TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}</select></Lbl>
      <Lbl label="Suspensión"><select class={FIELD} value={filtros.suspension} onChange={(e) => cambiar('suspension', e.currentTarget.value)}><option value="">Todas</option>{Object.entries(SUSPENSIONES).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></Lbl>
      <Lbl label="Desde"><input type="date" class={FIELD} value={filtros.desde} onInput={(e) => cambiar('desde', e.currentTarget.value)} /></Lbl>
      <Lbl label="Hasta"><input type="date" class={FIELD} value={filtros.hasta} onInput={(e) => cambiar('hasta', e.currentTarget.value)} /></Lbl>
    </div>
    {user?.role === 'distrital' && <div class="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" class={BTN_SECONDARY} disabled={!listo || exportando || !data?.total} onClick={() => void exportar('xlsx')}>Excel</button>
      <button type="button" class={BTN_SECONDARY} disabled={!listo || exportando || !data?.total} onClick={() => void exportar('pdf')}>PDF</button>
      <span class="text-xs text-slate-500">{exportando ? 'Preparando exportación…' : 'Se exportan todos los resultados filtrados.'}</span>
    </div>}
    {error && <div class="mt-3 space-y-2"><Alert tone="error">{error}</Alert><button type="button" class={BTN_SECONDARY} onClick={reload}>Reintentar</button></div>}
    <div class="mt-4 space-y-2">
      {!listo ? !error && <Spinner /> : !data?.filas.length ? <Card><EmptyState title="Sin contingencias" text="No hay registros con estos filtros." /></Card> : data.filas.map((c) =>
        <button key={c.id} type="button" class="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-sky-300 hover:bg-sky-50" onClick={() => setParams({ contingencia: c.id })}>
          <span class="block font-semibold text-slate-900">{c.tipos.join(' · ')}</span>
          <span class="mt-1 block text-sm text-slate-600">{fechaCorta(c.fecha)}{c.fecha_estimada ? ' (fecha de carga)' : ''} · {c.clave || c.cue} {c.escuela}</span>
          <span class="mt-1 block text-sm text-slate-600">{SUSPENSIONES[c.suspension]} · {c.turnos.join(', ')}</span>
        </button>)}
    </div>
    {listo && data && <><p class="mt-3 text-sm text-slate-500">{data.total} contingencia(s)</p><Pager page={pagina} total={data.total} size={TAMANO} onPage={setPagina} /></>}
    {valorId && <Modal title="Detalle de contingencia" onClose={() => setParams({ contingencia: null })}>
      {id === null ? <Alert tone="error">Identificador de contingencia inválido.</Alert> : detalle.loading ? <Spinner /> : detalle.error ? <Alert tone="error">{detalle.error}</Alert> :
        detalle.data?.id !== id ? <Spinner /> : detalle.data.fila ? <Detalle contingencia={detalle.data.fila} /> : <Alert tone="warning">La contingencia no existe o no está entre tus escuelas asignadas.</Alert>}
      <div class="mt-4 flex justify-end"><button type="button" class={BTN_PRIMARY} onClick={() => setParams({ contingencia: null })}>Cerrar</button></div>
    </Modal>}
  </>
}

function Detalle({ contingencia: c }: { contingencia: ContingenciaSupervision }) {
  return <dl class="space-y-3 text-sm">
    <div><dt class="text-xs uppercase text-slate-500">Escuela</dt><dd>{c.clave} {c.escuela} · CUE {c.cue}</dd></div>
    <div><dt class="text-xs uppercase text-slate-500">Fecha de contingencia</dt><dd>{fechaCorta(c.fecha)}{c.fecha_estimada ? ' (fecha de carga; pendiente de revisión)' : ''}</dd></div>
    <div><dt class="text-xs uppercase text-slate-500">Tipos</dt><dd>{c.tipos.join(', ')}</dd></div>
    <div><dt class="text-xs uppercase text-slate-500">Suspensión</dt><dd>{SUSPENSIONES[c.suspension]}</dd></div>
    <div><dt class="text-xs uppercase text-slate-500">Turnos afectados</dt><dd>{c.turnos.join(', ')}</dd></div>
    <div><dt class="text-xs uppercase text-slate-500">Observaciones</dt><dd class="whitespace-pre-wrap break-words">{c.observaciones || 'Sin observaciones'}</dd></div>
  </dl>
}
