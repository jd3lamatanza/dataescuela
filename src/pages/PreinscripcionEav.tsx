import { useEffect, useState } from 'preact/hooks'
import { Alert, BTN_PRIMARY, Card, FIELD, Lbl, Spinner } from '../ui/kit'
import { Logo } from '../ui/Layout'

interface Escuela { id: number; nombre: string | null; tipo: string | null; numero: number | null; codigo: string | null; localidad: string | null; eav: string | null }
const etiqueta = (e: Escuela) => [e.tipo || e.codigo, e.numero, e.nombre, e.localidad ? `(${e.localidad})` : ''].filter(Boolean).join(' ')
const vacio = () => ({ escuela: '', dni: '', nombre: '', nacimiento: '', genero: '', actual: '', otra: '', domicilio: '', responsable: '', vinculo: '', telefono: '', email: '' })
const fechaHoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/eav-preinscripcion`

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
  return <div>
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
  const [busy, setBusy] = useState(false)
  const [completo, setCompleto] = useState(false)
  useEffect(() => {
    let vivo = true
    solicitar({ action: 'escuelas' }).then((r) => { if (vivo) setEscuelas(r.escuelas) }).catch((e) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [])
  const set = (k: keyof typeof form) => (e: Event) => setForm((v) => ({ ...v, [k]: (e.currentTarget as HTMLInputElement).value }))
  const enviar = async (e: Event) => {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      await solicitar({ action: 'enviar', form: { ...form, escuela: Number(form.escuela), actual: form.actual === 'otra' ? null : Number(form.actual), otra: form.actual === 'otra' ? form.otra : null } })
      setForm(vacio()); setCompleto(true); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la solicitud.') }
    finally { setBusy(false) }
  }
  return <main class="min-h-screen bg-slate-50 px-4 py-8">
    <div class="mx-auto max-w-xl">
      <header class="mb-5 text-center"><Logo class="mx-auto mb-3 size-14" /><h1 class="text-2xl font-bold text-slate-900">Preinscripción a Escuelas de Verano</h1><p class="mt-1 font-medium text-sky-700">Catán, 20 de Junio, Virrey del Pino</p><p class="mt-2 text-sm text-slate-600">Formulario sólo para escuelas de la Jefatura Distrital 3 de La Matanza</p></header>
      {completo ? <Card><div role="status" class="space-y-3 text-center"><h2 class="text-xl font-bold text-emerald-700">Preinscripción realizada</h2><p class="text-sm text-slate-700">La preinscripción fue registrada correctamente. La escuela revisará los datos.</p><button class={BTN_PRIMARY} onClick={() => setCompleto(false)}>Realizar otra preinscripción</button></div></Card> : <>
        {error && <div class="mb-3"><Alert tone="error">{error}</Alert></div>}
        {!escuelas ? !error && <Spinner /> : <Card><form class="space-y-4" onSubmit={enviar}>
          <p class="text-sm text-slate-600">Todos los datos son obligatorios. La preinscripción no garantiza una vacante.</p>
          <SelectorEscuela label="Escuela de verano" escuelas={escuelas.filter((e) => e.eav === 'Sí')} value={form.escuela} onChange={(v) => setForm((f) => ({ ...f, escuela: v }))} />
          <Lbl label="DNI del estudiante"><input class={FIELD} inputMode="numeric" pattern="[0-9]{7,8}" maxLength={8} required value={form.dni} onInput={set('dni')} /></Lbl>
          <Lbl label="Apellido y nombre completo"><input class={FIELD} required minLength={3} maxLength={200} value={form.nombre} onInput={set('nombre')} /></Lbl>
          <Lbl label="Fecha de nacimiento"><input class={FIELD} type="date" required max={fechaHoy()} value={form.nacimiento} onInput={set('nacimiento')} /></Lbl>
          <Lbl label="Género autopercibido"><select class={FIELD} required value={form.genero} onChange={set('genero')}><option value="">Seleccionar</option>{['Varón', 'Mujer', 'No Binario'].map((v) => <option value={v}>{v}</option>)}</select></Lbl>
          <SelectorEscuela label="Escuela a la que asiste actualmente" escuelas={escuelas} value={form.actual} otra onChange={(v) => setForm((f) => ({ ...f, actual: v }))} />
          {form.actual === 'otra' && <Lbl label="Nombre de la escuela actual"><input class={FIELD} required maxLength={200} value={form.otra} onInput={set('otra')} /></Lbl>}
          <Lbl label="Domicilio"><input class={FIELD} required minLength={3} maxLength={200} value={form.domicilio} onInput={set('domicilio')} /></Lbl>
          <Lbl label="Adulto responsable (nombre completo)"><input class={FIELD} required minLength={3} maxLength={200} value={form.responsable} onInput={set('responsable')} /></Lbl>
          <Lbl label="Vínculo"><select class={FIELD} required value={form.vinculo} onChange={set('vinculo')}><option value="">Seleccionar</option>{['Madre/Padre', 'Familiar Directo', 'Familia de Abrigo', 'Institución', 'Otro'].map((v) => <option value={v}>{v}</option>)}</select></Lbl>
          <Lbl label="Teléfono"><input class={FIELD} type="tel" required minLength={6} maxLength={40} pattern={'(?:[0-9 ]|\\+|\\(|\\)|-){6,40}'} value={form.telefono} onInput={set('telefono')} /></Lbl>
          <Lbl label="Email"><input class={FIELD} type="email" required maxLength={120} value={form.email} onInput={set('email')} /></Lbl>
          <p class="text-xs text-slate-600">Cuando la escuela confirme los datos, se informará por correo electrónico. La confirmación se realizará en una etapa posterior.</p>
          <p class="text-xs text-slate-600">Los datos se utilizarán para gestionar la preinscripción a las Escuelas de Verano de la Jefatura Distrital 3 de La Matanza.</p>
          <button class={`${BTN_PRIMARY} w-full`} disabled={busy}>{busy ? 'Enviando…' : 'Realizar preinscripción'}</button>
        </form></Card>}
      </>}
    </div>
  </main>
}
