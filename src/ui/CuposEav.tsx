import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, FIELD, Lbl, Modal, toast } from './kit'

export async function cargarCuposEav(ids: number[]): Promise<Record<number, number>> {
  if (!ids.length) return {}
  const { data, error } = await supabase.from('eav_cupos').select('escuela_id,cupos').in('escuela_id', ids)
  if (error) throw error
  return Object.fromEntries(data.map((r) => [r.escuela_id, r.cupos]))
}

export function CuposEav({ escuela, cupos, onClose, onDone }: {
  escuela: { id: number; nombre: string }; cupos: number | null; onClose(): void; onDone(): void
}) {
  const [valor, setValor] = useState(cupos == null ? '' : String(cupos))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const guardar = async (e: Event) => {
    e.preventDefault()
    const texto = valor.trim()
    const cantidad = Number(texto)
    if (!/^\d+$/.test(texto) || !Number.isSafeInteger(cantidad) || cantidad > 2147483647) {
      setError('Ingresá un número entero entre 0 y 2147483647.')
      return
    }
    setError(''); setBusy(true)
    try {
      const { error: err } = await supabase.rpc('eav_asignar_cupos', { p_escuela: escuela.id, p_cupos: cantidad })
      if (err) { setError(err.message); return }
      toast.ok('Cupos de Escuela de Verano actualizados')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }
  return <Modal title="Asignar cupos de Escuela de Verano" onClose={onClose}>
    <form class="space-y-4" onSubmit={guardar}>
      <p class="text-sm text-slate-600">{escuela.nombre}</p>
      {error && <Alert tone="error">{error}</Alert>}
      <Lbl label="Cupos (vacantes)"><input class={FIELD} type="number" inputMode="numeric" min="0" max="2147483647" step="1" required autoFocus value={valor} onInput={(e) => setValor(e.currentTarget.value)} /></Lbl>
      <p class="text-xs text-slate-500">Indicá 0 si no tiene vacantes. El cupo se conserva hasta que se modifique.</p>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={busy} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
  </Modal>
}
