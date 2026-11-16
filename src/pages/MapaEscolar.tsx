import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { colorNivel, coordenadasValidas, filtrarMapa, LOCALIDADES_MAPA, type EscuelaMapa } from '../lib/mapaEscolar'
import { Alert, BTN_SECONDARY, FIELD, Lbl, PageHeader, Spinner } from '../ui/kit'
import { Icon } from '../ui/Icon'
import './mapaEscolar.css'

async function cargarEscuelas(): Promise<EscuelaMapa[]> {
  const resultado: EscuelaMapa[] = []
  for (let offset = 0; ; offset += 500) {
    const r = await supabase.from('escuelas').select('id,clave,nombre,tipo,numero,nivel,modalidad,localidad,calle,nu_calle,te,latitud,longitud')
      .in('localidad', [...LOCALIDADES_MAPA]).order('id').range(offset, offset + 499)
    if (r.error) throw r.error
    resultado.push(...r.data)
    if (r.data.length < 500) return resultado
  }
}

function contenidoPopup(e: EscuelaMapa) {
  const div = document.createElement('div')
  const titulo = document.createElement('strong')
  titulo.textContent = e.clave || [e.tipo, e.numero].filter(Boolean).join(' ') || `Escuela ${e.id}`
  div.appendChild(titulo)
  for (const texto of [e.nombre, [e.nivel, e.modalidad].filter(Boolean).join(' · '), [e.calle, e.nu_calle].filter((v) => v != null && v !== '').join(' '), e.localidad, e.te ? `Teléfono: ${e.te}` : '']) {
    if (!texto) continue
    const linea = document.createElement('div')
    linea.textContent = texto
    div.appendChild(linea)
  }
  return div
}

function Mapa({ escuelas, onErrorMapa }: { escuelas: EscuelaMapa[]; onErrorMapa(): void }) {
  const contenedor = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)
  useEffect(() => {
    if (!contenedor.current) return
    const instancia = L.map(contenedor.current).setView([-34.79, -58.64], 11)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    })
    tiles.on('tileerror', onErrorMapa)
    tiles.addTo(instancia)
    mapa.current = instancia
    capa.current = L.layerGroup().addTo(instancia)
    const actualizar = () => instancia.invalidateSize()
    addEventListener('beforeprint', actualizar)
    addEventListener('afterprint', actualizar)
    const observer = new ResizeObserver(actualizar)
    observer.observe(contenedor.current)
    return () => {
      removeEventListener('beforeprint', actualizar)
      removeEventListener('afterprint', actualizar)
      observer.disconnect()
      instancia.remove()
      mapa.current = null
      capa.current = null
    }
  }, [])
  useEffect(() => {
    if (!mapa.current || !capa.current) return
    capa.current.clearLayers()
    const puntos: L.LatLngExpression[] = []
    for (const e of escuelas) {
      if (!coordenadasValidas(e)) continue
      const punto: L.LatLngExpression = [e.latitud, e.longitud]
      puntos.push(punto)
      const marcador = L.circleMarker(punto, { radius: 6, color: '#ffffff', weight: 2, fillColor: colorNivel(e.nivel), fillOpacity: 0.95 })
      if (e.clave) {
        const etiqueta = document.createElement('span')
        etiqueta.textContent = e.clave
        marcador.bindTooltip(etiqueta, { permanent: true, direction: 'right', className: 'mapa-escolar-etiqueta', offset: [4, 0] })
      }
      marcador.bindPopup(contenidoPopup(e))
      marcador.addTo(capa.current)
    }
    if (puntos.length) mapa.current.fitBounds(L.latLngBounds(puntos), { padding: [40, 40], maxZoom: 15 })
  }, [escuelas])
  return <div ref={contenedor} class="mapa-escolar-lienzo" aria-label="Mapa interactivo de escuelas" />
}

