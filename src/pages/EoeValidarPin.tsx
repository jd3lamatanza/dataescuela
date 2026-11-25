import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, FIELD, Lbl, Modal, Spinner } from '../ui/kit'
import { Icon } from '../ui/Icon'

interface Integrante { id: number; nombre: string; cargo: string | null; tiene_pin: boolean }

export function ValidarPin({ titulo, onClose, onSubmit }: { titulo: string; onClose(): void; onSubmit(integrante: number, pin: string): Promise<void> }) {
  const [integrante, setIntegrante] = useState(''), [pin, setPin] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lista = useAsync(async () => {
    const r = await supabase.rpc('eoe_pin_integrantes')
    if (r.error) throw r.error
    return (r.data as Integrante[]).filter((i) => i.tiene_pin)
  })
  const enviar = async (e: Event) => {
    e.preventDefault(); setError(''); setBusy(true)
    try { await onSubmit(Number(integrante), pin) }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo validar el PIN') }
    finally { setBusy(false); setPin('') }
  }
  return <Modal title={titulo} onClose={onClose}><form class="space-y-4" onSubmit={enviar}>
    {(error || lista.error) && <Alert tone="error">{error || lista.error}</Alert>}
    {lista.loading ? <Spinner /> : <>
      {!lista.data?.length && <Alert tone="warning">Ningún integrante tiene un PIN creado. Configuralo en PIN de Validación.</Alert>}
      <Lbl label="Integrante"><select class={FIELD} required value={integrante} onChange={(e) => setIntegrante(e.currentTarget.value)}><option value="">Seleccionar integrante</option>{lista.data?.map((i) => <option key={i.id} value={i.id}>{i.nombre}{i.cargo ? ` · ${i.cargo}` : ''}</option>)}</select></Lbl>
      <Lbl label="PIN de seis dígitos"><input class={FIELD} required type="password" inputMode="numeric" autocomplete="off" pattern="[0-9]{6}" maxLength={6} value={pin} onInput={(e) => setPin(e.currentTarget.value)} /></Lbl>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}><Icon name="x" class="size-4" />Cancelar</button><button class={BTN_PRIMARY} disabled={busy || !lista.data?.length}><Icon name="check" class="size-4" />Validar</button></div>
    </>}
  </form></Modal>
}
