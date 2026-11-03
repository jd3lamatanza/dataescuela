import { useEffect, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { descargarDocumento, previsualizable, quitarArchivo, subirDocumento, urlVistaPrevia } from '../lib/eav'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Card, FIELD, Lbl, Modal, PageHeader, Spinner, Toggle, confirmar, toast } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { col } from '../ui/Calendario'

interface Estado { id: number; nombre: string; color: string }
interface Archivo { id: number; nombre: string; mime: string | null; bytes: number | null }
interface Directivo {
  id: number; nombre: string; cuil: string; fecha_nacimiento: string; cargo_base: string; pat: string | null; pid: string | null
  email: string; telefono: string; domicilio: string; estado_id: number; archivos: Archivo[]
}

const tam = (b: number | null) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
const fmt = (d: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'))
const soloNum = (s: string) => s.replace(/\D/g, '')

/** Escuela de Verano (rol escolar): activación de la EAV y carga del directivo con su documentación. */
export function EscuelaVeranoEscolar() {
  const [edit, setEdit] = useState(false)
  const { data, loading, error, reload } = useAsync(async () => {
    const id = (await supabase.rpc('mi_escuela')).data as number | null
    if (!id) throw new Error('Tu cuenta no tiene una escuela asociada')
    const [e, est, dir] = await Promise.all([
      supabase.from('escuelas').select('id,eav').eq('id', id).single(),
      supabase.from('eav_estados').select('id,nombre,color').order('orden'),
      supabase.from('eav_directivos').select('*, archivos:eav_directivo_archivos(id,nombre,mime,bytes)').maybeSingle(),
    ])
    if (e.error) throw e.error
    return { id, activa: e.data.eav === 'Sí', estados: (est.data ?? []) as Estado[], dir: (dir.data ?? null) as Directivo | null }
  })

  const activar = async (v: boolean) => {
    const { error } = await supabase.from('escuelas').update({ eav: v ? 'Sí' : 'No' }).eq('id', data!.id)
    if (error) return toast.error(error.message)
    toast.ok(v ? 'Escuela de verano activada' : 'Escuela de verano desactivada'); reload()
  }
  const estado = data?.estados.find((s) => s.id === data.dir?.estado_id)

  return (
    <>
      <PageHeader title="Escuela de Verano" subtitle="EAV" />
      {error && <Alert tone="error">{error}</Alert>}
      {loading && !data ? <Spinner /> : data && (!data.activa ? (
        <Card>
          <div class="space-y-3">
            <Alert tone="warning">Tu escuela no está registrada como escuela de verano. Activá la opción para cargar los datos de la EAV.</Alert>
            <Toggle checked={false} onChange={activar} label="Mi escuela es escuela de verano" />
          </div>
        </Card>
      ) : (
        <>
          <Card title="Directivo de la Escuela de Verano" action={data.dir && estado?.nombre !== 'Aprobado' ? <button class={BTN_SECONDARY} onClick={() => setEdit(true)}>Editar</button> : undefined}>
            {!data.dir ? (
              <div class="space-y-3 text-sm text-slate-600">
                <p>Todavía no cargaste al directivo de la EAV.</p>
                <button class={BTN_PRIMARY} onClick={() => setEdit(true)}>Cargar directivo</button>
              </div>
            ) : <Ficha d={data.dir} estado={estado} />}
          </Card>
          <div class="mt-4"><Toggle checked onChange={activar} label="Mi escuela es escuela de verano" /></div>
        </>
      ))}
      {edit && data && <Formulario dir={data.dir} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload() }} />}
    </>
  )
}

