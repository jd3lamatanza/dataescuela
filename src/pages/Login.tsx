import { useState } from 'preact/hooks'
import { useAuth } from '../lib/auth'
import { getRememberSession } from '../lib/supabase'
import { AuthLayout } from '../ui/Layout'
import { Alert, BTN_PRIMARY, FIELD, Lbl } from '../ui/kit'

export function Login() {
  const { signIn, requestPasswordRecovery } = useAuth()
  const [ident, setIdent] = useState('')
  const [pass, setPass] = useState('')
  const [remember, setRemember] = useState(getRememberSession())
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: Event) => {
    e.preventDefault()
    setErr(null)
    setInfo(null)
    setBusy(true)
    setErr(await signIn(ident, pass, remember))
    setBusy(false)
  }

  const recuperar = async () => {
    if (!ident.trim()) return setErr('Ingresá tu usuario, CUE o CUIL para solicitar el enlace.')
    setErr(null)
    setInfo(null)
    setBusy(true)
    const error = await requestPasswordRecovery(ident)
    setBusy(false)
    if (error) setErr(error)
    else setInfo('Si la cuenta existe y tiene un correo registrado, recibirás un enlace para recuperar el acceso.')
  }

  return (
    <AuthLayout title="Ingresar" subtitle="Usá tu CUE (escuelas), CUIL (inspectores) o usuario.">
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        {info && <Alert tone="success">{info}</Alert>}
        <Lbl label="Usuario"><input class={FIELD} value={ident} onInput={(e) => setIdent(e.currentTarget.value)} autocomplete="username" inputMode="text" required autofocus /></Lbl>
        <Lbl label="Contraseña"><input class={FIELD} type="password" value={pass} onInput={(e) => setPass(e.currentTarget.value)} autocomplete="current-password" required /></Lbl>
        <label class="flex min-h-11 items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" class="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={remember} onChange={(e) => setRemember(e.currentTarget.checked)} />
          Recordarme en este equipo
        </label>
        <button class={`${BTN_PRIMARY} w-full`} disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        <button type="button" class="w-full py-2 text-sm font-medium text-blue-700 hover:underline" disabled={busy} onClick={recuperar}>
          {busy ? 'Procesando…' : '¿Olvidaste tu contraseña?'}
        </button>
      </form>
    </AuthLayout>
  )
}

export function CambiarClave({ forced, recovery }: { forced?: boolean; recovery?: boolean }) {
  const { changePassword, signOut } = useAuth()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: Event) => {
    e.preventDefault()
    if (a.length < (recovery ? 12 : 8)) return setErr(`La contraseña debe tener al menos ${recovery ? 12 : 8} caracteres`)
    if (a === '12345678') return setErr('Elegí una contraseña distinta de la inicial')
    if (a !== b) return setErr('Las contraseñas no coinciden')
    setBusy(true)
    setErr(await changePassword(a))
    setBusy(false)
  }

  return (
    <AuthLayout title="Cambiar contraseña" subtitle={recovery ? 'Recuperaste el acceso: definí una contraseña nueva para continuar.' : forced ? 'Es tu primer ingreso: definí una contraseña personal para continuar.' : undefined}>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        {recovery && <p class="text-sm text-slate-600">Usá al menos 12 caracteres y evitá reutilizar una contraseña anterior.</p>}
        <Lbl label="Nueva contraseña"><input class={FIELD} type="password" value={a} onInput={(e) => setA(e.currentTarget.value)} autocomplete="new-password" required /></Lbl>
        <Lbl label="Repetir contraseña"><input class={FIELD} type="password" value={b} onInput={(e) => setB(e.currentTarget.value)} autocomplete="new-password" required /></Lbl>
        <button class={`${BTN_PRIMARY} w-full`} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
        {forced && <button type="button" onClick={signOut} class="w-full text-center text-sm text-slate-500 hover:underline">Salir</button>}
      </form>
    </AuthLayout>
  )
}
