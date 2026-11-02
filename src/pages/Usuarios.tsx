import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync, useDebounced } from '../lib/hooks'
import { ROLE_LABELS, ROLES, type Role } from '../modules'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PAGE_SIZE, PageHeader, Pager, RowMenu, Spinner, confirmar, toast } from '../ui/kit'

interface Row { id: string; login: string; name: string; role: Role; active: boolean; must_change: boolean; email: string | null; total: number }

/** Un único módulo para admin (todos los roles + alta) y distrital (solo areal/escolar). */
export function Usuarios() {
  const { user } = useAuth()
  const admin = user?.role === 'admin'
  const roles = admin ? ROLES : (['areal', 'escolar'] as const)
  const [q, setQ] = useState('')
  const [rol, setRol] = useState('')
  const [estado, setEstado] = useState('')
  const [page, setPage] = useState(1)
  const [edit, setEdit] = useState<Row | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const dq = useDebounced(q)

  const { data, loading, error, reload } = useAsync(async () => {
    const { data, error } = await supabase.rpc('usuarios_listar', { q: dq, rol, estado, lim: PAGE_SIZE, off: (page - 1) * PAGE_SIZE })
    if (error) throw error
    return data as Row[]
  }, [dq, rol, estado, page])

  const rows = data ?? []
  const total = rows[0]?.total ?? 0
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    const { error } = await fn()
    if (error) toast.error(error.message)
    else { toast.ok(ok); reload() }
  }
  const reset = async (u: Row) => {
    if (await confirmar('Restablecer contraseña', { text: `La contraseña de ${u.name} vuelve a 12345678 y deberá cambiarla al ingresar.`, ok: 'Restablecer' }))
      act(() => supabase.rpc('usuario_reset', { p_id: u.id }), 'Contraseña restablecida')
  }
  const activo = async (u: Row) => {
    if (u.active && !(await confirmar('Bloquear usuario', { text: `${u.name} no podrá ingresar.`, ok: 'Bloquear', danger: true }))) return
    act(() => supabase.rpc('usuario_activo', { p_id: u.id, p_activo: !u.active }), u.active ? 'Usuario bloqueado' : 'Usuario desbloqueado')
  }
  const menu = (u: Row) => [
    { label: 'Editar', onClick: () => setEdit(u) },
    { label: 'Restablecer contraseña', onClick: () => reset(u) },
    { label: u.active ? 'Bloquear' : 'Desbloquear', onClick: () => activo(u), danger: u.active, hidden: u.id === user?.id },
  ]
  const estadoBadges = (u: Row) => (
    <span class="inline-flex flex-wrap gap-1">
      <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Activo' : 'Bloqueado'}</Badge>
      {u.must_change && <Badge tone="amber">Clave pendiente</Badge>}
    </span>
  )
  const setF = (f: () => void) => { f(); setPage(1) }

  return (
    <>
      <PageHeader title="Usuarios" subtitle={admin ? 'Todas las cuentas de la aplicación' : 'Cuentas de inspectores y escuelas'}
        actions={admin && <button class={BTN_PRIMARY} onClick={() => setNuevo(true)}>Nuevo usuario</button>} />
      <div class="grid gap-2 sm:grid-cols-3">
        <input type="search" class={FIELD} placeholder="Nombre, CUE o CUIL" value={q} onInput={(e) => setF(() => setQ(e.currentTarget.value))} aria-label="Buscar" />
        <select class={FIELD} value={rol} onChange={(e) => setF(() => setRol(e.currentTarget.value))} aria-label="Rol">
          <option value="">Todos los roles</option>
          {roles.map((r) => <option value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <select class={FIELD} value={estado} onChange={(e) => setF(() => setEstado(e.currentTarget.value))} aria-label="Estado">
          <option value="">Estado: todos</option><option value="act">Activos</option><option value="blk">Bloqueados</option>
        </select>
      </div>
      <Card class="mt-3">
        {error && <Alert tone="error">{error}</Alert>}
        {loading && !data ? <Spinner /> : rows.length === 0 ? <EmptyState title="Sin resultados" text="Probá con otros filtros." /> : (
          <>
            <div class="-m-4 hidden overflow-x-auto md:block">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-3 py-2">Nombre</th><th class="px-3 py-2">Usuario</th><th class="px-3 py-2">Rol</th><th class="px-3 py-2">Estado</th><th class="w-12 px-3 py-2" /></tr></thead>
                <tbody class="divide-y divide-slate-100">
                  {rows.map((u) => (
                    <tr key={u.id} class="hover:bg-slate-50">
                      <td class="px-3 py-2.5 font-medium text-slate-900">{u.name}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{u.login}</td>
                      <td class="px-3 py-2.5 text-xs">{ROLE_LABELS[u.role]}</td>
                      <td class="px-3 py-2.5">{estadoBadges(u)}</td>
                      <td class="px-3 py-2.5"><RowMenu items={menu(u)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul class="-my-4 divide-y divide-slate-200 md:hidden">
              {rows.map((u) => (
                <li key={u.id} class="space-y-1.5 py-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0"><p class="font-semibold">{u.name}</p><p class="font-mono text-xs text-slate-500">{u.login} · {ROLE_LABELS[u.role]}</p></div>
                    <RowMenu items={menu(u)} />
                  </div>
                  {estadoBadges(u)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Pager page={page} total={Number(total)} onPage={setPage} />
      {edit && <EditarUsuario u={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload() }} />}
      {nuevo && <NuevoUsuario onClose={() => setNuevo(false)} onDone={() => { setNuevo(false); reload() }} />}
    </>
  )
}

function EditarUsuario({ u, onClose, onDone }: { u: Row; onClose(): void; onDone(): void }) {
  const [name, setName] = useState(u.name)
  const [login, setLogin] = useState(u.login)
  const [email, setEmail] = useState(u.email ?? '')
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: Event) => {
    e.preventDefault()
    const { error } = await supabase.rpc('usuario_editar', { p_id: u.id, p_name: name, p_login: login, p_email: email })
    if (error) setErr(error.message)
    else { toast.ok('Usuario actualizado'); onDone() }
  }
  return (
    <Modal title="Editar usuario" onClose={onClose}>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Nombre"><input class={FIELD} value={name} onInput={(e) => setName(e.currentTarget.value)} required maxLength={200} /></Lbl>
        <Lbl label="Usuario (CUE, CUIL o correo)"><input class={FIELD} value={login} onInput={(e) => setLogin(e.currentTarget.value)} required maxLength={120} /></Lbl>
        <Lbl label="Correo de recuperación"><input class={FIELD} type="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} maxLength={254} autocomplete="email" /></Lbl>
        <p class="text-xs text-slate-500">Para escuelas e inspectores se prioriza el correo de su ficha; este correo sirve como alternativa y es el principal para los demás roles.</p>
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Guardar</button></div>
      </form>
    </Modal>
  )
}

function NuevoUsuario({ onClose, onDone }: { onClose(): void; onDone(): void }) {
  const [f, setF] = useState({ name: '', login: '', role: 'escolar', pass: '', email: '' })
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: Event) => {
    e.preventDefault()
    const { error } = await supabase.rpc('usuario_crear', { p_name: f.name, p_login: f.login, p_role: f.role, p_pass: f.pass, p_email: f.email || null })
    if (error) setErr(error.message)
    else { toast.ok('Usuario creado'); onDone() }
  }
  const set = (k: string) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value })
  return (
    <Modal title="Nuevo usuario" onClose={onClose}>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Nombre"><input class={FIELD} value={f.name} onInput={set('name')} required /></Lbl>
        <Lbl label="Usuario (CUE, CUIL o correo)"><input class={FIELD} value={f.login} onInput={set('login')} required /></Lbl>
        <Lbl label="Rol"><select class={FIELD} value={f.role} onChange={set('role')}>{ROLES.map((r) => <option value={r}>{ROLE_LABELS[r]}</option>)}</select></Lbl>
        <Lbl label="Correo de recuperación"><input class={FIELD} type="email" value={f.email} onInput={set('email')} maxLength={254} autocomplete="email" /></Lbl>
        <Lbl label="Contraseña inicial (mín. 8)"><input class={FIELD} type="password" minLength={8} value={f.pass} onInput={set('pass')} required autocomplete="new-password" /></Lbl>
        <p class="text-xs text-slate-500">El usuario deberá cambiarla en su primer ingreso.</p>
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Crear</button></div>
      </form>
    </Modal>
  )
}
