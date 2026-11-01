import { useState } from 'preact/hooks'
import { supabase } from '../../lib/supabase'
import { useAsync } from '../../lib/hooks'
import { descargarPdf, descargarXlsx } from '../../lib/download'
import type { Table } from '../../lib/export'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, FIELD, Lbl, Modal, Spinner, toast } from '../../ui/kit'

export const ARTICULACION_CODIGOS = ['JI', 'JV', 'JU', 'PP', 'MS', 'MT']
export const OTRA = '__otra'
export const FIRST_CICLO = 2020
const DESTINOS: Record<string, string[]> = { JI: ['PP'], JV: ['PP'], JU: ['PP'], PP: ['MS', 'MT'] }
const ORIGENES: Record<string, string[]> = { PP: ['JI', 'JV', 'JU'], MS: ['PP'], MT: ['PP'] }
export const puedeEgresar = (cod: string) => !!DESTINOS[cod]
export const puedeIngresar = (cod: string) => !!ORIGENES[cod]

export const cicloActual = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric' }).format(new Date()))
export const ciclos = () => Array.from({ length: cicloActual() + 1 - FIRST_CICLO + 1 }, (_, i) => FIRST_CICLO + i)
export const ciclosIngreso = () => ciclos().filter((y) => y > FIRST_CICLO)

export interface Egresante {
  id: number; ciclo: number; dni: string; nombre: string; direccion: string | null; curso: string; ppi: boolean
  acompanante: boolean; intensifica: boolean; destino_clave: string | null; destino_nombre: string | null
  destino_manual: boolean; observaciones: string | null; origen_cue: string; origen_clave: string; origen_codigo: string
  doc_completa: boolean; ingresado: boolean; ext_escuela: string | null; ext_at: string | null; created_at: string
}

export const confirmada = (r: Pick<Egresante, 'ingresado' | 'ext_escuela'>) => r.ingresado || !!r.ext_escuela
export const estadoTxt = (r: Pick<Egresante, 'ingresado' | 'ext_escuela'>) =>
  r.ingresado ? 'Ingreso confirmado' : r.ext_escuela ? 'Inscripto fuera del distrito' : 'Pendiente'
export const destinoTxt = (r: Pick<Egresante, 'destino_nombre' | 'destino_clave' | 'ext_escuela'>) =>
  r.ext_escuela ? `${r.ext_escuela} (fuera del distrito)` : r.destino_nombre ? `${r.destino_nombre}${r.destino_clave ? ` (${r.destino_clave})` : ''}` : ''
export const fmtFecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '')
export const fmtFechaHora = (s: string) => new Date(s).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' })

export const EstadoBadge = ({ r }: { r: Pick<Egresante, 'ingresado' | 'ext_escuela'> }) =>
  r.ingresado ? <Badge tone="green">Ingreso confirmado</Badge> : r.ext_escuela ? <Badge tone="blue">Fuera del distrito</Badge> : <Badge tone="amber">Pendiente</Badge>

/** Búsqueda segura para PostgREST .or() */
export const limpiarBusqueda = (s: string) => s.trim().slice(0, 80).replace(/[,()%*\\]/g, ' ').trim()

export function Exportar({ build, name }: { build: () => Promise<Table>; name: string }) {
  const [busy, setBusy] = useState(false)
  const run = (fmt: 'xlsx' | 'pdf') => async () => {
    setBusy(true)
    try {
      const t = await build()
      if (fmt === 'xlsx') descargarXlsx(t, name)
      else await descargarPdf(t, name)
    } catch (e: any) { toast.error(e.message ?? 'No se pudo exportar') } finally { setBusy(false) }
  }
  return (
    <div class="flex gap-2">
      <button class={BTN_SECONDARY} disabled={busy} onClick={run('xlsx')}>Excel</button>
      <button class={BTN_SECONDARY} disabled={busy} onClick={run('pdf')}>PDF</button>
    </div>
  )
}

export const Tabs = ({ items, active, onChange }: { items: { id: string; label: string; disabled?: boolean; why?: string; badge?: number }[]; active: string; onChange(id: string): void }) => (
  <nav class="mb-4 flex overflow-x-auto border-b border-slate-200 text-sm" aria-label="Secciones">
    {items.map((t) => (
      <button key={t.id} disabled={t.disabled} title={t.disabled ? t.why : undefined} onClick={() => onChange(t.id)} aria-current={active === t.id ? 'page' : undefined}
        class={`flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 disabled:cursor-not-allowed disabled:text-slate-400 ${active === t.id ? 'border-cyan-500 font-semibold text-slate-900' : 'border-transparent text-slate-600 hover:border-slate-300'}`}>
        {t.label}{!!t.badge && <span class="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-800">{t.badge}</span>}
      </button>
    ))}
  </nav>
)

