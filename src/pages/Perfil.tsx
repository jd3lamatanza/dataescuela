import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ROLE_LABELS } from '../modules'
import { Alert, BTN_PRIMARY, Card, FIELD, Lbl, PageHeader, toast } from '../ui/kit'

export function Perfil() {
  const { user, refresh } = useAuth()
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', telefono: user?.telefono ?? '', cargo: user?.cargo ?? '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value })

  const submit = async (e: Event) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('perfil_actualizar', { p_name: f.name, p_email: f.email, p_telefono: f.telefono, p_cargo: f.cargo })
    setBusy(false)
    if (error) return setErr(error.message)
    await refresh(); toast.ok('Perfil actualizado')
  }

  return (
    <>
      <PageHeader title="Mi perfil" subtitle="Tus datos personales. El correo se usa para recuperar el acceso a tu cuenta." />
      <Card class="max-w-2xl">
        <form onSubmit={submit} class="space-y-4">
          {err && <Alert tone="error">{err}</Alert>}
          <div class="grid gap-3 sm:grid-cols-2">
            <Lbl label="Apellido y nombre"><input class={FIELD} value={f.name} onInput={set('name')} required maxLength={200} /></Lbl>
            <Lbl label="Usuario de acceso"><input class={FIELD} value={user?.login ?? ''} disabled /></Lbl>
            <Lbl label="Correo electrónico"><input class={FIELD} type="email" value={f.email} onInput={set('email')} maxLength={254} autocomplete="email" /></Lbl>
            <Lbl label="Teléfono"><input class={FIELD} type="tel" value={f.telefono} onInput={set('telefono')} maxLength={40} /></Lbl>
            <Lbl label="Cargo o función"><input class={FIELD} value={f.cargo} onInput={set('cargo')} maxLength={120} /></Lbl>
            <Lbl label="Rol"><input class={FIELD} value={user ? ROLE_LABELS[user.role] : ''} disabled /></Lbl>
          </div>
          <div class="flex justify-end"><button class={BTN_PRIMARY} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
        </form>
      </Card>
    </>
  )
}
