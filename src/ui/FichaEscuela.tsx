import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, FIELD, Lbl, Spinner, Toggle, toast } from './kit'

const SOLO_LECTURA: [string, string][] = [
  ['region', 'Región'], ['distrital', 'Distrital'], ['clave', 'Clave'], ['cue', 'CUE'], ['cue_sede', 'CUE sede'], ['sede', 'Sede'], ['codigo', 'Código'], ['tipo', 'Tipo'], ['numero', 'Número'],
  ['nivel', 'Nivel'], ['modalidad', 'Modalidad'], ['gestion', 'Gestión'], ['dep', 'Dependencia'], ['ambito', 'Ámbito'], ['desf', 'Desfavorabilidad'], ['cat', 'Categoría'],
]
const EMAIL = /^[^\s@]+@abc\.gob\.ar$/

export const nombreEscuela = (e: { tipo?: string | null; numero?: number | null; nombre?: string | null }) => [e.tipo, e.numero, e.nombre].filter(Boolean).join(' ')

/** Ficha de una escuela: datos del padrón (solo lectura) y datos editables. */
export function FichaEscuela({ id, onCancel }: { id: number; onCancel?: () => void }) {
  const { data, loading, error } = useAsync(async () => {
    const [e, loc, cir, nud] = await Promise.all([
      supabase.from('escuelas').select('*').eq('id', id).maybeSingle(),
      supabase.from('catalogos').select('nombre').eq('coleccion', 'localidad').eq('activo', true).order('orden'),
      supabase.from('circuitos_electorales').select('id,nombre,activo').order('nombre'),
      supabase.from('nudos').select('id,nombre,activo').order('nombre'),
    ])
    if (e.error) throw e.error
    if (!e.data) throw new Error('Escuela no encontrada')
    const locs = (loc.data ?? []).map((x) => x.nombre as string)
    if (e.data.localidad && !locs.includes(e.data.localidad)) locs.push(e.data.localidad)
    return { e: e.data as Record<string, any>, locs, cir: cir.data ?? [], nud: nud.data ?? [] }
  }, [id])

  if (loading && !data) return <Spinner />
  if (error || !data) return <Alert tone="error">{error ?? 'No se pudo cargar la ficha'}</Alert>
  return <Form key={id} {...data} id={id} onCancel={onCancel} />
}

