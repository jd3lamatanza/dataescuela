import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync, useDebounced } from '../lib/hooks'
import { setParams, useRoute } from '../lib/router'
import { consultaInscripcionesEav, fechaEav, fechaHoraEav, leerEscuelasEav, leerInscripcionesEav, limpiarBusquedaInscripcionesEav, nombreEscuelaEav, tablaInscripcionesEav, type InscripcionEav } from '../lib/eavInscripcionesListado'
import { buildListadoXlsx } from '../lib/escuelasListado'
import { buildPdf } from '../lib/export'
import { descargar, XLSX_MIME } from '../lib/download'
import { BRAND } from '../modules'
import { Alert, Badge, BTN_SECONDARY, Card, EmptyState, FIELD, Modal, PAGE_SIZE, Pager, Spinner, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'

export function InscripcionesEavDistrital() {
  const { params } = useRoute()
  const escuela = params.get('escuela') ?? ''
  const [buscar, setBuscar] = useState('')
  const [pagina, setPagina] = useState(1)
  const [abierta, setAbierta] = useState<InscripcionEav | null>(null)
  const [exportando, setExportando] = useState(false)
  const busqueda = limpiarBusquedaInscripcionesEav(buscar)
  const consulta = useDebounced(busqueda)
  const filtros = { escuela, busqueda: consulta }
  const escuelas = useAsync(() => leerEscuelasEav(supabase))
  const { data, loading, error } = useAsync(async () => {
    const r = await consultaInscripcionesEav(supabase, filtros).range((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE - 1).overrideTypes<InscripcionEav[], { merge: false }>()
    if (r.error) throw r.error
    if (r.count == null) throw new Error('No se pudo obtener la cantidad de preinscripciones')
    return { filas: r.data, total: r.count, escuela, consulta, pagina }
  }, [escuela, consulta, pagina])
  const listo = !loading && !error && consulta === busqueda && data?.escuela === escuela && data.consulta === consulta && data.pagina === pagina

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    setExportando(true)
    try {
      const filas = await leerInscripcionesEav(supabase, filtros)
      if (!filas.length) { toast.info('No hay preinscripciones para exportar con estos filtros.'); return }
      const tabla = tablaInscripcionesEav(filas, filtros, escuelas.data?.find((e) => String(e.id) === escuela), BRAND.org)
      if (tipo === 'xlsx') descargar(await buildListadoXlsx(tabla, BRAND.name, 'Inscripciones'), 'inscripciones-eav.xlsx', XLSX_MIME)
      else {
        const respuesta = await fetch(`${import.meta.env.BASE_URL}icon-192.png?v=2`)
        if (!respuesta.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        descargar(await buildPdf(tabla, { brand: { name: BRAND.name, logo: new Uint8Array(await respuesta.arrayBuffer()) }, maxCellLines: 30 }), 'inscripciones-eav.pdf', 'application/pdf')
      }
    } catch (e) {
      const mensaje = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)
      toast.error(`No se pudo exportar el listado: ${mensaje}`)
    } finally { setExportando(false) }
  }

  return <>
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-slate-900">Preinscripciones e inscripciones</h2>
      <p class="mt-1 text-sm text-slate-500">Consultá las inscripciones de las escuelas de verano y abrí cada registro para ver sus datos.</p>
    </div>
    <div class="grid gap-2 sm:grid-cols-2">
      <input type="search" class={FIELD} value={buscar} maxLength={80} aria-label="Buscar preinscripción"
        placeholder="Buscar por nombre o DNI" onInput={(e) => { setBuscar(e.currentTarget.value); setPagina(1) }} />
      <select class={FIELD} value={escuela} aria-label="Filtrar por escuela" disabled={escuelas.loading || !!escuelas.error}
        onChange={(e) => { setPagina(1); setParams({ escuela: e.currentTarget.value || null }) }}>
        <option value="">Todas las escuelas</option>
        {(escuelas.data ?? []).map((e) => <option key={e.id} value={e.id}>{nombreEscuelaEav(e)}</option>)}
      </select>
    </div>
    {escuelas.error && <div class="mt-3"><Alert tone="error">No se pudo cargar el filtro de escuelas: {escuelas.error}</Alert></div>}
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" class={BTN_SECONDARY} disabled={!listo || escuelas.loading || !!escuelas.error || exportando || !data?.total}
        onClick={() => void exportar('xlsx')} aria-label="Exportar inscripciones a Excel"><Icon name="download" />Excel</button>
      <button type="button" class={BTN_SECONDARY} disabled={!listo || escuelas.loading || !!escuelas.error || exportando || !data?.total}
        onClick={() => void exportar('pdf')} aria-label="Exportar inscripciones a PDF"><Icon name="download" />PDF</button>
      <span class="text-xs text-slate-500">{exportando ? 'Preparando exportación…' : 'Se exportan todos los resultados filtrados, no solo esta página.'}</span>
    </div>
    {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
    <div class="mt-3 space-y-2">
      {!listo ? !error && <Spinner /> : !data?.filas.length ? <Card><EmptyState title="Sin preinscripciones" text="No hay estudiantes con esos criterios." /></Card> : data.filas.map((p) => (
        <button type="button" key={p.id} onClick={() => setAbierta(p)} class="flex w-full flex-wrap items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-sky-300 hover:bg-sky-50">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Icon name="clipboard" /></span>
          <span class="min-w-0 flex-1 basis-48">
            <span class="block break-words font-semibold text-slate-900">{p.nombre}</span>
            <span class="block text-sm text-slate-600">DNI {p.dni} · Nacimiento {fechaEav(p.nacimiento)} · Temporada {p.temporada}</span>
            <span class="mt-1 block break-words text-xs text-slate-500">{nombreEscuelaEav(p.escuela_eav)}</span>
            <span class="mt-1 block break-words text-xs text-slate-500">Responsable: {p.responsable} · {p.telefono}</span>
            {p.inscrito_en && <span class={`mt-1 block text-xs font-medium ${p.legajo_completo ? 'text-emerald-700' : 'text-amber-700'}`}>Legajo {p.legajo_completo ? 'completo' : 'incompleto'}</span>}
          </span>
          <Badge tone={p.inscrito_en ? 'green' : 'amber'}>{p.inscrito_en ? 'Inscripto' : 'Preinscripto'}</Badge>
        </button>
      ))}
    </div>
    {listo && data && <><p class="mt-3 text-sm text-slate-500">{data.total} estudiante(s)</p><Pager page={pagina} total={data.total} onPage={setPagina} /></>}
    {abierta && <DetalleInscripcion p={abierta} onClose={() => setAbierta(null)} />}
  </>
}

function DetalleInscripcion({ p, onClose }: { p: InscripcionEav; onClose(): void }) {
  const dato = (titulo: string, valor: string) => <div><dt class="text-xs uppercase text-slate-500">{titulo}</dt><dd class="mt-1 break-words text-sm text-slate-900">{valor}</dd></div>
  return <Modal title="Detalle de inscripción" onClose={onClose} wide>
    <div class="space-y-5">
      <div class="flex flex-wrap items-center gap-2"><h3 class="text-lg font-semibold text-slate-900">{p.nombre}</h3><Badge tone={p.inscrito_en ? 'green' : 'amber'}>{p.inscrito_en ? 'Inscripto' : 'Preinscripto'}</Badge></div>
      <section><h4 class="mb-3 font-semibold text-slate-800">Escuela de verano</h4>
        <dl class="grid gap-3 sm:grid-cols-2">{dato('Escuela', nombreEscuelaEav(p.escuela_eav))}{dato('Temporada', String(p.temporada))}</dl>
      </section>
      <section><h4 class="mb-3 font-semibold text-slate-800">Estudiante</h4>
        <dl class="grid gap-3 sm:grid-cols-2">{dato('DNI', p.dni)}{dato('Fecha de nacimiento', fechaEav(p.nacimiento))}{dato('Género', p.genero)}
          {dato('Escuela actual', p.escuela_actual_id ? nombreEscuelaEav(p.escuela_actual) : p.escuela_actual_otra || 'No informada')}{dato('Domicilio', p.domicilio)}</dl>
      </section>
      <section><h4 class="mb-3 font-semibold text-slate-800">Adulto responsable</h4>
        <dl class="grid gap-3 sm:grid-cols-2">{dato('Nombre', p.responsable)}{dato('Vínculo', p.vinculo)}{dato('Teléfono', p.telefono)}{dato('Correo electrónico', p.email)}</dl>
      </section>
      <section><h4 class="mb-3 font-semibold text-slate-800">Estado de inscripción</h4>
        <dl class="grid gap-3 sm:grid-cols-2">{dato('Preinscripción recibida', fechaHoraEav(p.creado_en))}
          {dato('Inscripción confirmada', p.inscrito_en ? fechaHoraEav(p.inscrito_en) : 'Pendiente')}
          {dato('Documentación del legajo', p.inscrito_en ? (p.legajo_completo ? 'Completa' : 'Incompleta') : 'Pendiente de confirmación')}</dl>
      </section>
    </div>
  </Modal>
}