export function DestinoFields({ codigo, destino, nombre, onDestino, onNombre }: { codigo: string; destino: string; nombre: string; onDestino(v: string): void; onNombre(v: string): void }) {
  const { data, loading } = useAsync(async () => {
    const r = await supabase.rpc('destinos_posibles', { p_codigo: codigo })
    if (r.error) throw r.error
    return r.data as { clave: string; nombre: string }[]
  }, [codigo])
  return (
    <>
      <Lbl label="Escuela destino">
        {loading ? <Spinner /> : (
          <select class={FIELD} value={destino} onChange={(e) => onDestino(e.currentTarget.value)}>
            <option value="">Sin completar</option>
            {(data ?? []).map((d) => <option key={d.clave} value={d.clave}>{d.clave} · {d.nombre}</option>)}
            <option value={OTRA}>Otra escuela (carga manual)</option>
          </select>
        )}
      </Lbl>
      {destino === OTRA && <Lbl label="Nombre de la escuela"><input class={FIELD} maxLength={150} value={nombre} onInput={(e) => onNombre(e.currentTarget.value)} /></Lbl>}
    </>
  )
}

interface Intervencion { id: number; texto: string; tipo: string; created_by_name: string | null; created_at: string }

export function NuevaIntervencion({ r, onClose, onDone }: { r: Pick<Egresante, 'id' | 'nombre' | 'dni'>; onClose(): void; onDone(): void }) {
  const [txt, setTxt] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('intervencion_crear', { p_egresante: r.id, p_texto: txt })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.ok('Intervención registrada'); onDone(); onClose()
  }
  return (
    <Modal title="Agregar intervención" onClose={onClose}>
      <p class="mb-3 text-sm text-slate-600">{r.nombre} · DNI {r.dni}</p>
      <Lbl label="Detalle"><textarea class={FIELD + ' py-2'} rows={5} maxLength={2000} value={txt} onInput={(e) => setTxt(e.currentTarget.value)} /></Lbl>
      <div class="mt-4 flex justify-end gap-2"><button class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy || !txt.trim()} onClick={save}>Guardar</button></div>
    </Modal>
  )
}

export function VerIntervenciones({ r, onClose }: { r: Pick<Egresante, 'id' | 'nombre' | 'dni'>; onClose(): void }) {
  const { data, loading, error } = useAsync(async () => {
    const x = await supabase.from('intervenciones').select('id,texto,tipo,created_by_name,created_at').eq('egresante_id', r.id).order('created_at')
    if (x.error) throw x.error
    return x.data as Intervencion[]
  }, [r.id])
  const tabla = async (): Promise<Table> => ({
    title: 'Intervenciones', subtitle: `${r.nombre} · DNI ${r.dni}`, headers: ['Fecha', 'Autor', 'Detalle'], widths: [14, 20, 60],
    rows: (data ?? []).map((i) => [fmtFechaHora(i.created_at), i.created_by_name ?? '', i.texto]),
  })
  return (
    <Modal title="Intervenciones" onClose={onClose} wide>
      <p class="mb-3 text-sm text-slate-600">{r.nombre} · DNI {r.dni}</p>
      {loading ? <Spinner /> : error ? <Alert tone="error">{error}</Alert> : !data?.length ? <p class="text-sm text-slate-500">Sin intervenciones registradas.</p> : (
        <ul class="space-y-2">{data.map((i) => (
          <li key={i.id} class="rounded-md border border-slate-200 p-3 text-sm"><p class="text-xs text-slate-500">{fmtFechaHora(i.created_at)} · {i.created_by_name ?? ''}</p><p class="mt-1 whitespace-pre-wrap">{i.texto}</p></li>
        ))}</ul>
      )}
      {!!data?.length && <div class="mt-4"><Exportar build={tabla} name={`intervenciones-${r.dni}`} /></div>}
    </Modal>
  )
}

export function ExternaModal({ r, onClose, onDone }: { r: Pick<Egresante, 'id' | 'nombre' | 'dni'>; onClose(): void; onDone(): void }) {
  const [esc, setEsc] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('inscripcion_externa', { p_id: r.id, p_escuela: esc })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.ok('Inscripción registrada'); onDone(); onClose()
  }
  return (
    <Modal title="Inscripto fuera del distrito" onClose={onClose}>
      <p class="mb-3 text-sm text-slate-600">{r.nombre} · DNI {r.dni}</p>
      <Lbl label="Escuela donde se inscribió"><input class={FIELD} maxLength={150} value={esc} onInput={(e) => setEsc(e.currentTarget.value)} /></Lbl>
      <div class="mt-4 flex justify-end gap-2"><button class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy || !esc.trim()} onClick={save}>Confirmar</button></div>
    </Modal>
  )
}
