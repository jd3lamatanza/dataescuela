import { useState } from 'preact/hooks'
import { useAsync } from '../lib/hooks'
import { fechaEvento, invocarPublico, personaVacia, type DatosPersona } from '../lib/acreditacion'
import { Alert } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { SelectorEscuela, etiquetaEscuela, type Escuela } from './PreinscripcionEav'
import './preinscripcionEav.css'

export function CamposAcreditacion({ form, setForm, escuelas }: { form: DatosPersona; setForm(v: DatosPersona): void; escuelas: Escuela[] }) {
  const cambiar = (k: keyof DatosPersona) => (e: Event) => setForm({ ...form, [k]: (e.currentTarget as HTMLInputElement).value })
  return <div class="eav-fields">
    <label>Nombre completo<input class="eav-field" required minLength={3} maxLength={200} value={form.nombre} onInput={cambiar('nombre')} /></label>
    <label>DNI<input class="eav-field" required inputMode="numeric" pattern="[0-9]{7,8}" maxLength={8} placeholder="Sin puntos ni espacios" value={form.dni} onInput={cambiar('dni')} /></label>
    <label>Cargo<input class="eav-field" required minLength={2} maxLength={200} value={form.cargo} onInput={cambiar('cargo')} /></label>
    <SelectorEscuela id="acreditacion-escuela" label="Escuela" escuelas={escuelas} value={form.escuela} onChange={(v) => setForm({ ...form, escuela: v })} />
    <label>Correo Oficial ABC<input class="eav-field" type="email" required maxLength={254} pattern="[a-zA-Z0-9._%+\-]+@abc[.]gob[.]ar" placeholder="nombre@abc.gob.ar" value={form.email} onInput={cambiar('email')} /></label>
  </div>
}

export function RegistroAcreditacion({ id }: { id: string }) {
  const { data, error, loading } = useAsync(() => invocarPublico('datos', id), [id])
  const [form, setForm] = useState(personaVacia)
  const [paso, setPaso] = useState(1)
  const [busy, setBusy] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [completo, setCompleto] = useState(false)
  const enviar = async (e: Event) => {
    e.preventDefault(); setMensaje('')
    if (paso === 1) { setPaso(2); return }
    setBusy(true)
    try { await invocarPublico('registrar', id, form); setForm(personaVacia()); setCompleto(true) }
    catch (err) { setMensaje(err instanceof Error ? err.message : 'No se pudo registrar la acreditación.') }
    finally { setBusy(false) }
  }
  const evento = data?.evento, escuelas = data?.escuelas ?? []
  return <main class="eav-public"><div class="eav-page">
    <header class="eav-header"><div class="eav-logos"><img src={`${import.meta.env.BASE_URL}pba-logo.png`} alt="Gobierno de la Provincia de Buenos Aires" /><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="DataEscuela" /></div>
      <div class="eav-header-copy"><span class="eav-kicker">Jefatura Distrital 3</span><h1>Acreditación de asistencia</h1><p class="eav-area">La Matanza</p></div></header>
    {loading && <p>Cargando evento…</p>}
    {error && <Alert tone="error">{error}</Alert>}
    {evento && <div class="eav-card eav-form">
      <div class="eav-intro"><span class="eav-intro-icon"><Icon name="calendar" class="size-5" /></span><div><h2>{evento.nombre}</h2><p>{fechaEvento(evento)} · {evento.lugar}</p><p>{evento.descripcion}</p></div></div>
      {completo ? <div class="eav-success" role="status"><h2>¡Acreditación realizada!</h2><p>Tu asistencia fue registrada correctamente. ¡Gracias por participar!</p></div> :
      evento.estado !== 'activo' ? <div class="eav-section"><Alert tone="info">La acreditación de este evento no está habilitada.</Alert></div> :
      <form onSubmit={enviar}>
        <div class="eav-progress"><div class="eav-progress-label">Paso {paso} de 2 · {paso === 1 ? 'Tus datos' : 'Confirmación'}</div><div class="eav-progress-track"><span class="eav-progress-filled" /><span class={paso === 2 ? 'eav-progress-filled' : ''} /></div></div>
        <section class="eav-section"><div class="eav-section-heading"><span class="eav-step">{paso}</span><div><h2>{paso === 1 ? '¡Bienvenido! Completá tus datos' : '¡Ya casi terminamos!'}</h2><p>{paso === 1 ? 'Todos los campos son obligatorios.' : 'Revisá los datos antes de confirmar.'}</p></div></div>
          {paso === 1 ? <CamposAcreditacion form={form} setForm={setForm} escuelas={escuelas} /> : <dl class="eav-summary">{[
            ['Nombre completo', form.nombre], ['DNI', form.dni], ['Cargo', form.cargo],
            ['Escuela', escuelas.find((e) => String(e.id) === form.escuela) ? etiquetaEscuela(escuelas.find((e) => String(e.id) === form.escuela)!) : ''], ['Correo Oficial ABC', form.email],
          ].map(([label, valor]) => <div key={label}><dt>{label}</dt><dd>{valor}</dd></div>)}</dl>}
        </section>
        <div class="eav-footer">{mensaje && <Alert tone="error">{mensaje}</Alert>}<div class="eav-actions">
          {paso === 2 && <button class="eav-back" type="button" disabled={busy} onClick={() => setPaso(1)}>Volver</button>}
          <button class="eav-submit" disabled={busy}>{busy ? 'Enviando…' : paso === 1 ? 'Continuar' : 'Confirmar acreditación'}</button>
        </div></div>
      </form>}
    </div>}
  </div></main>
}
