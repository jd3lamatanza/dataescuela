import { supabase } from './supabase'
import { confirmar, toast } from '../ui/kit'

export async function estadosPin(integrantes: number[]): Promise<Record<number, boolean>> {
  const estados: Record<number, boolean> = {}
  for (let i = 0; i < integrantes.length; i += 500) {
    const r = await supabase.rpc('eoe_pin_estado_distrital', { p_integrantes: integrantes.slice(i, i + 500) })
    if (r.error) throw r.error
    for (const fila of r.data as { integrante_id: number; tiene_pin: boolean }[]) estados[fila.integrante_id] = fila.tiene_pin
  }
  return estados
}

export async function blanquearPin(escuela: number, integrante: number, nombre: string): Promise<boolean> {
  if (!await confirmar('Blanquear PIN de validación', {
    text: `Verificá la identidad de ${nombre} por un canal de confianza. El PIN anterior y sus accesos a legajos dejarán de funcionar; deberá crear un PIN nuevo.`,
    ok: 'Blanquear PIN', danger: true,
  })) return false
  const r = await supabase.rpc('eoe_pin_blanquear_distrital', { p_escuela: escuela, p_integrante: integrante })
  if (r.error) { toast.error(r.error.message); return false }
  toast.ok('PIN blanqueado'); return true
}
