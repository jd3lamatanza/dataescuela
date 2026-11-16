import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { Alert, Lbl, Spinner } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { fechaNacimientoISO, formatearFechaNacimiento } from '../lib/fechaPreinscripcion'
import './preinscripcionEav.css'

interface Escuela { id: number; nombre: string | null; tipo: string | null; numero: number | null; codigo: string | null; localidad: string | null; eav: string | null }
const etiqueta = (e: Escuela) => [e.tipo || e.codigo, e.numero, e.nombre, e.localidad ? `(${e.localidad})` : ''].filter(Boolean).join(' ')
const vacio = () => ({ escuela: '', dni: '', nombre: '', nacimiento: '', genero: '', actual: '', otra: '', domicilio: '', responsable: '', vinculo: '', telefono: '', email: '' })
const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/eav-preinscripcion`
const FIELD = 'eav-field'

function Seccion({ numero, title, descripcion, children }: { numero: string; title: string; descripcion: string; children: ComponentChildren }) {
  return <section class="eav-section">
    <div class="eav-section-heading"><span class="eav-step">{numero}</span><div><h2>{title}</h2><p>{descripcion}</p></div></div>
    <div class="eav-fields">{children}</div>
  </section>
}

async function solicitar(body: unknown) {
  const respuesta = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_KEY }, body: JSON.stringify(body) })
  const datos = await respuesta.json()
  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la solicitud.')
  return datos
}

function SelectorEscuela({ label, escuelas, value, onChange, otra = false }: { label: string; escuelas: Escuela[]; value: string; onChange(v: string): void; otra?: boolean }) {
  const [buscar, setBuscar] = useState('')
  const seleccion = value === 'otra' ? 'Otra escuela' : escuelas.find((e) => String(e.id) === value)
  const texto = typeof seleccion === 'string' ? seleccion : seleccion ? etiqueta(seleccion) : ''
  return <div class="eav-selector">
    <Lbl label={`Buscar ${label.toLocaleLowerCase('es-AR')}`}><input class={FIELD} type="search" value={buscar} onInput={(e) => setBuscar(e.currentTarget.value)} placeholder="Escribí nombre o número" /></Lbl>
    <Lbl label={label}><select class={FIELD} required value={value} onChange={(e) => onChange(e.currentTarget.value)}>
      <option value="">Seleccioná una escuela</option>
      {texto && value !== 'otra' && !escuelas.filter((e) => etiqueta(e).toLocaleLowerCase('es-AR').includes(buscar.trim().toLocaleLowerCase('es-AR'))).some((e) => String(e.id) === value) && <option value={value}>{texto}</option>}
      {escuelas.filter((e) => etiqueta(e).toLocaleLowerCase('es-AR').includes(buscar.trim().toLocaleLowerCase('es-AR'))).map((e) => <option key={e.id} value={String(e.id)}>{etiqueta(e)}</option>)}
      {otra && <option value="otra">Otra escuela</option>}
    </select></Lbl>
  </div>
}

export function PreinscripcionEav() {
  const [escuelas, setEscuelas] = useState<Escuela[] | null>(null)
  const [form, setForm] = useState(vacio)
  const [error, setError] = useState('')
  const [errorFecha, setErrorFecha] = useState('')
  const [busy, setBusy] = useState(false)
  const [completo, setCompleto] = useState(false)
  const fechaInput = useRef<HTMLInputElement>(null)
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
  const enviar = async (e: Event) => {
    e.preventDefault(); setError('')
    const nacimiento = fechaNacimientoISO(form.nacimiento)
    if (!nacimiento) {
      setErrorFecha('Ingresá una fecha válida que no sea futura, con el formato día/mes/año.')
      fechaInput.current?.focus()
      return
    }
    setBusy(true)
    try {
      await solicitar({ action: 'enviar', form: { ...form, nacimiento, escuela: Number(form.escuela), actual: form.actual === 'otra' ? null : Number(form.actual), otra: form.actual === 'otra' ? form.otra : null } })
      setForm(vacio()); setCompleto(true); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la solicitud.') }
    finally { setBusy(false) }
  }
  return <main class="eav-public">
    <div class="eav-page">
      <header class="eav-header">
        <div class="eav-logos">
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
      {completo ? <div class="eav-card eav-success" role="status"><span class="eav-success-icon"><Icon name="check" class="size-7" /></span><h2>¡Preinscripción realizada!</h2><p>Recibimos los datos correctamente. La escuela los revisará antes de confirmar la vacante.</p><button class="eav-submit" onClick={() => setCompleto(false)}>Realizar otra preinscripción</button></div> : <>
        {!escuelas ? <>{error ? <Alert tone="error">{error}</Alert> : <Spinner />}</> : <form class="eav-card eav-form" onSubmit={enviar}>
          <div class="eav-intro"><span class="eav-intro-icon"><Icon name="sun" class="size-5" /></span><div><h2>¡Comencemos!</h2><p>Completá los datos para solicitar una vacante. Todos los campos son obligatorios.</p></div></div>
          <Seccion numero="1" title="Elegí la escuela de verano" descripcion="Buscá por nombre o número y elegí una escuela.">
          <SelectorEscuela label="Escuela de verano" escuelas={escuelas.filter((e) => e.eav === 'Sí')} value={form.escuela} onChange={(v) => setForm((f) => ({ ...f, escuela: v }))} />
          </Seccion>
          <Seccion numero="2" title="Datos del estudiante" descripcion="Ingresá los datos de quien participará de la escuela de verano.">
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
          <SelectorEscuela label="Escuela a la que asiste actualmente" escuelas={escuelas} value={form.actual} otra onChange={(v) => setForm((f) => ({ ...f, actual: v }))} />
          {form.actual === 'otra' && <Lbl label="Nombre de la escuela actual"><input class={FIELD} required maxLength={200} value={form.otra} onInput={set('otra')} /></Lbl>}
          <Lbl label="Domicilio"><input class={FIELD} required minLength={3} maxLength={200} placeholder="Calle, número y localidad" value={form.domicilio} onInput={set('domicilio')} /></Lbl>
          </Seccion>
          <Seccion numero="3" title="Datos de contacto" descripcion="Necesitamos los datos de una persona adulta responsable.">
          <Lbl label="Adulto responsable (nombre completo)"><input class={FIELD} required minLength={3} maxLength={200} placeholder="Apellido y nombre" value={form.responsable} onInput={set('responsable')} /></Lbl>
          <Lbl label="Vínculo"><select class={FIELD} required value={form.vinculo} onChange={set('vinculo')}><option value="">Seleccionar</option>{['Madre/Padre', 'Familiar Directo', 'Familia de Abrigo', 'Institución', 'Otro'].map((v) => <option value={v}>{v}</option>)}</select></Lbl>
          <Lbl label="Teléfono"><input class={FIELD} type="tel" required minLength={6} maxLength={40} pattern={'(?:[0-9 ]|\\+|\\(|\\)|-){6,40}'} value={form.telefono} onInput={set('telefono')} /></Lbl>
          <Lbl label="Email"><input class={FIELD} type="email" required maxLength={120} value={form.email} onInput={set('email')} /></Lbl>
          <p class="eav-help">Cuando la escuela confirme los datos, se informará por correo electrónico. La confirmación se realizará en una etapa posterior.</p>
          </Seccion>
          <div class="eav-footer"><p>La preinscripción no garantiza una vacante. Los datos se utilizarán para gestionar esta solicitud.</p>
            {error && <Alert tone="error">{error}</Alert>}
            <button class="eav-submit" disabled={busy}>{busy ? 'Enviando…' : 'Realizar preinscripción'}<Icon name="chevr" class="size-5" /></button>
          </div>
        </form>}
      </>}
    </div>
  </main>
}
