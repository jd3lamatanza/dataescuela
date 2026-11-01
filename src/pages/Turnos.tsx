import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, RowMenu, Spinner, toast } from '../ui/kit'

interface Turno { id: number; nombre: string; sigla: string; hora_desde: string | null; hora_hasta: string | null; activo: boolean }
const SIGLA = /^[A-Z0-9]{2}$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

export function Turnos() {
  const [edit, setEdit] = useState<Partial<Turno> | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const r = await supabase.from('turnos').select('*').order('nombre')
    if (r.error) throw r.error
    return r.data as Turno[]
  })

  const toggle = async (t: Turno) => {
    const { error } = await supabase.from('turnos').update({ activo: !t.activo, updated_at: new Date().toISOString() }).eq('id', t.id)
    if (error) return toast.error(error.message)
    toast.ok(t.activo ? 'Turno desactivado' : 'Turno activado'); reload()
  }

  return (
    <>
      <PageHeader title="Turnos" subtitle="Turnos disponibles para configurar la planta de las escuelas"
        actions={<button class={BTN_PRIMARY} onClick={() => setEdit({ activo: true })}>Nuevo turno</button>} />
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        {loading && !data ? <Spinner /> : !data?.length ? <EmptyState title="Sin turnos" text="Creá el primero." /> : (
          <ul class="-my-4 divide-y divide-slate-100">
            {data.map((t) => (
              <li key={t.id} class="flex items-center justify-between gap-3 py-3">
                <div><p class="font-medium text-slate-900">{t.nombre} <span class="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">{t.sigla}</span></p><p class="text-xs text-slate-500">{t.hora_desde && t.hora_hasta ? `${t.hora_desde} a ${t.hora_hasta}` : 'Sin horario'}</p></div>
                <div class="flex items-center gap-2">
                  <Badge tone={t.activo ? 'green' : 'slate'}>{t.activo ? 'Activo' : 'Inactivo'}</Badge>
                  <RowMenu items={[{ label: 'Editar', onClick: () => setEdit(t) }, { label: t.activo ? 'Desactivar' : 'Activar', onClick: () => toggle(t) }]} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <Form t={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload() }} />}
    </>
  )
}

function Form({ t, onClose, onDone }: { t: Partial<Turno>; onClose(): void; onDone(): void }) {
  const [nombre, setNombre] = useState(t.nombre ?? '')
  const [sigla, setSigla] = useState(t.sigla ?? '')
  const [desde, setDesde] = useState(t.hora_desde ?? '')
  const [hasta, setHasta] = useState(t.hora_hasta ?? '')
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: Event) => {
    e.preventDefault()
    const n = nombre.trim()
    if (n.length < 2) return setErr('Completá el nombre del turno')
    if (!SIGLA.test(sigla)) return setErr('La sigla debe tener exactamente 2 caracteres (letras o números)')
    if ((desde && !HORA.test(desde)) || (hasta && !HORA.test(hasta))) return setErr('Horario no válido')
    if (desde && hasta && desde >= hasta) return setErr('La hora de inicio debe ser anterior a la de fin')
    const row = { nombre: n, sigla, hora_desde: desde || null, hora_hasta: hasta || null, updated_at: new Date().toISOString() }
    const r = t.id ? await supabase.from('turnos').update(row).eq('id', t.id) : await supabase.from('turnos').insert(row)
    if (r.error) return setErr(r.error.code === '23505' ? 'Ya existe un turno con ese nombre o sigla' : r.error.message)
    toast.ok(t.id ? 'Turno actualizado' : 'Turno creado'); onDone()
  }

  return (
    <Modal title={t.id ? 'Editar turno' : 'Nuevo turno'} onClose={onClose}>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Nombre"><input class={FIELD} value={nombre} maxLength={60} required onInput={(e) => setNombre(e.currentTarget.value)} /></Lbl>
        <Lbl label="Sigla (2 caracteres)"><input class={FIELD + ' w-24 text-center font-mono uppercase'} value={sigla} maxLength={2} minLength={2} required inputMode="text" autoCapitalize="characters" onInput={(e) => setSigla(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></Lbl>
        <div class="grid grid-cols-2 gap-3">
          <Lbl label="Desde"><input class={FIELD} type="time" value={desde} onInput={(e) => setDesde(e.currentTarget.value)} /></Lbl>
          <Lbl label="Hasta"><input class={FIELD} type="time" value={hasta} onInput={(e) => setHasta(e.currentTarget.value)} /></Lbl>
        </div>
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Guardar</button></div>
      </form>
    </Modal>
  )
}
