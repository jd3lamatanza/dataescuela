import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, RowMenu, Spinner, confirmar, toast } from '../ui/kit'

interface Insp {
  id: number; user_id: string | null; nombre: string | null; cuil: string; modalidad_id: number | null; nivel_o_modalidad: string | null
  situacion_revista: string | null; cargo_base: string | null; fecha_toma_posesion: string | null; telefono: string | null; email: string | null
  escuelas_asignadas: string[]; activo: boolean
}
interface Modalidad { id: number; nombre: string }

export function Inspectores() {
  const [q, setQ] = useState('')
  const [mod, setMod] = useState('')
  const [estado, setEstado] = useState('')
  const [edit, setEdit] = useState<Partial<Insp> | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const [i, m] = await Promise.all([
      supabase.from('inspectores').select('*').order('nombre'),
      supabase.from('modalidades_inspeccion').select('id, nombre').eq('activo', true).order('orden'),
    ])
    if (i.error) throw i.error
    if (m.error) throw m.error
    return { insp: i.data as Insp[], mods: m.data as Modalidad[] }
  })

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    const { error } = await p
    if (error) toast.error(error.message)
    else { toast.ok(ok); reload() }
  }
  const activo = async (i: Insp) => {
    if (i.activo && !(await confirmar('Desactivar inspector', { text: `${i.nombre ?? i.cuil} no podrá ingresar a la aplicación.`, ok: 'Desactivar', danger: true }))) return
    run(supabase.rpc('inspector_activo', { p_id: i.id, p_activo: !i.activo }), i.activo ? 'Inspector desactivado' : 'Inspector activado')
  }
  const menu = (i: Insp) => [
    { label: 'Editar', onClick: () => setEdit(i) },
    { label: 'Crear usuario', onClick: () => run(supabase.rpc('inspector_crear_usuario', { p_id: i.id }), 'Usuario creado (clave inicial 12345678)'), hidden: !!i.user_id },
    { label: i.activo ? 'Desactivar' : 'Activar', onClick: () => activo(i), danger: i.activo },
  ]

  const t = q.trim().toLowerCase()
  const rows = (data?.insp ?? []).filter((i) =>
    (!t || `${i.nombre ?? ''} ${i.cuil}`.toLowerCase().includes(t)) &&
    (!mod || String(i.modalidad_id) === mod) &&
    (!estado || (estado === 'act') === i.activo))
  const nombreMod = (i: Insp) => data?.mods.find((m) => m.id === i.modalidad_id)?.nombre ?? i.nivel_o_modalidad ?? '—'
  const badges = (i: Insp) => (
    <span class="inline-flex flex-wrap gap-1">
      <Badge tone={i.activo ? 'green' : 'red'}>{i.activo ? 'Activo' : 'Inactivo'}</Badge>
      {!i.user_id && <Badge tone="amber">Sin usuario</Badge>}
    </span>
  )

  return (
    <>
      <PageHeader title="Inspectores" subtitle="Alta, edición y activación de inspectores. Cada alta crea su usuario areal."
        actions={<button class={BTN_PRIMARY} onClick={() => setEdit({ activo: true })}>Nuevo inspector</button>} />
      <div class="grid gap-2 sm:grid-cols-3">
        <input type="search" class={FIELD} placeholder="Nombre o CUIL" value={q} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Buscar" />
        <select class={FIELD} value={mod} onChange={(e) => setMod(e.currentTarget.value)} aria-label="Modalidad">
          <option value="">Todas las modalidades</option>
          {data?.mods.map((m) => <option value={m.id}>{m.nombre}</option>)}
        </select>
        <select class={FIELD} value={estado} onChange={(e) => setEstado(e.currentTarget.value)} aria-label="Estado">
          <option value="">Estado: todos</option><option value="act">Activos</option><option value="ina">Inactivos</option>
        </select>
      </div>
      <Card class="mt-3">
        {error && <Alert tone="error">{error}</Alert>}
        {loading && !data ? <Spinner /> : rows.length === 0 ? <EmptyState title="Sin inspectores" text="Probá con otros filtros o creá uno nuevo." /> : (
          <>
            <div class="-m-4 hidden overflow-x-auto md:block">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-3 py-2">Nombre</th><th class="px-3 py-2">CUIL</th><th class="px-3 py-2">Modalidad</th><th class="px-3 py-2">Escuelas</th><th class="px-3 py-2">Estado</th><th class="w-12 px-3 py-2" /></tr></thead>
                <tbody class="divide-y divide-slate-100">
                  {rows.map((i) => (
                    <tr key={i.id} class="hover:bg-slate-50">
                      <td class="px-3 py-2.5 font-medium text-slate-900">{i.nombre ?? '—'}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{i.cuil}</td>
                      <td class="px-3 py-2.5 text-xs">{nombreMod(i)}</td>
                      <td class="px-3 py-2.5 text-xs">{i.escuelas_asignadas.length}</td>
                      <td class="px-3 py-2.5">{badges(i)}</td>
                      <td class="px-3 py-2.5"><RowMenu items={menu(i)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul class="-my-4 divide-y divide-slate-200 md:hidden">
              {rows.map((i) => (
                <li key={i.id} class="space-y-1.5 py-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0"><p class="font-semibold">{i.nombre ?? '—'}</p><p class="text-xs text-slate-500"><span class="font-mono">{i.cuil}</span> · {nombreMod(i)} · {i.escuelas_asignadas.length} escuelas</p></div>
                    <RowMenu items={menu(i)} />
                  </div>
                  {badges(i)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {edit && data && <Form i={edit} mods={data.mods} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload() }} />}
    </>
  )
}

function Form({ i, mods, onClose, onDone }: { i: Partial<Insp>; mods: Modalidad[]; onClose(): void; onDone(): void }) {
  const [f, setF] = useState({
    nombre: i.nombre ?? '', cuil: i.cuil ?? '', modalidad: i.modalidad_id ? String(i.modalidad_id) : '', situacion: i.situacion_revista ?? '',
    cargo: i.cargo_base ?? '', toma: i.fecha_toma_posesion ?? '', telefono: i.telefono ?? '', email: i.email ?? '',
  })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value })

  const submit = async (e: Event) => {
    e.preventDefault()
    if (!f.modalidad) return setErr('Elegí la modalidad')
    const args = { p_nombre: f.nombre, p_cuil: f.cuil, p_modalidad: Number(f.modalidad), p_situacion: f.situacion, p_cargo: f.cargo, p_toma: f.toma, p_telefono: f.telefono, p_email: f.email }
    const { error } = i.id ? await supabase.rpc('inspector_editar', { p_id: i.id, ...args }) : await supabase.rpc('inspector_crear', args)
    if (error) return setErr(error.message)
    toast.ok(i.id ? 'Inspector actualizado' : 'Inspector creado (usuario: su CUIL, clave inicial 12345678)'); onDone()
  }

  return (
    <Modal title={i.id ? 'Editar inspector' : 'Nuevo inspector'} onClose={onClose} wide>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <div class="grid gap-3 sm:grid-cols-2">
          <Lbl label="Apellido y nombre"><input class={FIELD} value={f.nombre} onInput={set('nombre')} required maxLength={200} /></Lbl>
          <Lbl label="CUIL (usuario de acceso)"><input class={FIELD + ' font-mono'} value={f.cuil} onInput={(e) => setF({ ...f, cuil: e.currentTarget.value.replace(/\D/g, '') })} required maxLength={11} minLength={11} inputMode="numeric" /></Lbl>
          <Lbl label="Modalidad">
            <select class={FIELD} value={f.modalidad} onChange={(e) => setF({ ...f, modalidad: e.currentTarget.value })} required>
              <option value="">Elegir…</option>
              {mods.map((m) => <option value={m.id}>{m.nombre}</option>)}
            </select>
          </Lbl>
          <Lbl label="Correo (recuperación de clave)"><input class={FIELD} type="email" value={f.email} onInput={set('email')} maxLength={254} autocomplete="email" /></Lbl>
          <Lbl label="Teléfono"><input class={FIELD} type="tel" value={f.telefono} onInput={set('telefono')} maxLength={40} /></Lbl>
          <Lbl label="Situación de revista"><input class={FIELD} value={f.situacion} onInput={set('situacion')} maxLength={80} /></Lbl>
          <Lbl label="Cargo base"><input class={FIELD} value={f.cargo} onInput={set('cargo')} maxLength={120} /></Lbl>
          <Lbl label="Toma de posesión (dd/mm/aaaa)"><input class={FIELD} value={f.toma} onInput={set('toma')} maxLength={10} placeholder="dd/mm/aaaa" /></Lbl>
        </div>
        {!i.id && <p class="text-xs text-slate-500">Se crea el usuario con rol Areal: usuario = CUIL y clave inicial 12345678, que deberá cambiar al ingresar.</p>}
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Guardar</button></div>
      </form>
    </Modal>
  )
}
