import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { GuiaEscolar } from '../lib/ayudaEscolar'
import { cargarGuias, gestionarGuia } from '../lib/ayudaEscolarDatos'
import { MODULES, canAccess } from '../modules'
import { Alert, BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, Card, confirmar, FIELD, Lbl, PageHeader, Spinner, toast } from '../ui/kit'
import { Captura } from './AyudaEscolar'

type Borrador = Pick<GuiaEscolar, 'modulo' | 'titulo' | 'descripcion' | 'secciones'> & Partial<Pick<GuiaEscolar, 'id' | 'version' | 'captura_drive'>>
const modulos = MODULES.filter((m) => canAccess(m, 'escolar') && m.id !== 'ayuda-escolar')
const nueva = (): Borrador => ({ modulo: modulos[0].id, titulo: '', descripcion: '', secciones: [{ titulo: '', pasos: [''] }] })

export function AyudaDistrital() {
  const [guias, setGuias] = useState<GuiaEscolar[]>([])
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [sucia, setSucia] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [intento, setIntento] = useState(0)
  useEffect(() => {
    let activa = true
    setCargando(true); setError('')
    cargarGuias().then((items) => { if (activa) setGuias(items) })
      .catch((e) => { if (activa) setError(e instanceof Error ? e.message : 'No se pudieron cargar las guías.') })
      .finally(() => { if (activa) setCargando(false) })
    return () => { activa = false }
  }, [intento])
  useEffect(() => {
    if (!sucia) return
    const advertir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', advertir)
    return () => window.removeEventListener('beforeunload', advertir)
  }, [sucia])
  const elegir = async (id: string | null) => {
    if (id === seleccion) return
    if (sucia && !await confirmar('Descartar cambios sin guardar', { text: 'Los cambios de la guía actual se perderán.', ok: 'Descartar', danger: true })) return
    setSucia(false); setSeleccion(id)
  }
  const guardada = (g: GuiaEscolar) => {
    setGuias((prev) => [...prev.filter((x) => x.id !== g.id), g].sort((a, b) => a.posicion - b.posicion || a.titulo.localeCompare(b.titulo, 'es')))
    setSucia(false); setSeleccion(g.id)
  }
  const eliminada = (id: string) => { setGuias((prev) => prev.filter((g) => g.id !== id)); setSucia(false); setSeleccion(null) }
  const guia = guias.find((g) => g.id === seleccion)
  return <>
    <PageHeader title="Administrar ayuda escolar" subtitle="Creá y actualizá las guías disponibles para las escuelas." actions={<button type="button" class={BTN_PRIMARY} onClick={() => void elegir('nueva')}>Nueva guía</button>} />
    {cargando ? <Spinner /> : error ? <div class="space-y-2"><Alert tone="error">{error}</Alert><button type="button" class={BTN_SECONDARY} onClick={() => setIntento((i) => i + 1)}>Reintentar</button></div> :
      <div class="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card title="Guías publicadas">
          {!guias.length && <p class="text-sm text-slate-500">Todavía no hay guías.</p>}
          <nav class="space-y-1" aria-label="Guías publicadas">
            {guias.map((g) => <button key={g.id} type="button" aria-pressed={seleccion === g.id} onClick={() => void elegir(g.id)}
              class={`min-h-11 w-full rounded-md px-3 text-left text-sm ${seleccion === g.id ? 'bg-sky-100 font-semibold text-sky-900' : 'text-slate-700 hover:bg-slate-100'}`}>{g.titulo}</button>)}
          </nav>
        </Card>
        {seleccion === 'nueva' || guia ? <Editor key={`${seleccion}-${guia?.version ?? 'nueva'}`} inicial={guia ?? nueva()} onSucio={setSucia} onGuardada={guardada} onEliminada={eliminada} onCancelar={() => void elegir(null)} />
          : <Card><p class="text-sm text-slate-600">Seleccioná una guía para editarla o creá una nueva.</p></Card>}
      </div>}
  </>
}

function leerImagen(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader()
    lector.onerror = () => reject(new Error('No se pudo leer la imagen.'))
    lector.onload = () => {
      if (typeof lector.result !== 'string' || !lector.result.includes(',')) return reject(new Error('No se pudo leer la imagen.'))
      resolve(lector.result.slice(lector.result.indexOf(',') + 1))
    }
    lector.readAsDataURL(file)
  })
}

