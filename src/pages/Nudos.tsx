import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Icon } from '../ui/Icon'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Spinner, TabBar, confirmar, toast, type TabItem } from '../ui/kit'

interface Nudo { id: number; nombre: string; activo: boolean }
interface Escuela { id: number; nudo_id: number; clave: string | null; tipo: string | null; numero: number | null; nombre: string | null; localidad: string | null }

const TABS: TabItem[] = [
  { id: 'escuelas', label: 'Escuelas por nudo', icon: 'building', color: 'sky' },
  { id: 'gestion', label: 'Administrar nudos', icon: 'settings', color: 'indigo' },
]

async function cargar() {
  const nudos: Nudo[] = [], escuelas: Escuela[] = []
  for (let offset = 0; ; offset += 500) {
    const r = await supabase.from('nudos').select('id,nombre,activo').order('id').range(offset, offset + 499)
    if (r.error) throw r.error
    nudos.push(...r.data)
    if (r.data.length < 500) break
  }
  for (let offset = 0; ; offset += 500) {
    const r = await supabase.from('escuelas').select('id,nudo_id,clave,tipo,numero,nombre,localidad').not('nudo_id', 'is', null).order('id').range(offset, offset + 499)
    if (r.error) throw r.error
    escuelas.push(...r.data)
    if (r.data.length < 500) break
  }
  nudos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR'))
  escuelas.sort((a, b) => (a.clave ?? '').localeCompare(b.clave ?? '', 'es-AR') || a.id - b.id)
  return { nudos, escuelas }
}

export function Nudos() {
  const [tab, setTab] = useState('escuelas')
  const [editando, setEditando] = useState<Nudo | 'nuevo' | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const { data, error, loading, reload } = useAsync(cargar, [])
  const eliminar = async (nudo: Nudo) => {
    if (!(await confirmar('Eliminar nudo', { text: `¿Eliminar el nudo "${nudo.nombre}"?`, ok: 'Eliminar', danger: true }))) return
    setEliminando(true)
    const r = await supabase.rpc('nudo_eliminar', { p_id: nudo.id })
    setEliminando(false)
    if (r.error) { toast.error(r.error.message); reload(); return }
    toast.ok('Nudo eliminado'); reload()
  }
  return <>
    <PageHeader title="Nudos" subtitle="Agrupamientos territoriales de escuelas" />
    <TabBar label="Nudos" items={TABS} active={tab} onChange={setTab} />
    {error && <div class="mb-3"><Alert tone="error">{error}</Alert></div>}
    {loading && !data ? <Spinner /> : data && <>
      {tab === 'escuelas' && (data.nudos.length ? <div class="space-y-3">
        {data.nudos.map((nudo) => {
          const escuelas = data.escuelas.filter((e) => e.nudo_id === nudo.id)
          return <Card key={nudo.id}>
            <div class="mb-3 flex flex-wrap items-center gap-2"><h2 class="font-semibold text-slate-900">{nudo.nombre}</h2><Badge tone="blue">{escuelas.length} {escuelas.length === 1 ? 'escuela' : 'escuelas'}</Badge>{!nudo.activo && <Badge>Inactivo</Badge>}</div>
            {escuelas.length ? <ul class="divide-y divide-slate-100">{escuelas.map((e) => <li key={e.id} class="flex items-start gap-2 py-2 text-sm">
              <Icon name="building" class="mt-0.5 size-4 shrink-0 text-sky-600" />
              <div><p class="font-medium text-slate-800">{e.clave || [e.tipo, e.numero].filter(Boolean).join(' ') || `Escuela ${e.id}`}{e.nombre ? ` · ${e.nombre}` : ''}</p>{e.localidad && <p class="text-slate-500">{e.localidad}</p>}</div>
            </li>)}</ul> : <p class="text-sm text-slate-500">Sin escuelas asociadas.</p>}
          </Card>
        })}
      </div> : <EmptyState title="Todavía no hay nudos" text="Creá uno en Administrar nudos." />)}
      {tab === 'gestion' && <>
        <div class="mb-3 flex justify-end"><button class={BTN_PRIMARY} onClick={() => setEditando('nuevo')}><Icon name="plus" />Nuevo nudo</button></div>
        {!data.nudos.length ? <EmptyState title="Todavía no hay nudos" text="Creá el primero para que las escuelas puedan seleccionarlo." /> : <Card>
          <ul class="-my-4 divide-y divide-slate-100">{data.nudos.map((nudo) => {
            const cantidad = data.escuelas.filter((e) => e.nudo_id === nudo.id).length
            return <li key={nudo.id} class="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p class="font-medium text-slate-900">{nudo.nombre} {!nudo.activo && <Badge>Inactivo</Badge>}</p><p class="text-xs text-slate-500">{cantidad} {cantidad === 1 ? 'escuela asociada' : 'escuelas asociadas'}</p></div>
              <div class="flex gap-2">
                <button type="button" class={BTN_SECONDARY} aria-label={`Editar ${nudo.nombre}`} onClick={() => setEditando(nudo)}><Icon name="edit" /><span class="hidden sm:inline">Editar</span></button>
                <button type="button" class={BTN_SECONDARY} aria-label={`Eliminar ${nudo.nombre}`} title={cantidad ? 'No se puede eliminar: tiene escuelas asociadas' : 'Eliminar nudo'} disabled={!!cantidad || eliminando || loading} onClick={() => eliminar(nudo)}><Icon name="trash" /><span class="hidden sm:inline">Eliminar</span></button>
              </div>
            </li>
          })}</ul>
        </Card>}
      </>}
    </>}
    {editando && <NudoForm nudo={editando === 'nuevo' ? null : editando} onClose={() => setEditando(null)} onDone={() => { setEditando(null); reload() }} />}
  </>
}

function NudoForm({ nudo, onClose, onDone }: { nudo: Nudo | null; onClose(): void; onDone(): void }) {
  const [nombre, setNombre] = useState(nudo?.nombre ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const guardar = async (e: Event) => {
    e.preventDefault()
    const valor = nombre.trim()
    if (!valor || valor.length > 150) { setError('Ingresá un nombre de hasta 150 caracteres.'); return }
    setBusy(true); setError('')
    const r = await supabase.rpc('nudo_guardar', { p_id: nudo?.id ?? null, p_nombre: valor })
    setBusy(false)
    if (r.error) { setError(r.error.message); return }
    toast.ok(nudo ? 'Nudo actualizado' : 'Nudo creado'); onDone()
  }
  return <Modal title={nudo ? 'Editar nudo' : 'Nuevo nudo'} onClose={onClose}>
    <form class="space-y-4" onSubmit={guardar}>
      {error && <Alert tone="error">{error}</Alert>}
      <Lbl label="Nombre"><input class={FIELD} value={nombre} maxLength={150} required disabled={busy} onInput={(e) => setNombre(e.currentTarget.value)} /></Lbl>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={busy} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
  </Modal>
}
