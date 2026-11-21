import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync, useDebounced } from '../lib/hooks'
import { descargar } from '../lib/download'
import { Alert, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, PageHeader, Pager, Spinner, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'

interface EventoEscolar { id: string; nombre: string; fecha: string }
interface AcreditadoEscolar {
  id: number; nombre: string; dni: string; cargo: string; evento_id: string; evento: string; fecha: string; firmas_configuradas: boolean
}
interface Resultado { total: number; registros: AcreditadoEscolar[] }
const fecha = (s: string) => s.split('-').reverse().join('/')

export function AcreditacionEscolar() {
  const [buscar, setBuscar] = useState(''), [evento, setEvento] = useState('')
  const [orden, setOrden] = useState('fecha'), [desc, setDesc] = useState(true), [pagina, setPagina] = useState(1)
  const [tamano, setTamano] = useState(15)
  const [descargando, setDescargando] = useState<number | null>(null)
  const consulta = useDebounced(buscar.trim().slice(0, 80))
  const eventos = useAsync(async () => {
    const r = await supabase.rpc('acreditacion_escolar_eventos')
    if (r.error) throw r.error
    return r.data as EventoEscolar[]
  }, [])
  const resultado = useAsync(async () => {
    const r = await supabase.rpc('acreditacion_escolar_listar', {
      p_busqueda: consulta, p_evento: evento || null, p_orden: orden, p_desc: desc,
      p_limite: tamano, p_offset: (pagina - 1) * tamano,
    })
    if (r.error) throw r.error
    return r.data as Resultado
  }, [consulta, evento, orden, desc, pagina, tamano])
  const bajar = async (registro: AcreditadoEscolar) => {
    setDescargando(registro.id)
    try {
      const r = await supabase.functions.invoke('acreditacion-escolar', { body: { persona: registro.id, evento: registro.evento_id } })
      if (r.error) {
        let mensaje = r.error.message
        if (r.error.context instanceof Response) {
          const detalle = await r.error.context.json().catch(() => null)
          if (typeof detalle?.error === 'string') mensaje = detalle.error
        }
        throw new Error(mensaje)
      }
      if (!(r.data instanceof Blob) || r.data.type !== 'application/pdf') throw new Error('El servicio no devolvió una constancia PDF.')
      descargar(new Uint8Array(await r.data.arrayBuffer()), `constancia-${registro.dni}.pdf`, 'application/pdf')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo descargar la constancia.') }
    finally { setDescargando(null) }
  }
  return <>
    <PageHeader title="Acreditación" subtitle="Personas acreditadas en los eventos de tu escuela." />
    {eventos.error && <div class="mb-3"><Alert tone="error">{eventos.error}</Alert></div>}
    <div class="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Lbl label="Buscar"><input class={FIELD} type="search" maxLength={80} placeholder="Nombre, DNI, cargo o evento" value={buscar} onInput={(e) => { setBuscar(e.currentTarget.value); setPagina(1) }} /></Lbl>
      <Lbl label="Evento"><select class={FIELD} value={evento} onChange={(e) => { setEvento(e.currentTarget.value); setPagina(1) }}><option value="">Todos los eventos</option>{eventos.data?.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {fecha(e.fecha)}</option>)}</select></Lbl>
      <Lbl label="Ordenar por"><select class={FIELD} value={orden} onChange={(e) => { setOrden(e.currentTarget.value); setPagina(1) }}><option value="fecha">Fecha del evento</option><option value="nombre">Nombre</option><option value="dni">DNI</option><option value="evento">Evento</option></select></Lbl>
      <Lbl label="Dirección"><select class={FIELD} value={desc ? 'desc' : 'asc'} onChange={(e) => { setDesc(e.currentTarget.value === 'desc'); setPagina(1) }}><option value="asc">Ascendente</option><option value="desc">Descendente</option></select></Lbl>
      <Lbl label="Resultados por página"><select class={FIELD} value={tamano} onChange={(e) => { setTamano(Number(e.currentTarget.value)); setPagina(1) }}>{[10, 15, 25, 50].map((n) => <option value={n}>{n} por página</option>)}</select></Lbl>
    </div>
    {resultado.error && <div class="mb-3"><Alert tone="error">{resultado.error}</Alert></div>}
    {resultado.loading || consulta !== buscar.trim().slice(0, 80) ? <Spinner /> : resultado.data && <>
      <p class="mb-3 text-sm text-slate-500">{resultado.data.total} acreditado(s)</p>
      {!resultado.data.registros.length ? <EmptyState title="Sin acreditados" text="No hay registros con esos criterios." /> : <Card>
        <ul class="-my-4 divide-y divide-slate-200">{resultado.data.registros.map((r) => <li key={r.id} class="flex flex-wrap items-start gap-3 py-3">
          <div class="min-w-0 flex-1">
            <p class="break-words font-semibold text-slate-900">{r.nombre}</p>
            <p class="text-sm text-slate-600">DNI {r.dni} · {r.cargo}</p>
            <p class="text-sm text-slate-600">{r.evento} · {fecha(r.fecha)}</p>
            {!r.firmas_configuradas && <p class="mt-1 text-xs text-amber-700">La Distrital aún debe configurar las firmas de este evento.</p>}
          </div>
          <button type="button" class={BTN_SECONDARY} disabled={!r.firmas_configuradas || descargando !== null} onClick={() => bajar(r)} aria-label={`Descargar constancia de ${r.nombre}`}><Icon name="download" />{descargando === r.id ? 'Descargando…' : 'Constancia PDF'}</button>
        </li>)}</ul>
      </Card>}
      <Pager page={pagina} total={resultado.data.total} size={tamano} onPage={setPagina} />
    </>}
  </>
}