export function MapaEscolar() {
  const { data, error, loading } = useAsync(cargarEscuelas, [])
  const [localidades, setLocalidades] = useState<string[]>([...LOCALIDADES_MAPA])
  const [nivel, setNivel] = useState(''), [modalidad, setModalidad] = useState(''), [busqueda, setBusqueda] = useState('')
  const [errorMapa, setErrorMapa] = useState(false)
  const filas = useMemo(() => filtrarMapa(data ?? [], localidades, nivel, modalidad, busqueda), [data, localidades, nivel, modalidad, busqueda])
  const mapeadas = filas.filter(coordenadasValidas)
  const niveles = [...new Set((data ?? []).map((e) => e.nivel).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'es-AR'))
  const modalidades = [...new Set((data ?? []).map((e) => e.modalidad).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'es-AR'))
  const cambiarLocalidad = (localidad: string, seleccionada: boolean) => setLocalidades((actual) => seleccionada ? [...actual, localidad] : actual.filter((l) => l !== localidad))
  return <div class="mapa-escolar">
    <div class="mapa-escolar-controles">
      <PageHeader title="Mapa Escolar" subtitle="Jefatura Distrital 3 · González Catán, 20 de Junio y Virrey del Pino" />
      {error && <Alert tone="error">{error}</Alert>}
      {errorMapa && <Alert tone="warning">No se pudieron cargar algunas partes del mapa base. Comprobá tu conexión y recargá la página.</Alert>}
      {loading && !data ? <Spinner /> : data && <div class="mb-4 grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <fieldset><legend class="mb-1 text-sm font-medium text-slate-700">Localidades</legend><div class="flex flex-wrap gap-x-4 gap-y-2">{LOCALIDADES_MAPA.map((l) => <label key={l} class="inline-flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={localidades.includes(l)} onChange={(e) => cambiarLocalidad(l, e.currentTarget.checked)} />{l}</label>)}</div></fieldset>
        <Lbl label="Nivel"><select class={FIELD} value={nivel} onChange={(e) => setNivel(e.currentTarget.value)}><option value="">Todos los niveles</option>{niveles.map((n) => <option key={n}>{n}</option>)}</select></Lbl>
        <Lbl label="Modalidad"><select class={FIELD} value={modalidad} onChange={(e) => setModalidad(e.currentTarget.value)}><option value="">Todas las modalidades</option>{modalidades.map((m) => <option key={m}>{m}</option>)}</select></Lbl>
        <Lbl label="Buscar escuela"><input class={FIELD} type="search" value={busqueda} onInput={(e) => setBusqueda(e.currentTarget.value)} placeholder="Clave, nombre o dirección" /></Lbl>
        <div class="flex flex-wrap items-center justify-between gap-3 lg:col-span-4">
          <div class="text-sm text-slate-600"><strong>{mapeadas.length}</strong> escuelas en el mapa · {filas.length - mapeadas.length} sin coordenadas</div>
          <button type="button" class={BTN_SECONDARY} disabled={!mapeadas.length} onClick={() => window.print()}><Icon name="download" />Imprimir / Guardar PDF</button>
        </div>
      </div>}
    </div>
    {data && <div class="mapa-escolar-impresion">
      <div class="mapa-escolar-encabezado"><strong>DataEscuela v2 · Jefatura Distrital 3 - La Matanza</strong><br />Mapa Escolar · {localidades.join(', ')}{nivel ? ` · ${nivel}` : ''}{modalidad ? ` · ${modalidad}` : ''} · {mapeadas.length} escuelas</div>
      <Mapa escuelas={filas} onErrorMapa={() => setErrorMapa(true)} />
    </div>}
    {data && filas.some((e) => !coordenadasValidas(e)) && <details class="mapa-escolar-controles mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <summary class="cursor-pointer font-semibold text-slate-700">Escuelas sin coordenadas ({filas.length - mapeadas.length})</summary>
      <ul class="mt-2 space-y-1 text-slate-600">{filas.filter((e) => !coordenadasValidas(e)).map((e) => <li key={e.id}>{e.clave || `Escuela ${e.id}`} · {e.nombre || 'Sin nombre'} · {e.localidad}</li>)}</ul>
    </details>}
  </div>
}
