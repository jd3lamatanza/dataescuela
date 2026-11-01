import { useState } from 'preact/hooks'
import { useAuth } from '../lib/auth'
import { AuthLayout } from '../ui/Layout'
import { Alert, BTN_PRIMARY, FIELD, Lbl } from '../ui/kit'

export function Login() {
  const { signIn } = useAuth()
  const [ident, setIdent] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: Event) => {
    e.preventDefault()
    setBusy(true)
    setErr(await signIn(ident, pass))
    setBusy(false)
  }

  return (
    <AuthLayout title="Ingresar" subtitle="Usá tu CUE (escuelas), CUIL (inspectores) o usuario.">
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Usuario"><input class={FIELD} value={ident} onInput={(e) => setIdent(e.currentTarget.value)} autocomplete="username" inputMode="text" required autofocus /></Lbl>
        <Lbl label="Contraseña"><input class={FIELD} type="password" value={pass} onInput={(e) => setPass(e.currentTarget.value)} autocomplete="current-password" required /></Lbl>
        <button class={`${BTN_PRIMARY} w-full`} disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </AuthLayout>
  )
}

export function CambiarClave({ forced }: { forced?: boolean }) {
  const { changePassword, signOut } = useAuth()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: Event) => {
    e.preventDefault()
    if (a.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres')
    if (a === '12345678') return setErr('Elegí una contraseña distinta de la inicial')
    if (a !== b) return setErr('Las contraseñas no coinciden')
    setBusy(true)
    setErr(await changePassword(a))
    setBusy(false)
  }

  return (
    <AuthLayout title="Cambiar contraseña" subtitle={forced ? 'Es tu primer ingreso: definí una contraseña personal para continuar.' : undefined}>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Nueva contraseña"><input class={FIELD} type="password" value={a} onInput={(e) => setA(e.currentTarget.value)} autocomplete="new-password" required /></Lbl>
        <Lbl label="Repetir contraseña"><input class={FIELD} type="password" value={b} onInput={(e) => setB(e.currentTarget.value)} autocomplete="new-password" required /></Lbl>
        <button class={`${BTN_PRIMARY} w-full`} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        {forced && <button type="button" onClick={signOut} class="w-full text-center text-sm text-slate-500 hover:underline">Salir</button>}
      </form>
    </AuthLayout>
  )
}
