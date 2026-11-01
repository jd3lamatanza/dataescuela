import { useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, RowMenu, Spinner, Toggle, confirmar, toast } from './kit'

export const TIPOS = {
  directivo: { tabla: 'equipo_directivo', titulo: 'Equipo Directivo', col: 'cargo_directivo', base: true },
  orientacion: { tabla: 'equipo_orientacion', titulo: 'Equipo de Orientación', col: 'cargo_eoe', base: false },
  esi: { tabla: 'referentes_esi', titulo: 'Referentes ESI', col: '', base: false },
} as const
export type TipoEquipo = keyof typeof TIPOS

export const cuilOk = (c: string) => {
  if (!/^\d{11}$/.test(c)) return false
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let s = 0
  for (let i = 0; i < 10; i++) s += w[i] * Number(c[i])
  let d = 11 - (s % 11)
  if (d === 11) d = 0
  if (d === 10) d = 9
  return d === Number(c[10])
}
const fecha = (s: string | null) => (s ? s.split('-').reverse().join('/') : '')
const EMAIL = /^[^\s@]+@abc\.gob\.ar$/

type Row = Record<string, any>

/** Listado y ABM de un equipo (directivo, orientación o referentes ESI) de una escuela. */
export function Equipo({ escuelaId, tipo }: { escuelaId: number; tipo: TipoEquipo }) {
  const t = TIPOS[tipo]
  const esi = tipo === 'esi'
  const [edit, setEdit] = useState<Row | null>(null)
  const { data, loading, error, reload } = useAsync(async () => {
    const cat = async (col: string) => (await supabase.from('catalogos').select('id,nombre,activo').eq('coleccion', col).order('orden')).data ?? []
    const q = esi
      ? supabase.from('referentes_esi').select('*').eq('escuela_id', escuelaId).order('apellido_nombre')
      : supabase.from(t.tabla).select('*, cargo:catalogos!cargo_id(nombre,orden), revista:catalogos!revista_id(nombre)').eq('escuela_id', escuelaId)
    const [r, cargos, revistas] = await Promise.all([q, esi ? [] : cat(t.col), esi ? [] : cat('situacion_revista')])
    if (r.error) throw r.error
    const rows = (r.data ?? []) as Row[]
    if (!esi) rows.sort((a, b) => (a.cargo?.orden ?? 0) - (b.cargo?.orden ?? 0) || a.apellido_nombre.localeCompare(b.apellido_nombre))
    return { rows, cargos, revistas }
  }, [escuelaId, tipo])

  const del = async (r: Row) => {
    if (!(await confirmar('Eliminar registro', { text: r.apellido_nombre, ok: 'Eliminar', danger: true }))) return
    const { error } = await supabase.from(t.tabla).delete().eq('id', r.id).eq('escuela_id', escuelaId)
    if (error) return toast.error(error.message)
    toast.ok('Registro eliminado'); reload()
  }
  const Menu = ({ r }: { r: Row }) => <RowMenu items={[{ label: 'Editar', onClick: () => setEdit(r) }, { label: 'Eliminar', danger: true, onClick: () => del(r) }]} />
  const Cuil = ({ r }: { r: Row }) => <span class="font-mono text-xs">{r.cuil || '—'}{r.cuil && !cuilOk(r.cuil) && <span title="CUIL inválido" class="ml-1 rounded bg-amber-50 px-1 text-amber-700 ring-1 ring-amber-200">revisar</span>}</span>
  const otra = (r: Row) => (r.otra_escuela ? 'Sí' + (r.otra_escuela_detalle ? ' · ' + r.otra_escuela_detalle : '') : 'No')

  const TH = 'px-3 py-2'
  return (
    <>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-slate-500">{data?.rows.length ?? 0} registros</p>
        <button class={BTN_PRIMARY} onClick={() => setEdit({})}>Agregar</button>
      </div>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      <Card class="mt-3">
        {loading && !data ? <Spinner /> : !data?.rows.length ? <EmptyState title="Sin registros" text="Agregá el primero con el botón “Agregar”." /> : (
          <>
            <div class="-m-4 hidden overflow-x-auto md:block">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  {esi
                    ? <tr><th class={TH}>Apellido y nombre</th><th class={TH}>DNI</th><th class={TH}>Cargo</th><th class={TH}>Área</th><th class={TH}>Turno</th><th class={TH}>Otra escuela</th><th class={TH}></th></tr>
                    : <tr><th class={TH}>Apellido y nombre</th><th class={TH}>Cargo</th><th class={TH}>Revista</th><th class={TH}>Toma</th><th class={TH}>CUIL</th><th class={TH}>Contacto</th><th class={TH}></th></tr>}
                </thead>
                <tbody class="divide-y divide-slate-100">
                  {data.rows.map((r) => esi ? (
                    <tr key={r.id} class="hover:bg-slate-50"><td class="px-3 py-2.5 font-medium">{r.apellido_nombre}</td><td class="px-3 py-2.5 font-mono text-xs">{r.dni}</td><td class="px-3 py-2.5 text-xs">{r.cargo}</td><td class="px-3 py-2.5 text-xs">{r.area}</td><td class="px-3 py-2.5 text-xs">{r.turno}</td><td class="px-3 py-2.5 text-xs">{otra(r)}</td><td class="px-3 py-2.5"><Menu r={r} /></td></tr>
                  ) : (
                    <tr key={r.id} class="hover:bg-slate-50"><td class="px-3 py-2.5 font-medium">{r.apellido_nombre}</td><td class="px-3 py-2.5 text-xs">{r.cargo?.nombre}</td><td class="px-3 py-2.5 text-xs">{r.revista?.nombre}</td><td class="whitespace-nowrap px-3 py-2.5 text-xs">{fecha(r.toma_posesion)}</td><td class="whitespace-nowrap px-3 py-2.5"><Cuil r={r} /></td><td class="px-3 py-2.5 text-xs text-slate-600">{[r.telefono, r.email].filter(Boolean).join(' · ')}</td><td class="px-3 py-2.5"><Menu r={r} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul class="-my-4 divide-y divide-slate-200 md:hidden">
              {data.rows.map((r) => (
                <li key={r.id} class="py-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0"><p class="font-semibold">{r.apellido_nombre}</p>
                      {esi ? <p class="font-mono text-xs text-slate-500">DNI {r.dni}</p> : <p class="text-xs text-slate-600">{r.cargo?.nombre} · {r.revista?.nombre}{r.toma_posesion ? ' · Toma ' + fecha(r.toma_posesion) : ''}</p>}</div>
                    <Menu r={r} />
                  </div>
                  {esi ? <><p class="mt-1 text-xs text-slate-600">{[r.cargo, r.area, r.turno].filter(Boolean).join(' · ')}</p><p class="text-xs text-slate-500">Referente en otra escuela: {otra(r)}</p></>
                    : <><p class="mt-1"><Cuil r={r} /></p><p class="text-xs text-slate-500">{[r.telefono, r.email].filter(Boolean).join(' · ')}</p></>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      {edit && data && <EquipoForm tipo={tipo} escuelaId={escuelaId} r={edit} cargos={data.cargos} revistas={data.revistas} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload() }} />}
    </>
  )
}

function EquipoForm({ tipo, escuelaId, r, cargos, revistas, onClose, onDone }: { tipo: TipoEquipo; escuelaId: number; r: Row; cargos: any[]; revistas: any[]; onClose(): void; onDone(): void }) {
  const t = TIPOS[tipo]
  const esi = tipo === 'esi'
  const [f, setF] = useState<Row>({
    apellido_nombre: r.apellido_nombre ?? '', dni: r.dni ?? '', cargo: r.cargo ?? '', area: r.area ?? '', turno: r.turno ?? '', otra_escuela: !!r.otra_escuela, otra_escuela_detalle: r.otra_escuela_detalle ?? '',
    cargo_id: String(r.cargo_id ?? ''), revista_id: String(r.revista_id ?? ''), cuil: r.cuil ?? '', toma_posesion: r.toma_posesion ?? '', telefono: r.telefono ?? '', email: r.email ?? '', cargo_base: r.cargo_base ?? '',
  })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value })
  const nul = (v: string) => String(v).trim() || null

  const submit = async (e: Event) => {
    e.preventDefault()
    const nombre = String(f.apellido_nombre).trim()
    if (nombre.length < 3) return setErr('Completá apellido y nombre')
    let row: Row
    if (esi) {
      const dni = String(f.dni).trim()
      if (!/^\d{7,8}$/.test(dni)) return setErr('El DNI debe tener 7 u 8 dígitos')
      row = { apellido_nombre: nombre, dni, cargo: nul(f.cargo), area: nul(f.area), turno: nul(f.turno), otra_escuela: f.otra_escuela, otra_escuela_detalle: f.otra_escuela ? nul(f.otra_escuela_detalle) : null }
    } else {
      const cuil = String(f.cuil).trim()
      if (!/^\d{11}$/.test(cuil) || (cuil !== r.cuil && !cuilOk(cuil))) return setErr('El CUIL no es válido')
      const email = String(f.email).trim().toLowerCase()
      if (email && !EMAIL.test(email)) return setErr('El email debe terminar en @abc.gob.ar')
      if (!f.cargo_id || !f.revista_id) return setErr('Elegí el cargo y la situación de revista')
      row = { apellido_nombre: nombre, cuil, email: email || null, telefono: String(f.telefono).replace(/\D/g, '') || null, toma_posesion: nul(f.toma_posesion), cargo_id: Number(f.cargo_id), revista_id: Number(f.revista_id) }
      if (t.base) row.cargo_base = nul(f.cargo_base)
    }
    row.updated_by = (await supabase.auth.getUser()).data.user?.id
    row.updated_at = new Date().toISOString()
    const q = r.id ? supabase.from(t.tabla).update(row).eq('id', r.id).eq('escuela_id', escuelaId) : supabase.from(t.tabla).insert({ ...row, escuela_id: escuelaId })
    const { error } = await q
    if (error) return setErr(error.message)
    toast.ok(r.id ? 'Registro actualizado' : 'Registro agregado'); onDone()
  }

  const opts = (rows: any[], cur: string) => rows.filter((x) => x.activo || String(x.id) === cur).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)
  return (
    <Modal title={t.titulo} onClose={onClose}>
      <form onSubmit={submit} class="space-y-4" autocomplete="off">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Apellido y nombre"><input class={FIELD} required maxLength={200} value={f.apellido_nombre} onInput={set('apellido_nombre')} /></Lbl>
        {esi ? (
          <>
            <Lbl label="DNI"><input class={FIELD} required inputMode="numeric" maxLength={8} value={f.dni} onInput={set('dni')} /></Lbl>
            <Lbl label="Cargo"><input class={FIELD} maxLength={120} value={f.cargo} onInput={set('cargo')} /></Lbl>
            <Lbl label="Área o asignatura"><input class={FIELD} maxLength={120} value={f.area} onInput={set('area')} /></Lbl>
            <Lbl label="Turno"><input class={FIELD} maxLength={60} placeholder="Mañana, Tarde…" value={f.turno} onInput={set('turno')} /></Lbl>
            <Toggle checked={f.otra_escuela} onChange={(v) => setF({ ...f, otra_escuela: v })} label="¿Es referente en otra escuela?" />
            {f.otra_escuela && <Lbl label="¿En cuál?"><input class={FIELD} maxLength={200} value={f.otra_escuela_detalle} onInput={set('otra_escuela_detalle')} /></Lbl>}
          </>
        ) : (
          <>
            <div class="grid gap-4 sm:grid-cols-2">
              <Lbl label="Cargo"><select class={FIELD} required value={f.cargo_id} onChange={set('cargo_id')}><option value="">Seleccionar…</option>{opts(cargos, f.cargo_id)}</select></Lbl>
              <Lbl label="Situación de revista"><select class={FIELD} required value={f.revista_id} onChange={set('revista_id')}><option value="">Seleccionar…</option>{opts(revistas, f.revista_id)}</select></Lbl>
              <Lbl label="CUIL"><input class={FIELD} required inputMode="numeric" maxLength={11} value={f.cuil} onInput={set('cuil')} /></Lbl>
              <Lbl label="Toma de posesión"><input class={FIELD} type="date" value={f.toma_posesion} onInput={set('toma_posesion')} /></Lbl>
              <Lbl label="Teléfono"><input class={FIELD} type="tel" maxLength={20} value={f.telefono} onInput={set('telefono')} /></Lbl>
            </div>
            <Lbl label="Email (@abc.gob.ar)"><input class={FIELD} type="email" maxLength={120} value={f.email} onInput={set('email')} /></Lbl>
            {t.base && <Lbl label="Cargo de base"><input class={FIELD} maxLength={120} value={f.cargo_base} onInput={set('cargo_base')} /></Lbl>}
          </>
        )}
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY}>Guardar</button></div>
      </form>
    </Modal>
  )
}