function Ficha({ d, estado }: { d: Directivo; estado?: Estado }) {
  const [prev, setPrev] = useState<{ nombre: string; url: string; img: boolean } | null>(null)
  useEffect(() => () => { if (prev) URL.revokeObjectURL(prev.url) }, [prev])
  const ver = async (a: Archivo) => {
    try { setPrev({ nombre: a.nombre, url: await urlVistaPrevia(a.id, a.mime), img: !!a.mime?.startsWith('image/') }) } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo abrir el archivo') }
  }
  const bajar = async (a: Archivo) => { try { await descargarDocumento(a.id, a.nombre, a.mime) } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo descargar') } }
  const dato = (t: string, v?: string | null) => <div><dt class="text-xs uppercase text-slate-500">{t}</dt><dd class="break-words">{v || '—'}</dd></div>
  return (
    <div class="space-y-4">
      <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${col(estado?.color).chip}`}>{estado?.nombre ?? '—'}</span>
      <dl class="grid gap-3 text-sm sm:grid-cols-2">
        {dato('Nombre completo', d.nombre)}{dato('CUIL', d.cuil)}{dato('Fecha de nacimiento', fmt(d.fecha_nacimiento))}{dato('Cargo base', d.cargo_base)}
        {dato('PAT', d.pat)}{dato('PID', d.pid)}{dato('Email', d.email)}{dato('Teléfono', d.telefono)}
        <div class="sm:col-span-2">{dato('Domicilio', d.domicilio)}</div>
      </dl>
      <div>
        <h3 class="mb-1 text-sm font-semibold text-slate-700">Documentación respaldatoria</h3>
        {d.archivos.length === 0 ? <p class="text-sm text-slate-500">Sin archivos.</p> : (
          <ul class="divide-y divide-slate-100 rounded-md border border-slate-200">
            {d.archivos.map((a) => (
              <li key={a.id} class="flex items-center gap-2 p-2 text-sm">
                <span class="min-w-0 flex-1 truncate">{a.nombre} <span class="text-xs text-slate-400">{tam(a.bytes)}</span></span>
                {previsualizable(a.mime) && <button type="button" class={BTN_SECONDARY} aria-label={`Ver ${a.nombre}`} onClick={() => ver(a)}><Icon name="eye" class="size-5" /></button>}
                <button type="button" class={BTN_SECONDARY} aria-label={`Descargar ${a.nombre}`} onClick={() => bajar(a)}><Icon name="download" class="size-5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {prev && (
        <Modal title={prev.nombre} onClose={() => setPrev(null)} wide>
          {prev.img ? <img src={prev.url} alt={prev.nombre} class="mx-auto max-h-[70vh] rounded" /> : <iframe src={prev.url} title={prev.nombre} class="h-[70vh] w-full rounded border border-slate-200" />}
        </Modal>
      )}
    </div>
  )
}

function Formulario({ dir, onClose, onDone }: { dir: Directivo | null; onClose(): void; onDone(): void }) {
  const [v, setV] = useState({
    nombre: dir?.nombre ?? '', cuil: dir?.cuil ?? '', nac: dir?.fecha_nacimiento ?? '', cargo: dir?.cargo_base ?? '', pat: dir?.pat ?? '', pid: dir?.pid ?? '',
    email: dir?.email ?? '', tel: dir?.telefono ?? '', dom: dir?.domicilio ?? '',
  })
  const [nuevos, setNuevos] = useState<File[]>([])
  const [existentes, setExistentes] = useState<Archivo[]>(dir?.archivos ?? [])
  const [busy, setBusy] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof v, num = false) => (e: Event) => { const x = (e.currentTarget as HTMLInputElement).value; setV({ ...v, [k]: num ? soloNum(x) : x }) }

  const quitar = async (a: Archivo) => {
    if (!(await confirmar('Quitar archivo', { text: `Se quita “${a.nombre}” de la documentación.`, ok: 'Quitar', danger: true }))) return
    try { await quitarArchivo(a.id); setExistentes(existentes.filter((x) => x.id !== a.id)) } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo quitar') }
  }
  const submit = async (e: Event) => {
    e.preventDefault(); setErr(null)
    setBusy('Guardando…')
    const { data: id, error } = await supabase.rpc('eav_directivo_guardar', {
      p_nombre: v.nombre, p_cuil: v.cuil, p_nacimiento: v.nac, p_cargo: v.cargo, p_pat: v.pat, p_pid: v.pid, p_email: v.email, p_tel: v.tel, p_domicilio: v.dom,
    })
    if (error) { setBusy(null); return setErr(error.message) }
    try {
      for (let i = 0; i < nuevos.length; i++) {
        setBusy(`Subiendo ${i + 1} de ${nuevos.length}: ${nuevos[i].name}`); setPct(0)
        await subirDocumento(id as number, nuevos[i], setPct)
      }
      toast.ok(dir ? 'Datos actualizados' : 'Directivo cargado'); onDone()
    } catch (ex) {
      setBusy(null); setErr(`Los datos se guardaron, pero falló la subida: ${ex instanceof Error ? ex.message : 'error'}. Volvé a abrir “Editar” para reintentar.`)
    }
  }

  return (
    <Modal title={dir ? 'Editar directivo' : 'Cargar directivo'} onClose={busy ? () => {} : onClose} wide>
      <form onSubmit={submit} class="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <Lbl label="Nombre completo"><input class={FIELD} value={v.nombre} onInput={set('nombre')} required minLength={3} maxLength={150} autoComplete="off" /></Lbl>
        <div class="grid gap-3 sm:grid-cols-2">
          <Lbl label="CUIL (solo números)"><input class={FIELD} inputMode="numeric" value={v.cuil} onInput={set('cuil', true)} required pattern="[0-9]{11}" title="11 números" maxLength={11} /></Lbl>
          <Lbl label="Fecha de nacimiento"><input class={FIELD} type="date" value={v.nac} onInput={set('nac')} required max={new Date().toISOString().slice(0, 10)} /></Lbl>
          <Lbl label="Cargo base"><input class={FIELD} value={v.cargo} onInput={set('cargo')} required maxLength={150} /></Lbl>
          <Lbl label="Teléfono (solo números)"><input class={FIELD} type="tel" inputMode="numeric" value={v.tel} onInput={set('tel', true)} required pattern="[0-9]{6,15}" title="Entre 6 y 15 números" maxLength={15} /></Lbl>
          <Lbl label="PAT (opcional)"><input class={FIELD} value={v.pat} onInput={set('pat')} maxLength={100} /></Lbl>
          <Lbl label="PID (opcional)"><input class={FIELD} value={v.pid} onInput={set('pid')} maxLength={100} /></Lbl>
        </div>
        <Lbl label="Email (@abc.gob.ar)"><input class={FIELD} type="email" value={v.email} onInput={set('email')} required pattern="[A-Za-z0-9._%+\-]+@abc\.gob\.ar" title="Debe terminar en @abc.gob.ar" maxLength={150} /></Lbl>
        <Lbl label="Domicilio"><input class={FIELD} value={v.dom} onInput={set('dom')} required maxLength={250} /></Lbl>
        <div>
          <h3 class="mb-1 text-sm font-medium text-slate-700">Documentación respaldatoria</h3>
          <label class="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-center text-sm text-slate-600 hover:border-sky-400 hover:bg-sky-50">
            <Icon name="download" class="size-6 rotate-180 text-slate-400" />
            Tocá para elegir archivos (cualquier tipo, sin límite de cantidad ni peso)
            <input type="file" multiple class="sr-only" onChange={(e) => { setNuevos([...nuevos, ...Array.from(e.currentTarget.files ?? [])]); e.currentTarget.value = '' }} />
          </label>
          <ul class="mt-2 space-y-1 text-sm">
            {existentes.map((a) => <li class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate">{a.nombre}</span><button type="button" class="text-red-600 hover:underline" onClick={() => quitar(a)}>Quitar</button></li>)}
            {nuevos.map((a, i) => <li class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate">{a.name} <span class="text-xs text-slate-400">nuevo · {tam(a.size)}</span></span><button type="button" class="text-red-600 hover:underline" onClick={() => setNuevos(nuevos.filter((_, j) => j !== i))}>Sacar</button></li>)}
          </ul>
        </div>
        {busy && <div class="space-y-1 text-sm text-slate-600"><p>{busy}</p><div class="h-2 overflow-hidden rounded bg-slate-200"><div class="h-full bg-sky-600 transition-all" style={{ width: `${pct}%` }} /></div></div>}
        <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={!!busy} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={!!busy}>Guardar</button></div>
      </form>
    </Modal>
  )
}
