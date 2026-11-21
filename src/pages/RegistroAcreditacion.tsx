import { useState } from 'preact/hooks'
import { useAsync } from '../lib/hooks'
import { escuelaCargoVacia, fechaEvento, invocarPublico, personaVacia, type DatosPersona } from '../lib/acreditacion'
import { Alert } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { SelectorEscuela, etiquetaEscuela, type Escuela } from './PreinscripcionEav'
import './preinscripcionEav.css'

export function CamposAcreditacion({ form, setForm, escuelas, permitirExterna = false }: { form: DatosPersona; setForm(v: DatosPersona): void; escuelas: Escuela[]; permitirExterna?: boolean }) {
  const cambiar = (k: 'nombre' | 'dni' | 'email') => (e: Event) => setForm({ ...form, [k]: (e.currentTarget as HTMLInputElement).value })
  const cambiarEscuela = (indice: number, cambios: Partial<DatosPersona['escuelas'][number]>) =>
    setForm({ ...form, escuelas: form.escuelas.map((escuela, i) => i === indice ? { ...escuela, ...cambios } : escuela) })
  const cambiarCantidad = (cantidad: number) => setForm({
    ...form, escuelas: Array.from({ length: cantidad }, (_, i) => form.escuelas[i] ?? escuelaCargoVacia()),
  })
  return <div class="eav-fields">
    <label>Nombre completo<input class="eav-field" required minLength={3} maxLength={200} value={form.nombre} onInput={cambiar('nombre')} /></label>
    <label>DNI<input class="eav-field" required inputMode="numeric" pattern="[0-9]{7,8}" maxLength={8} placeholder="Sin puntos ni espacios" value={form.dni} onInput={cambiar('dni')} /></label>
    <label>¿Por cuántas escuelas necesita acreditarse?<select class="eav-field" value={form.escuelas.length} onChange={(e) => cambiarCantidad(Number(e.currentTarget.value))}>{[1, 2, 3, 4].map((n) => <option value={n}>{n}</option>)}</select></label>
    {form.escuelas.map((escuela, i) => <div key={i} class="space-y-2">
      {permitirExterna && <label class="flex items-center gap-2"><input type="checkbox" checked={escuela.externa} onChange={(e) => cambiarEscuela(i, { externa: e.currentTarget.checked })} />Escuela {i + 1} fuera de JD3</label>}
      {permitirExterna && escuela.externa
        ? <label key={`externa-${i}`}>Escuela {i + 1} fuera de JD3<input class="eav-field" required minLength={2} maxLength={200} value={escuela.escuelaExterna} onInput={(e) => cambiarEscuela(i, { escuelaExterna: e.currentTarget.value })} /></label>
        : <SelectorEscuela key={`interna-${i}`} id={`acreditacion-escuela-${i}`} label={`Escuela ${i + 1}`} escuelas={escuelas} value={escuela.escuela} onChange={(v) => cambiarEscuela(i, { escuela: v })} />}
      <label>Cargo en escuela {i + 1}<input class="eav-field" required minLength={2} maxLength={200} value={escuela.cargo} onInput={(e) => cambiarEscuela(i, { cargo: e.currentTarget.value })} /></label>
    </div>)}
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
      {completo ? <div class="eav-success" role="status"><h2>¡Listo!</h2><p>Tu acreditación se registró correctamente. No necesitás hacer nada más.</p></div> :
      evento.estado !== 'activo' ? <div class="eav-section"><Alert tone="info">La acreditación de este evento no está habilitada.</Alert></div> :
      <form onSubmit={enviar}>
        <div class="eav-progress"><div class="eav-progress-label">Paso {paso} de 2 · {paso === 1 ? 'Tus datos' : 'Confirmación'}</div><div class="eav-progress-track"><span class="eav-progress-filled" /><span class={paso === 2 ? 'eav-progress-filled' : ''} /></div></div>
        <section class="eav-section"><div class="eav-section-heading"><span class="eav-step">{paso}</span><div><h2>{paso === 1 ? '¡Bienvenido! Completá tus datos' : '¡Ya casi terminamos!'}</h2><p>{paso === 1 ? 'Todos los campos son obligatorios.' : 'Revisá los datos antes de confirmar.'}</p></div></div>
          {paso === 1 ? <CamposAcreditacion form={form} setForm={setForm} escuelas={escuelas} permitirExterna /> : <dl class="eav-summary">{[
            ['Nombre completo', form.nombre], ['DNI', form.dni],
            ...form.escuelas.flatMap((e, i) => {
              const seleccion = escuelas.find((escuela) => String(escuela.id) === e.escuela)
              return [[`Escuela ${i + 1}`, e.externa ? e.escuelaExterna : seleccion ? etiquetaEscuela(seleccion) : ''], [`Cargo en escuela ${i + 1}`, e.cargo]]
            }), ['Correo Oficial ABC', form.email],
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
