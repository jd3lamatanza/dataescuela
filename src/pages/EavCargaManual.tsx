import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { fechaNacimientoISO, formatearFechaNacimiento } from '../lib/fechaPreinscripcion'
import { type Escuela } from '../lib/escuelaEtiqueta'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, FIELD, Lbl, Modal, Toggle, toast } from '../ui/kit'
import { SelectorEscuela } from './PreinscripcionEav'

const GENEROS = ['Varón', 'Mujer', 'No Binario']
const VINCULOS = ['Madre/Padre', 'Familiar Directo', 'Familia de Abrigo', 'Institución', 'Otro']
const vacio = { dni: '', nombre: '', nacimiento: '', genero: '', actual: '', fuera: false, otra: '', domicilio: '', responsable: '', vinculo: '', telefono: '', email: '' }

/** Carga manual de una preinscripción por la cuenta eav; aplica las mismas reglas que el formulario público. */
export function CargarPreinscripcion({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [f, setF] = useState(vacio)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { data: escuelas } = useAsync(async () => {
    const r = await supabase.rpc('eav_escuelas_opciones')
    if (r.error) throw r.error
    return r.data as Escuela[]
  })
  const set = (k: 'dni' | 'nombre' | 'nacimiento' | 'genero' | 'otra' | 'domicilio' | 'responsable' | 'vinculo' | 'telefono' | 'email') => (e: Event) => setF((v) => ({ ...v, [k]: (e.currentTarget as HTMLInputElement).value }))

  const enviar = async (e: Event) => {
    e.preventDefault()
    const nacimiento = fechaNacimientoISO(f.nacimiento)
    if (!nacimiento) return setError('Ingresá una fecha de nacimiento válida (dd/mm/aaaa).')
    if (!f.fuera && !f.actual) return setError('Seleccioná la escuela actual del estudiante.')
    setBusy(true); setError('')
    const r = await supabase.rpc('eav_preinscripcion_cargar', {
      p_dni: f.dni, p_nombre: f.nombre, p_nacimiento: nacimiento, p_genero: f.genero,
      p_actual: f.fuera ? null : Number(f.actual), p_otra: f.fuera ? f.otra : null,
      p_domicilio: f.domicilio, p_responsable: f.responsable, p_vinculo: f.vinculo, p_telefono: f.telefono, p_email: f.email,
    })
    setBusy(false)
    if (r.error) return setError(r.error.message)
    toast.ok('Preinscripción cargada'); onDone()
  }

  return <Modal title="Cargar preinscripción" onClose={() => { if (!busy) onClose() }} wide>
    <form onSubmit={enviar} class="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div class="grid gap-3 sm:grid-cols-2">
        <Lbl label="DNI del estudiante"><input class={FIELD} inputMode="numeric" pattern="[0-9]{7,8}" maxLength={8} required placeholder="Sin puntos ni espacios" value={f.dni} onInput={set('dni')} /></Lbl>
        <Lbl label="Apellido y nombre completo"><input class={FIELD} required minLength={3} maxLength={200} value={f.nombre} onInput={set('nombre')} /></Lbl>
        <Lbl label="Fecha de nacimiento"><input class={FIELD} inputMode="numeric" required maxLength={10} placeholder="dd/mm/aaaa" value={f.nacimiento}
          onInput={(e) => setF((v) => ({ ...v, nacimiento: formatearFechaNacimiento(e.currentTarget.value) }))} /></Lbl>
        <Lbl label="Género autopercibido"><select class={FIELD} required value={f.genero} onChange={set('genero')}><option value="">Seleccionar</option>{GENEROS.map((g) => <option value={g}>{g}</option>)}</select></Lbl>
        <div class="space-y-3 sm:col-span-2">
          <Toggle checked={f.fuera} onChange={(v) => setF((x) => ({ ...x, fuera: v, actual: '', otra: '' }))} label="Otra escuela fuera de JD3" />
          {f.fuera
            ? <Lbl label="Nombre de la escuela actual"><input class={FIELD} required maxLength={200} value={f.otra} onInput={set('otra')} /></Lbl>
            : <SelectorEscuela id="eav-manual-escuela" label="Escuela actual" escuelas={escuelas ?? []} value={f.actual} onChange={(v) => setF((x) => ({ ...x, actual: v }))} />}
        </div>
        <div class="sm:col-span-2"><Lbl label="Domicilio"><input class={FIELD} required minLength={3} maxLength={200} placeholder="Calle, número y localidad" value={f.domicilio} onInput={set('domicilio')} /></Lbl></div>
        <Lbl label="Adulto responsable"><input class={FIELD} required minLength={3} maxLength={200} value={f.responsable} onInput={set('responsable')} /></Lbl>
        <Lbl label="Vínculo"><select class={FIELD} required value={f.vinculo} onChange={set('vinculo')}><option value="">Seleccionar</option>{VINCULOS.map((v) => <option value={v}>{v}</option>)}</select></Lbl>
        <Lbl label="Teléfono"><input class={FIELD} type="tel" required minLength={6} maxLength={40} value={f.telefono} onInput={set('telefono')} /></Lbl>
        <Lbl label="Email"><input class={FIELD} type="email" required maxLength={120} value={f.email} onInput={set('email')} /></Lbl>
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class={BTN_SECONDARY} disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="submit" class={BTN_PRIMARY} disabled={busy}>{busy ? 'Guardando…' : 'Cargar preinscripción'}</button>
      </div>
    </form>
  </Modal>
}
