import { useEffect, useMemo, useState } from 'preact/hooks'
import { buscarGuias, type GuiaEscolar } from '../lib/ayudaEscolar'
import { cargarGuias } from '../lib/ayudaEscolarDatos'
import { href } from '../lib/router'
import { supabase } from '../lib/supabase'
import { MODULES } from '../modules'
import { Alert, BTN_SECONDARY, Card, FIELD, Modal, PageHeader, Spinner } from '../ui/kit'
import { Icon } from '../ui/Icon'

export function AyudaEscolar() {
  const [buscar, setBuscar] = useState('')
  const [seleccion, setSeleccion] = useState('')
  const [guias, setGuias] = useState<GuiaEscolar[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [intento, setIntento] = useState(0)
  useEffect(() => {
    let activa = true
    setCargando(true); setError('')
    cargarGuias().then((data) => { if (activa) setGuias(data) })
      .catch((e) => { if (activa) setError(e instanceof Error ? e.message : 'No se pudieron cargar las guías.') })
      .finally(() => { if (activa) setCargando(false) })
    return () => { activa = false }
  }, [intento])
  const resultados = useMemo(() => buscarGuias(guias, buscar), [guias, buscar])
  const guia = resultados.find((g) => g.id === seleccion) ?? resultados[0]
  return <>
    <PageHeader title="Ayuda para escuelas" subtitle="Guías paso a paso para usar DataEscuela." />
    {cargando ? <Spinner /> : error ? <div class="space-y-2"><Alert tone="error">{error}</Alert><button type="button" class={BTN_SECONDARY} onClick={() => setIntento((i) => i + 1)}>Reintentar</button></div> :
    <div class="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside aria-label="Buscar y elegir una guía">
        <label class="block text-sm font-medium text-slate-700" for="ayuda-busqueda">Buscar en la ayuda</label>
        <input id="ayuda-busqueda" class={`${FIELD} mt-1`} type="search" value={buscar} onInput={(e) => setBuscar(e.currentTarget.value)} placeholder="Ej.: nómina, firma, matrícula" />
        <nav class="mt-3 space-y-1" aria-label="Guías escolares">
          {resultados.map((g) => {
            const modulo = MODULES.find((m) => m.id === g.modulo)
            return <button type="button" key={g.id} aria-pressed={guia?.id === g.id} onClick={() => setSeleccion(g.id)}
              class={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm ${guia?.id === g.id ? 'bg-sky-100 font-semibold text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`}>
              <Icon name={modulo?.icon ?? 'book'} class="size-4 shrink-0" />{g.titulo}
            </button>
          })}
        </nav>
      </aside>
      {guia ? <Guia key={guia.id} guia={guia} /> : <Card><p class="text-sm text-slate-600">{guias.length ? 'No encontramos guías con esos términos. Probá otra búsqueda.' : 'Todavía no hay guías publicadas.'}</p></Card>}
    </div>}
  </>
}

function Guia({ guia }: { guia: GuiaEscolar }) {
  const modulo = MODULES.find((m) => m.id === guia.modulo)
  return <article class="min-w-0 space-y-4">
    <Card title={guia.titulo} action={modulo && <a href={href(modulo.path)} class={BTN_SECONDARY}>Abrir módulo <Icon name="external" class="size-4" /></a>}>
      <p class="text-sm text-slate-600">{guia.descripcion}</p>
    </Card>
    {guia.captura_drive && <Captura id={guia.id} titulo={guia.titulo} />}
    {guia.secciones.map((seccion, i) => <Card key={i} title={seccion.titulo}>
      <ol class="list-decimal space-y-4 pl-5 text-sm leading-6 text-slate-700">{seccion.pasos.map((paso, j) => {
        const medio = seccion.medios?.[j]
        return <li key={j}>
          <p>{paso}</p>
          {medio?.imagen_drive && <div class="mt-3"><Captura id={guia.id} titulo={`${guia.titulo}, paso ${j + 1}`} imagen={medio.imagen_drive} /></div>}
          {medio?.youtube && /^[A-Za-z0-9_-]{11}$/.test(medio.youtube) && <div class="mt-3">
            <iframe class="aspect-video w-full max-w-3xl rounded-lg" src={`https://www.youtube-nocookie.com/embed/${medio.youtube}`}
              title={`Video: ${guia.titulo}, paso ${j + 1}`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
            <a class="text-sky-700 underline" href={`https://www.youtube.com/watch?v=${medio.youtube}`} target="_blank" rel="noopener noreferrer">Abrir video en YouTube</a>
          </div>}
        </li>
      })}</ol>
    </Card>)}
  </article>
}

export function Captura({ id, titulo, imagen }: { id: string; titulo: string; imagen?: string }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [ampliada, setAmpliada] = useState(false)
  useEffect(() => {
    let activa = true
    let objeto = ''
    setUrl(''); setError('')
    const cargar = async () => {
      try {
        const { data, error: fallo } = await supabase.functions.invoke('ayuda-captura', { body: { captura: id, imagen } })
        if (fallo) throw fallo
        if (!(data instanceof Blob) || data.type !== 'application/octet-stream') throw new Error('La respuesta no es una captura válida.')
        const firma = new Uint8Array(await data.slice(0, 8).arrayBuffer())
        const mime = firma[0] === 255 && firma[1] === 216 && firma[2] === 255 ? 'image/jpeg' : 'image/png'
        objeto = URL.createObjectURL(new Blob([data], { type: mime }))
        if (activa) setUrl(objeto)
        else URL.revokeObjectURL(objeto)
      } catch (e) {
        if (activa) setError(e instanceof Error ? e.message : 'No se pudo cargar la captura.')
      }
    }
    void cargar()
    return () => { activa = false; if (objeto) URL.revokeObjectURL(objeto) }
  }, [id, imagen, version])
  return <Card title="Captura de pantalla">
    <p class="mb-3 text-xs text-slate-500">Tocá la imagen para ampliarla.</p>
    {error ? <div class="space-y-2"><Alert tone="error">No se pudo cargar la captura: {error}</Alert><button type="button" class={BTN_SECONDARY} onClick={() => setVersion((v) => v + 1)}>Reintentar</button></div>
      : !url ? <Spinner /> : <button type="button" class="block w-full overflow-hidden rounded-lg border border-slate-200 text-left focus:outline-none focus:ring-2 focus:ring-sky-500" aria-label={`Ampliar captura de ${titulo}`} onClick={() => setAmpliada(true)}>
        <img src={url} alt={`Captura de ${titulo}`} class="block h-auto w-full" />
      </button>}
    {ampliada && url && <Modal title={`Captura: ${titulo}`} onClose={() => setAmpliada(false)} wide>
      <p class="mb-2 text-xs text-slate-500">Deslizá horizontalmente para recorrer la imagen ampliada.</p>
      <div class="overflow-x-auto"><img src={url} alt={`Captura ampliada de ${titulo}`} class="block h-auto w-[1100px] max-w-none" /></div>
    </Modal>}
  </Card>
}