function Form({ e, locs, cir, nud, id, onCancel }: { e: Record<string, any>; locs: string[]; cir: any[]; nud: any[]; id: number; onCancel?(): void }) {
  const [f, setF] = useState({
    nombre: e.nombre ?? '', localidad: e.localidad ?? '', calle: e.calle ?? '', nu_calle: e.nu_calle ?? '', cp: e.cp ?? '',
    entre_calle: e.entre_calle ?? '', entre_calle_2: e.entre_calle_2 ?? '', te: e.te ?? '', email: e.email ?? '',
    circuito_id: String(e.circuito_id ?? ''), nudo_id: String(e.nudo_id ?? ''),
    eav: e.eav === 'Sí', alfa: !!e.alfa, sede_electoral: !!e.sede_electoral, sede_evacuacion: !!e.sede_evacuacion,
  })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (ev: Event) => setF({ ...f, [k]: (ev.currentTarget as HTMLInputElement).value })
  const num = (v: unknown) => { const s = String(v ?? '').trim(); return s === '' ? null : /^\d{1,8}$/.test(s) ? Number(s) : NaN }

  const submit = async (ev: Event) => {
    ev.preventDefault()
    const nombre = String(f.nombre).trim(); const email = String(f.email).trim().toLowerCase()
    const nu = num(f.nu_calle); const cp = num(f.cp)
    if (nombre.length < 3) return setErr('Completá el nombre de la escuela')
    if (!EMAIL.test(email)) return setErr('El email es obligatorio y debe terminar en @abc.gob.ar')
    if (Number.isNaN(nu) || Number.isNaN(cp)) return setErr('Altura y código postal deben ser numéricos')
    setErr(null); setBusy(true)
    const orNull = (v: string) => String(v).trim() || null
    const { error } = await supabase.from('escuelas').update({
      nombre, localidad: orNull(f.localidad), calle: orNull(f.calle), nu_calle: nu, cp, entre_calle: orNull(f.entre_calle), entre_calle_2: orNull(f.entre_calle_2),
      te: orNull(f.te), email, eav: f.eav ? 'Sí' : 'No', alfa: f.alfa, sede_electoral: f.sede_electoral, sede_evacuacion: f.sede_evacuacion,
      circuito_id: f.circuito_id ? Number(f.circuito_id) : null, nudo_id: f.nudo_id ? Number(f.nudo_id) : null,
    }).eq('id', id)
    setBusy(false)
    if (error) return setErr(error.message)
    toast.ok('Ficha actualizada')
  }

  const activos = (rows: any[], cur: string) => rows.filter((r) => r.activo || String(r.id) === cur)
  return (
    <>
      <Card class="mt-4">
        <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Datos del padrón</h2>
        <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {SOLO_LECTURA.map(([k, l]) => <div key={k}><dt class="text-xs text-slate-500">{l}</dt><dd class="text-sm font-medium text-slate-900">{e[k] ?? '—'}</dd></div>)}
        </dl>
      </Card>
      <form onSubmit={submit} class="mt-3" autocomplete="off">
        <Card>
          <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Datos editables</h2>
          {err && <div class="mb-3"><Alert tone="error">{err}</Alert></div>}
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="sm:col-span-2"><Lbl label="Nombre"><input class={FIELD} required maxLength={200} value={f.nombre} onInput={set('nombre')} /></Lbl></div>
            <Lbl label="Localidad"><select class={FIELD} value={f.localidad} onChange={set('localidad')}><option value="">Seleccionar…</option>{locs.map((l) => <option key={l} value={l}>{l}</option>)}</select></Lbl>
            <Lbl label="Calle"><input class={FIELD} maxLength={120} value={f.calle} onInput={set('calle')} /></Lbl>
            <Lbl label="Altura"><input class={FIELD} inputMode="numeric" maxLength={6} value={f.nu_calle} onInput={set('nu_calle')} /></Lbl>
            <Lbl label="Código postal"><input class={FIELD} inputMode="numeric" maxLength={5} value={f.cp} onInput={set('cp')} /></Lbl>
            <Lbl label="Entre calle"><input class={FIELD} maxLength={120} value={f.entre_calle} onInput={set('entre_calle')} /></Lbl>
            <Lbl label="Entre calle 2"><input class={FIELD} maxLength={120} value={f.entre_calle_2} onInput={set('entre_calle_2')} /></Lbl>
            <Lbl label="Teléfono"><input class={FIELD} type="tel" maxLength={40} value={f.te} onInput={set('te')} /></Lbl>
            <Lbl label="Email (@abc.gob.ar)"><input class={FIELD} type="email" required maxLength={120} placeholder="escuela@abc.gob.ar" value={f.email} onInput={set('email')} /></Lbl>
            <Lbl label="Circuito electoral"><select class={FIELD} value={f.circuito_id} onChange={set('circuito_id')}><option value="">Sin circuito</option>{activos(cir, f.circuito_id).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></Lbl>
            <Lbl label="Nudo"><select class={FIELD} value={f.nudo_id} onChange={set('nudo_id')}><option value="">Sin nudo</option>{activos(nud, f.nudo_id).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></Lbl>
            <div class="grid gap-2 sm:col-span-2 sm:grid-cols-2">
              <Toggle checked={f.eav} onChange={(v) => setF({ ...f, eav: v })} label="¿Es escuela de Verano?" />
              <Toggle checked={f.alfa} onChange={(v) => setF({ ...f, alfa: v })} label="¿Es escuela Alfa?" />
              <Toggle checked={f.sede_electoral} onChange={(v) => setF({ ...f, sede_electoral: v })} label="¿Es sede Electoral?" />
              <Toggle checked={f.sede_evacuacion} onChange={(v) => setF({ ...f, sede_evacuacion: v })} label="¿Sede de Evacuación?" />
            </div>
          </div>
          <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {onCancel && <button type="button" class={BTN_SECONDARY} onClick={onCancel}>Volver</button>}
            <button class={BTN_PRIMARY} disabled={busy}>Guardar cambios</button>
          </div>
        </Card>
      </form>
    </>
  )
}
