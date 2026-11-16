import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Alert, Lbl, Spinner } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { fechaNacimientoISO, formatearFechaNacimiento } from '../lib/fechaPreinscripcion'
import { etiquetaEscuela, type Escuela } from '../lib/escuelaEtiqueta'
import './preinscripcionEav.css'

export { etiquetaEscuela, type Escuela } from '../lib/escuelaEtiqueta'
const vacio = () => ({ escuela: '', dni: '', nombre: '', nacimiento: '', genero: '', actual: '', otra: '', domicilio: '', responsable: '', vinculo: '', telefono: '', email: '' })
const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/eav-preinscripcion`
const FIELD = 'eav-field'

function Seccion({ numero, title, descripcion, children }: { numero: string; title: string; descripcion: string; children: ComponentChildren }) {
  return <section class="eav-section">
    <div class="eav-section-heading"><span class="eav-step" aria-hidden="true">{numero}</span><div><h2 tabIndex={-1} data-paso-titulo>{title}</h2><p>{descripcion}</p></div></div>
    <div class="eav-fields">{children}</div>
  </section>
}

async function solicitar(body: unknown) {
  const respuesta = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_KEY }, body: JSON.stringify(body) })
  const datos = await respuesta.json()
  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la solicitud.')
  return datos
}

export function SelectorEscuela({ id, label, escuelas, value, onChange, otra = false }: { id: string; label: string; escuelas: Escuela[]; value: string; onChange(v: string): void; otra?: boolean }) {
  const [buscar, setBuscar] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectorRef = useRef<HTMLDivElement>(null)
  const omitirApertura = useRef(false)
  const apuntandoOpciones = useRef(false)
  const seleccion = value === 'otra' ? 'Otra escuela' : escuelas.find((e) => String(e.id) === value)
  const texto = typeof seleccion === 'string' ? seleccion : seleccion ? etiquetaEscuela(seleccion) : ''
  const opciones = [...escuelas.map((e) => ({ value: String(e.id), texto: etiquetaEscuela(e) })), ...(otra ? [{ value: 'otra', texto: 'Otra escuela' }] : [])]
    .filter((e) => e.texto.toLocaleLowerCase('es-AR').includes(buscar.trim().toLocaleLowerCase('es-AR')))
  useEffect(() => { inputRef.current?.setCustomValidity(value ? '' : 'Seleccioná una escuela de la lista.') }, [value])
  useEffect(() => {
    if (abierto && activo >= 0 && opciones[activo]) document.getElementById(`${id}-opcion-${opciones[activo].value}`)?.scrollIntoView({ block: 'nearest' })
  }, [activo, abierto, buscar, id])
  useEffect(() => {
    if (!abierto) return
    const cerrarFuera = (e: PointerEvent) => {
      if (e.target instanceof Node && !selectorRef.current?.contains(e.target)) {
        apuntandoOpciones.current = false
        setAbierto(false); setBuscar(''); setActivo(-1)
      }
    }
    document.addEventListener('pointerdown', cerrarFuera)
    return () => document.removeEventListener('pointerdown', cerrarFuera)
  }, [abierto])
  const elegir = (opcion: { value: string }) => {
    apuntandoOpciones.current = false
    inputRef.current?.setCustomValidity('')
    onChange(opcion.value)
    setBuscar(''); setAbierto(false); setActivo(-1)
    omitirApertura.current = true
    inputRef.current?.focus()
    omitirApertura.current = false
  }
  const limpiar = () => {
    onChange('')
    setBuscar(''); setActivo(-1); setAbierto(true)
    inputRef.current?.setCustomValidity('Seleccioná una escuela de la lista.')
    inputRef.current?.focus()
  }
  return <div class="eav-selector" ref={selectorRef}>
    <label class="eav-selector-label" for={id}>{label}</label>
    <div class="eav-combobox">
      <input id={id} ref={inputRef} class={FIELD} role="combobox" aria-expanded={abierto} aria-controls={`${id}-opciones`} aria-autocomplete="list" aria-activedescendant={abierto && activo >= 0 && opciones[activo] ? `${id}-opcion-${opciones[activo].value}` : undefined}
        required autoComplete="off" placeholder="Buscá por nombre o número" value={abierto ? buscar : texto}
        onFocus={() => { if (!omitirApertura.current) { setBuscar(''); setAbierto(true); setActivo(-1) } }}
        onClick={() => { if (!abierto) { setBuscar(''); setAbierto(true) } }}
        onBlur={(e) => {
          const conservar = apuntandoOpciones.current && !e.relatedTarget
          apuntandoOpciones.current = false
          if (!conservar) { setAbierto(false); setBuscar(''); setActivo(-1) }
        }}
        onInput={(e) => { setBuscar(e.currentTarget.value); setAbierto(true); setActivo(-1); onChange(''); e.currentTarget.setCustomValidity('Seleccioná una escuela de la lista.') }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); setAbierto(true)
            setActivo((i) => opciones.length ? (e.key === 'ArrowDown' ? Math.min(i + 1, opciones.length - 1) : i <= 0 ? opciones.length - 1 : i - 1) : -1)
          } else if (e.key === 'Enter' && abierto) {
            e.preventDefault()
            if (activo >= 0 && opciones[activo]) elegir(opciones[activo])
          } else if (e.key === 'Escape' && abierto) { e.preventDefault(); setAbierto(false); setBuscar(''); setActivo(-1) }
        }} />
      {value || buscar ? <button type="button" class="eav-combobox-clear" aria-label={`Limpiar ${label.toLocaleLowerCase('es-AR')}`} onPointerDown={(e) => e.preventDefault()} onClick={limpiar}><Icon name="x" class="size-5" /></button> : <Icon name="search" class="eav-combobox-icon" />}
      {abierto && <ul id={`${id}-opciones`} class="eav-options" role="listbox" aria-label={label}
        onPointerDown={(e) => { apuntandoOpciones.current = true; if (e.pointerType === 'mouse') e.preventDefault() }}
        onPointerCancel={() => { apuntandoOpciones.current = false }}>
        {opciones.map((opcion, i) => <li id={`${id}-opcion-${opcion.value}`} key={opcion.value} role="option" aria-selected={value === opcion.value}
          class={i === activo ? 'eav-option-active' : ''} onClick={() => elegir(opcion)}>{opcion.texto}</li>)}
        {!opciones.length && <li class="eav-no-options" role="presentation">No encontramos escuelas con esa búsqueda.</li>}
      </ul>}
    </div>
  </div>
}

export function PreinscripcionEav() {
  const [escuelas, setEscuelas] = useState<Escuela[] | null>(null)
  const [form, setForm] = useState(vacio)
  const [error, setError] = useState('')
  const [errorFecha, setErrorFecha] = useState('')
  const [busy, setBusy] = useState(false)
  const [completo, setCompleto] = useState(false)
  const [paso, setPaso] = useState(1)
  const fechaInput = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const nombreEscuela = (id: string) => {
    const escuela = escuelas?.find((e) => String(e.id) === id)
    return escuela ? etiquetaEscuela(escuela) : ''
  }
  useEffect(() => {
    let vivo = true
    solicitar({ action: 'escuelas' }).then((r) => { if (vivo) setEscuelas(r.escuelas) }).catch((e) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [])
  const set = (k: keyof typeof form) => (e: Event) => setForm((v) => ({ ...v, [k]: (e.currentTarget as HTMLInputElement).value }))
  const cambiarFecha = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const digitosAntes = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length
    const valor = formatearFechaNacimiento(input.value)
    setForm((f) => ({ ...f, nacimiento: valor }))
    setErrorFecha('')
    requestAnimationFrame(() => {
      let posicion = 0, digitos = 0
      while (posicion < valor.length && digitos < digitosAntes) {
        if (/\d/.test(valor[posicion])) digitos++
        posicion++
      }
      input.setSelectionRange(posicion, posicion)
    })
  }
  const irAPaso = (siguiente: number) => {
    setError(''); setErrorFecha(''); setPaso(siguiente)
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[data-paso-titulo]')?.focus())
  }
  const enviar = async (e: Event) => {
    e.preventDefault(); setError('')
    const nacimiento = paso >= 2 ? fechaNacimientoISO(form.nacimiento) : null
    if (paso === 2 && !nacimiento) {
      setErrorFecha('Ingresá una fecha válida que no sea futura, con el formato día/mes/año.')
      fechaInput.current?.focus()
      return
    }
    if (paso < 4) { irAPaso(paso + 1); return }
    if (!nacimiento) { irAPaso(2); setErrorFecha('Ingresá una fecha válida que no sea futura, con el formato día/mes/año.'); return }
    setBusy(true)
    try {
      await solicitar({ action: 'enviar', form: { ...form, nacimiento, escuela: Number(form.escuela), actual: form.actual === 'otra' ? null : Number(form.actual), otra: form.actual === 'otra' ? form.otra : null } })
      setForm(vacio()); setPaso(1); setCompleto(true); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la solicitud.') }
    finally { setBusy(false) }
  }
  return <main class="eav-public">
    <div class="eav-page">
      <header class="eav-header">
        <div class="eav-logos">
          <img src={`${import.meta.env.BASE_URL}pba-logo.png`} alt="Gobierno de la Provincia de Buenos Aires" />
          <img src={`${import.meta.env.BASE_URL}eav-logo.png`} alt="Escuelas Abiertas en Verano" />
          <img src={`${import.meta.env.BASE_URL}mtz-logo.png`} alt="MTZ" />
        </div>
        <div class="eav-header-copy">
          <span class="eav-kicker">Verano para compartir</span>
          <h1>Preinscripción a Escuelas de Verano</h1>
          <p class="eav-subtitle">Catán, 20 de Junio, Virrey del Pino</p>
          <p class="eav-area">Formulario sólo para escuelas de la Jefatura Distrital 3 de La Matanza</p>
        </div>
      </header>
      {completo ? <div class="eav-card eav-success" role="status"><span class="eav-success-icon"><Icon name="check" class="size-7" /></span><h2>¡Preinscripción realizada!</h2><p>Recibimos los datos correctamente. La inscripción se hace efectiva al entregar la documentación requerida en la escuela.</p><button class="eav-submit" onClick={() => setCompleto(false)}>Realizar otra preinscripción</button></div> : <>
        {!escuelas ? <>{error ? <Alert tone="error">{error}</Alert> : <Spinner />}</> : <form ref={formRef} class="eav-card eav-form" onSubmit={enviar}>
          <div class="eav-intro"><span class="eav-intro-icon"><Icon name="sun" class="size-5" /></span><div><h2>{['¡Comencemos!', '¡Vamos muy bien!', '¡Ya falta poco!', '¡Último paso!'][paso - 1]}</h2><p>{['Vamos a completar la preinscripción juntos. Todos los campos son obligatorios.', 'Contanos un poco sobre el estudiante.', 'Ahora necesitamos los datos de contacto.', 'Revisá los datos antes de enviar la preinscripción.'][paso - 1]}</p></div></div>
          <div class="eav-progress" aria-label={`Paso ${paso} de 4`}>
            <div class="eav-progress-label"><span>Paso {paso} de 4</span><span>{['Escuela', 'Estudiante', 'Adulto de referencia', 'Confirmación'][paso - 1]}</span></div>
            <div class="eav-progress-track" aria-hidden="true">{[1, 2, 3, 4].map((n) => <span key={n} class={n <= paso ? 'eav-progress-filled' : ''} />)}</div>
          </div>
          {paso === 1 && <Seccion numero="1" title="Selección de escuela" descripcion="Buscá por nombre o número y elegí una escuela de verano.">
          <SelectorEscuela id="escuela-verano" label="Escuela de verano" escuelas={escuelas.filter((e) => e.eav === 'Sí')} value={form.escuela} onChange={(v) => setForm((f) => ({ ...f, escuela: v }))} />
          </Seccion>}
          {paso === 2 && <Seccion numero="2" title="Datos del estudiante" descripcion="Ingresá los datos de quien participará de la escuela de verano.">
          <Lbl label="DNI del estudiante"><input class={FIELD} inputMode="numeric" pattern="[0-9]{7,8}" maxLength={8} required placeholder="Sin puntos ni espacios" value={form.dni} onInput={set('dni')} /></Lbl>
          <Lbl label="Apellido y nombre completo"><input class={FIELD} required minLength={3} maxLength={200} placeholder="Como figura en el DNI" value={form.nombre} onInput={set('nombre')} /></Lbl>
          <Lbl label="Fecha de nacimiento"><input ref={fechaInput} class={FIELD} type="text" inputMode="numeric" required maxLength={10} placeholder="dd/mm/aaaa" aria-describedby="ayuda-fecha-nacimiento" aria-invalid={!!errorFecha} value={form.nacimiento} onInput={cambiarFecha} onKeyDown={(e) => {
            const input = e.currentTarget
            const inicio = input.selectionStart, fin = input.selectionEnd
            if (inicio === null || inicio !== fin) return
            if (e.key === 'Backspace' && input.value[inicio - 1] === '/') input.setSelectionRange(inicio - 2, inicio)
            if (e.key === 'Delete' && input.value[inicio] === '/') input.setSelectionRange(inicio, inicio + 2)
          }} /></Lbl>
          <p id="ayuda-fecha-nacimiento" class="eav-help">Escribí día, mes y año. Por ejemplo: 05/02/2018.</p>
          {errorFecha && <Alert tone="error">{errorFecha}</Alert>}
          <Lbl label="Género autopercibido"><select class={FIELD} required value={form.genero} onChange={set('genero')}><option value="">Seleccionar</option>{['Varón', 'Mujer', 'No Binario'].map((v) => <option value={v}>{v}</option>)}</select></Lbl>
          <SelectorEscuela id="escuela-actual" label="Escuela a la que asiste actualmente" escuelas={escuelas} value={form.actual} otra onChange={(v) => setForm((f) => ({ ...f, actual: v }))} />
          {form.actual === 'otra' && <Lbl label="Nombre de la escuela actual"><input class={FIELD} required maxLength={200} value={form.otra} onInput={set('otra')} /></Lbl>}
          <Lbl label="Domicilio"><input class={FIELD} required minLength={3} maxLength={200} placeholder="Calle, número y localidad" value={form.domicilio} onInput={set('domicilio')} /></Lbl>
          </Seccion>}
          {paso === 3 && <Seccion numero="3" title="Adulto de referencia" descripcion="Ingresá los datos de contacto de una persona adulta responsable.">
          <Lbl label="Adulto responsable (nombre completo)"><input class={FIELD} required minLength={3} maxLength={200} placeholder="Apellido y nombre" value={form.responsable} onInput={set('responsable')} /></Lbl>
          <Lbl label="Vínculo"><select class={FIELD} required value={form.vinculo} onChange={set('vinculo')}><option value="">Seleccionar</option>{['Madre/Padre', 'Familiar Directo', 'Familia de Abrigo', 'Institución', 'Otro'].map((v) => <option value={v}>{v}</option>)}</select></Lbl>
          <Lbl label="Teléfono"><input class={FIELD} type="tel" required minLength={6} maxLength={40} pattern={'(?:[0-9 ]|\\+|\\(|\\)|-){6,40}'} value={form.telefono} onInput={set('telefono')} /></Lbl>
          <Lbl label="Email"><input class={FIELD} type="email" required maxLength={120} value={form.email} onInput={set('email')} /></Lbl>
          <p class="eav-help">Cuando la escuela confirme los datos, se informará por correo electrónico. La confirmación se realizará en una etapa posterior.</p>
          </Seccion>}
          {paso === 4 && <Seccion numero="4" title="Confirmación de datos" descripcion="Revisá que todo esté correcto. Podés volver atrás para hacer cambios.">
            <dl class="eav-summary">
              {[
                ['Escuela de verano', nombreEscuela(form.escuela)],
                ['DNI del estudiante', form.dni], ['Apellido y nombre completo', form.nombre], ['Fecha de nacimiento', form.nacimiento],
                ['Género autopercibido', form.genero], ['Escuela actual', form.actual === 'otra' ? form.otra : nombreEscuela(form.actual)],
                ['Domicilio', form.domicilio], ['Adulto responsable', form.responsable], ['Vínculo', form.vinculo], ['Teléfono', form.telefono], ['Email', form.email],
              ].map(([label, valor]) => <div key={label}><dt>{label}</dt><dd>{valor}</dd></div>)}
            </dl>
          </Seccion>}
          <div class="eav-footer"><p>La inscripción se hace efectiva al entregar la documentación requerida en la escuela. Los datos se utilizarán para gestionar esta solicitud.</p>
            {error && <Alert tone="error">{error}</Alert>}
            <div class="eav-actions">
              {paso > 1 && <button type="button" class="eav-back" disabled={busy} onClick={() => irAPaso(paso - 1)}><Icon name="chevl" class="size-5" />Volver</button>}
              <button type="submit" class="eav-submit" disabled={busy}>{busy ? 'Enviando…' : paso === 4 ? 'Confirmar y enviar' : 'Continuar'}<Icon name="chevr" class="size-5" /></button>
            </div>
          </div>
        </form>}
      </>}
    </div>
  </main>
}
