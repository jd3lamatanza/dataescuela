import { useEffect, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ROLE_LABELS, type Role } from '../modules'
import { Icon } from './Icon'
import { go } from '../lib/router'
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, Modal, toast } from './kit'

interface Notif { id: number; type: string; title: string; body: string | null; url: string | null; read_at: string | null; created_at: string }
interface Msg { id: number; from_name: string; subject: string; body: string; read_at: string | null; created_at: string }

const btn = 'relative flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
const panel = 'fixed inset-x-2 top-14 z-50 mt-1 flex max-h-[75dvh] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl sm:inset-x-auto sm:right-3 sm:w-96'
const fecha = (s: string) => new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })

/** Botones de notificaciones y mensajes con paneles desplegables. */
export function Bandeja() {
  const { user } = useAuth()
  const [open, setOpen] = useState<'notif' | 'msg' | null>(null)
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [compose, setCompose] = useState(false)
  const [correoNoLeido, setCorreoNoLeido] = useState(0)
  const correoNuevo = user?.role === 'distrital' || user?.role === 'areal' || user?.role === 'escolar'

  const loadNotificaciones = async () => {
    const { data, error } = await supabase.from('notifications').select('*').order('id', { ascending: false }).limit(30)
    if (error) { console.error('Error al consultar notificaciones:', error.message); return }
    setNotifs((data as Notif[]) ?? [])
  }
  useEffect(() => {
    let vivo = true
    let secuencia = 0
    const cargarCorreo = async (periodico = false) => {
      const actual = ++secuencia
      const { data, error } = await (correoNuevo ? supabase.rpc('correo_contar_no_leidos') : supabase.rpc('mensajes_bandeja'))
      if (!vivo || actual !== secuencia) return
      if (error) { console.error('Error al consultar mensajes:', error.message); return }
      if (correoNuevo) {
        setCorreoNoLeido(Number(data))
        if (periodico) dispatchEvent(new Event('correo-refrescar'))
      } else setMsgs((data as Msg[]) ?? [])
    }
    const cambio = () => { void cargarCorreo() }
    setCorreoNoLeido(0); setMsgs([])
    void cargarCorreo()
    addEventListener('correo-changed', cambio)
    const intervalo = setInterval(() => { void cargarCorreo(true) }, 5 * 60 * 1000)
    return () => { vivo = false; removeEventListener('correo-changed', cambio); clearInterval(intervalo) }
  }, [user?.id, user?.role, correoNuevo])
  useEffect(() => {
    const cambio = () => { void loadNotificaciones() }
    cambio()
    addEventListener('notifs-changed', cambio)
    const intervalo = setInterval(cambio, 60000)
    return () => { removeEventListener('notifs-changed', cambio); clearInterval(intervalo) }
  }, [user?.id])

  const nUnread = notifs.filter((n) => !n.read_at).length
  const mUnread = correoNuevo ? correoNoLeido : msgs.filter((m) => !m.read_at).length
  const markNotifs = async () => { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); void loadNotificaciones() }
  const readMsg = async (m: Msg) => {
    if (!m.read_at) { await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('id', m.id); dispatchEvent(new Event('correo-changed')) }
    toast.info(`${m.subject}: ${m.body}`)
  }
  const abrir = async (n: Notif) => {
    if (!n.url) return
    await supabase.from('notifications').delete().eq('id', n.id)
    setOpen(null); void loadNotificaciones(); go(n.url)
  }
  const badge = (n: number) => n > 0 && <span class="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-blue-600 px-1 text-center text-[11px] font-semibold leading-5 text-white ring-2 ring-slate-50">{n}</span>
  const toggle = (k: 'notif' | 'msg') => setOpen(open === k ? null : k)

  return (
    <>
      <button type="button" class={btn} aria-label="Notificaciones" onClick={() => toggle('notif')}><Icon name="bell" class="size-5" />{badge(nUnread)}</button>
      <button type="button" class={btn} aria-label={mUnread ? `Mensajes, ${mUnread} sin leer` : 'Mensajes'} onClick={() => correoNuevo ? (setOpen(null), go('/mensajes')) : toggle('msg')}><Icon name="mail" class="size-5" />{badge(mUnread)}</button>
      {open && <div class="fixed inset-0 z-40" onClick={() => setOpen(null)} />}
      {open === 'notif' && (
        <div class={panel}>
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 class="text-sm font-semibold">Notificaciones</h2>{nUnread > 0 && <button class="text-xs text-sky-700 hover:underline" onClick={markNotifs}>Marcar todas como leídas</button>}</div>
          <ul class="divide-y divide-slate-100 overflow-y-auto">
            {notifs.length === 0 && <li class="px-4 py-8 text-center text-sm text-slate-500">Sin notificaciones</li>}
            {notifs.map((n) => (
              <li key={n.id} class={n.read_at ? '' : 'bg-sky-50/60'}>
                {(() => {
                  const inner = (<><p class="text-sm font-medium text-slate-900">{n.title}</p>{n.body && <p class="text-sm text-slate-600">{n.body}</p>}<p class="mt-0.5 text-xs text-slate-400">{fecha(n.created_at)}</p></>)
                  return n.url ? <button type="button" class="block min-h-11 w-full px-4 py-3 text-left hover:bg-slate-50" onClick={() => abrir(n)}>{inner}</button> : <div class="px-4 py-3">{inner}</div>
                })()}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open === 'msg' && (
        <div class={panel}>
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3"><h2 class="text-sm font-semibold">Mensajes</h2><button class="text-xs text-sky-700 hover:underline" onClick={() => { setOpen(null); setCompose(true) }}>Nuevo mensaje</button></div>
          <ul class="divide-y divide-slate-100 overflow-y-auto">
            {msgs.length === 0 && <li class="px-4 py-8 text-center text-sm text-slate-500">Sin mensajes</li>}
            {msgs.map((m) => (
              <li key={m.id}><button class={`block w-full px-4 py-3 text-left ${m.read_at ? '' : 'bg-sky-50/60'}`} onClick={() => readMsg(m)}>
                <p class="text-sm font-medium text-slate-900">{m.subject}</p>
                <p class="truncate text-sm text-slate-600">{m.from_name}: {m.body}</p>
                <p class="mt-0.5 text-xs text-slate-400">{fecha(m.created_at)}</p>
              </button></li>
            ))}
          </ul>
        </div>
      )}
      {compose && <Redactar onClose={() => setCompose(false)} />}
    </>
  )
}

function Redactar({ onClose }: { onClose(): void }) {
  const { user } = useAuth()
  const [dest, setDest] = useState<{ id: string; name: string; role: Role }[]>([])
  const [f, setF] = useState({ to: '', subject: '', body: '' })
  useEffect(() => { supabase.rpc('destinatarios').then((r) => setDest((r.data as typeof dest) ?? [])) }, [])
  const send = async (e: Event) => {
    e.preventDefault()
    const { error } = await supabase.from('messages').insert({ from_user_id: user!.id, to_user_id: f.to, subject: f.subject.trim(), body: f.body.trim() })
    if (error) toast.error(error.message)
    else { toast.ok('Mensaje enviado'); onClose() }
  }
  return (
    <Modal title="Nuevo mensaje" onClose={onClose}>
      <form onSubmit={send} class="space-y-4">
        <select class={FIELD} required value={f.to} onChange={(e) => setF({ ...f, to: e.currentTarget.value })} aria-label="Destinatario">
          <option value="">Destinatario…</option>
          {dest.map((d) => <option value={d.id}>{d.name} · {ROLE_LABELS[d.role]}</option>)}
        </select>
        <input class={FIELD} placeholder="Asunto" required maxLength={150} value={f.subject} onInput={(e) => setF({ ...f, subject: e.currentTarget.value })} />
        <textarea class={`${FIELD} py-2`} rows={5} placeholder="Mensaje" required maxLength={4000} value={f.body} onInput={(e) => setF({ ...f, body: e.currentTarget.value })} />
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Enviar</button></div>
      </form>
    </Modal>
  )
}