function Editor({ inicial, onSucio, onGuardada, onEliminada, onCancelar }: {
  inicial: Borrador; onSucio(v: boolean): void; onGuardada(g: GuiaEscolar): void; onEliminada(id: string): void; onCancelar(): void
}) {
  const [guia, setGuia] = useState<Borrador>(() => structuredClone(inicial))
  const [archivo, setArchivo] = useState<File | null>(null)
  const archivoInput = useRef<HTMLInputElement>(null)
  const [quitar, setQuitar] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const cambiar = (actualizacion: Partial<Borrador>) => { setGuia((g) => ({ ...g, ...actualizacion })); onSucio(true) }
  const seccion = (i: number, patch: Partial<Borrador['secciones'][number]>) => cambiar({ secciones: guia.secciones.map((s, j) => i === j ? { ...s, ...patch } : s) })
  const guardar = async (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    if (archivo && (archivo.type !== 'image/png' || archivo.size > 2 * 1024 * 1024 || !archivo.size)) { setError('Elegí una imagen PNG de hasta 2 MB.'); return }
    setOcupado(true)
    try {
      const imagen = archivo ? { mime: archivo.type, base64: await leerImagen(archivo) } : undefined
      const result = await gestionarGuia({ accion: 'guardar', guia, imagen, quitar_captura: quitar })
      if (!result?.guia) throw new Error('El servidor no devolvió la guía guardada.')
      onGuardada(result.guia); toast.ok('Guía guardada y publicada.')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la guía.') }
    finally { setOcupado(false) }
  }
  const eliminar = async () => {
    if (!guia.id || !await confirmar('Eliminar guía', { text: 'La guía dejará de mostrarse a las escuelas. Los archivos permanecerán en Drive.', ok: 'Eliminar', danger: true })) return
    setError(''); setOcupado(true)
    try {
      if (!guia.version) throw new Error('No se encontró la versión de la guía.')
      await gestionarGuia({ accion: 'eliminar', guia: { id: guia.id, version: guia.version } })
      onEliminada(guia.id); toast.ok('Guía eliminada.')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo eliminar la guía.') }
    finally { setOcupado(false) }
  }
  return <form class="min-w-0 space-y-4" onSubmit={guardar}>
    <fieldset disabled={ocupado} class="min-w-0 space-y-4">
    {error && <Alert tone="error">{error}</Alert>}
    <Card title={guia.id ? 'Editar guía' : 'Nueva guía'}>
      <div class="space-y-4">
        <Lbl label="Módulo asociado"><select class={FIELD} value={guia.modulo} onChange={(e) => cambiar({ modulo: e.currentTarget.value })}>
          {modulos.map((m) => <option value={m.id} key={m.id}>{m.label}</option>)}
        </select></Lbl>
        <Lbl label="Título de la guía"><input required maxLength={160} class={FIELD} value={guia.titulo} onInput={(e) => cambiar({ titulo: e.currentTarget.value })} /></Lbl>
        <Lbl label="Descripción"><textarea required maxLength={2000} rows={3} class={FIELD} value={guia.descripcion} onInput={(e) => cambiar({ descripcion: e.currentTarget.value })} /></Lbl>
      </div>
    </Card>
    {guia.secciones.map((s, i) => <Card key={i} title={`Sección ${i + 1}`} action={<button type="button" disabled={ocupado || guia.secciones.length === 1} class={BTN_SECONDARY} onClick={() => cambiar({ secciones: guia.secciones.filter((_, j) => j !== i) })}>Quitar sección</button>}>
      <div class="space-y-4">
        <Lbl label="Título de la sección"><input required maxLength={160} class={FIELD} value={s.titulo} onInput={(e) => seccion(i, { titulo: e.currentTarget.value })} /></Lbl>
        {s.pasos.map((paso, j) => <div key={j} class="space-y-1">
          <Lbl label={`Paso ${j + 1}`}><textarea required maxLength={4000} rows={3} class={FIELD} value={paso} onInput={(e) => seccion(i, { pasos: s.pasos.map((p, k) => k === j ? e.currentTarget.value : p) })} /></Lbl>
          <button type="button" disabled={ocupado || s.pasos.length === 1} class={BTN_SECONDARY} onClick={() => seccion(i, { pasos: s.pasos.filter((_, k) => k !== j) })}>Quitar paso</button>
        </div>)}
        <button type="button" class={BTN_SECONDARY} disabled={ocupado || s.pasos.length >= 50} onClick={() => seccion(i, { pasos: [...s.pasos, ''] })}>Agregar paso</button>
      </div>
    </Card>)}
    <button type="button" class={BTN_SECONDARY} disabled={ocupado || guia.secciones.length >= 30} onClick={() => cambiar({ secciones: [...guia.secciones, { titulo: '', pasos: [''] }] })}>Agregar sección</button>
    {guia.id && guia.captura_drive && !quitar && <Captura key={`${guia.id}-${guia.version}`} id={guia.id} titulo={guia.titulo || 'la guía'} />}
    <Card title="Captura de pantalla">
      <div class="space-y-3">
        <p class="text-sm text-slate-600">Subí una captura PNG de hasta 2 MB. Evitá incluir datos personales reales. El archivo se guarda en la carpeta de Drive de ayuda.</p>
        <Lbl label={guia.captura_drive ? 'Reemplazar captura (opcional)' : 'Agregar captura (opcional)'}><input ref={archivoInput} type="file" accept="image/png" disabled={ocupado || quitar} class={`${FIELD} py-2`} onChange={(e) => { setArchivo(e.currentTarget.files?.[0] ?? null); onSucio(true) }} /></Lbl>
        {archivo && <button type="button" class={BTN_SECONDARY} onClick={() => { setArchivo(null); if (archivoInput.current) archivoInput.current.value = ''; onSucio(true) }}>Quitar archivo seleccionado</button>}
        {guia.captura_drive && <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={quitar} disabled={ocupado || !!archivo} onChange={(e) => { setQuitar(e.currentTarget.checked); onSucio(true) }} />Quitar la captura de la guía</label>}
        <p class="text-xs text-slate-500">Al reemplazar o quitar una captura, el archivo anterior permanece en Drive.</p>
      </div>
    </Card>
    <div class="flex flex-wrap gap-2">
      <button type="submit" class={BTN_PRIMARY} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar y publicar'}</button>
      <button type="button" class={BTN_SECONDARY} disabled={ocupado} onClick={onCancelar}>Cancelar</button>
      {guia.id && <button type="button" class={BTN_DANGER} disabled={ocupado} onClick={() => void eliminar()}>Eliminar guía</button>}
    </div>
    </fieldset>
  </form>
}
