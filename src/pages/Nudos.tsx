import { useMemo, useState } from 'preact/hooks'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { contarSinNudo, esSinNudo, etiquetaEscuela, filtrarNudos, tablaNudos, type EscuelaNudo, type FiltrosNudos, type Nudo, type OrdenNudo } from '../lib/nudosListado'
import { buildListadoXlsx } from '../lib/escuelasListado'
import { buildPdf } from '../lib/export'
import { descargar, XLSX_MIME } from '../lib/download'
import { BRAND } from '../modules'
import { Icon } from '../ui/Icon'
import { Alert, Badge, BTN_PRIMARY, BTN_SECONDARY, Card, EmptyState, FIELD, Lbl, Modal, PageHeader, Spinner, TabBar, confirmar, toast, type TabItem } from '../ui/kit'

type TipoAgrupacion = 'nudo' | 'circuito'

async function cargar(tipo: TipoAgrupacion) {
  const nudos: Nudo[] = [], escuelas: EscuelaNudo[] = []
  for (let offset = 0; ; offset += 500) {
    const r = await supabase.from(tipo === 'nudo' ? 'nudos' : 'circuitos_electorales').select('id,nombre,activo').order('id').range(offset, offset + 499)
    if (r.error) throw r.error
    nudos.push(...r.data)
    if (r.data.length < 500) break
  }
  for (let offset = 0; ; offset += 500) {
    if (tipo === 'nudo') {
      const r = await supabase.rpc('nudos_escuelas').order('id').range(offset, offset + 499)
      if (r.error) throw r.error
      escuelas.push(...r.data)
      if (r.data.length < 500) break
    } else {
      const r = await supabase.from('escuelas').select('id,circuito_id,clave,tipo,numero,nombre,localidad').order('id').range(offset, offset + 499)
      if (r.error) throw r.error
      escuelas.push(...r.data.map(({ circuito_id, ...e }) => ({ ...e, nudo_id: circuito_id })))
      if (r.data.length < 500) break
    }
  }
  nudos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es-AR'))
  escuelas.sort((a, b) => (a.clave ?? '').localeCompare(b.clave ?? '', 'es-AR') || a.id - b.id)
  return { nudos, escuelas }
}

export function Nudos() { return <Agrupaciones tipo="nudo" /> }
export function CircuitosElectorales() { return <Agrupaciones tipo="circuito" /> }

function Agrupaciones({ tipo }: { tipo: TipoAgrupacion }) {
  const { user } = useAuth()
  const puedeAdministrar = user?.role === (tipo === 'nudo' ? 'distrital' : 'admin')
  const titulo = tipo === 'nudo' ? 'Nudos' : 'Circuitos Electorales'
  const plural = tipo === 'nudo' ? 'nudos' : 'circuitos'
  const mayuscula = tipo === 'nudo' ? 'Nudo' : 'Circuito'
  const tabs: TabItem[] = [
    { id: 'escuelas', label: `Escuelas por ${tipo}`, icon: 'building', color: 'sky' },
    { id: 'gestion', label: `Administrar ${plural}`, icon: 'settings', color: 'indigo' },
  ]
  const [tab, setTab] = useState('escuelas')
  const [editando, setEditando] = useState<Nudo | 'nuevo' | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [filtros, setFiltros] = useState<FiltrosNudos>({ busqueda: '', nudo: '', localidad: '', orden: 'clave', descendente: false })
  const { data, error, loading, reload } = useAsync(() => cargar(tipo), [tipo, user?.id, user?.role])
  const grupos = useMemo(() => data ? filtrarNudos(data.nudos, data.escuelas, filtros, tipo) : [], [data, filtros, tipo])
  const localidades = useMemo(() => [...new Set((data?.escuelas ?? []).map((e) => e.localidad).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'es-AR')), [data])
  const sinNudo = data ? contarSinNudo(data.nudos, data.escuelas, tipo) : 0
  const exportar = async (formato: 'xlsx' | 'pdf') => {
    setExportando(true)
    try {
      const tabla = tablaNudos(grupos, filtros, BRAND.org, tipo)
      if (formato === 'xlsx') descargar(await buildListadoXlsx(tabla, BRAND.name, tipo === 'nudo' ? 'Nudos' : 'Circuitos'), `escuelas-por-${tipo}.xlsx`, XLSX_MIME)
      else {
        const respuesta = await fetch(`${import.meta.env.BASE_URL}icon-192.png`)
        if (!respuesta.ok) throw new Error('No se pudo cargar el logo de la aplicación.')
        descargar(await buildPdf(tabla, { brand: { name: BRAND.name, logo: new Uint8Array(await respuesta.arrayBuffer()) }, maxCellLines: 60 }), `escuelas-por-${tipo}.pdf`, 'application/pdf')
      }
    } catch (e) { toast.error(`No se pudo exportar el listado: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setExportando(false) }
  }
  const eliminar = async (nudo: Nudo) => {
    if (!(await confirmar(`Eliminar ${tipo}`, { text: `¿Eliminar el ${tipo} "${nudo.nombre}"?`, ok: 'Eliminar', danger: true }))) return
    setEliminando(true)
    const r = await supabase.rpc(tipo === 'nudo' ? 'nudo_eliminar' : 'circuito_eliminar', { p_id: nudo.id })
    setEliminando(false)
    if (r.error) { toast.error(r.error.message); reload(); return }
    toast.ok(`${mayuscula} eliminado`); reload()
  }
  return <>
    <PageHeader title={titulo} subtitle={tipo === 'nudo' ? 'Agrupamientos territoriales de escuelas' : 'Circuitos electorales de las escuelas'} />
    {data && sinNudo > 0 && <div class="mb-4"><Badge tone="amber"><Icon name="alert" class="mr-1 size-4" />{sinNudo} {sinNudo === 1 ? 'escuela' : 'escuelas'} sin {tipo} asignado</Badge></div>}
    <TabBar label={titulo} items={puedeAdministrar ? tabs : tabs.filter((t) => t.id === 'escuelas')} active={puedeAdministrar ? tab : 'escuelas'} onChange={setTab} />
    {error && <div class="mb-3"><Alert tone="error">{error}</Alert></div>}
    {loading && !data ? <Spinner /> : data && <>
      {(tab === 'escuelas' || !puedeAdministrar) && <>
        <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Lbl label="Buscar"><input class={FIELD} type="search" placeholder={`${mayuscula}, clave, escuela o localidad`} value={filtros.busqueda} onInput={(e) => setFiltros({ ...filtros, busqueda: e.currentTarget.value })} /></Lbl>
          <Lbl label={mayuscula}><select class={FIELD} value={filtros.nudo} onChange={(e) => setFiltros({ ...filtros, nudo: e.currentTarget.value })}><option value="">Todos los {plural}</option><option value="sin-asignar">Sin {tipo} asignado</option>{data.nudos.filter((n) => !esSinNudo(n, tipo)).map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}</select></Lbl>
          <Lbl label="Localidad"><select class={FIELD} value={filtros.localidad} onChange={(e) => setFiltros({ ...filtros, localidad: e.currentTarget.value })}><option value="">Todas las localidades</option>{localidades.map((l) => <option key={l} value={l}>{l}</option>)}</select></Lbl>
          <Lbl label="Ordenar escuelas por"><select class={FIELD} value={filtros.orden} onChange={(e) => setFiltros({ ...filtros, orden: e.currentTarget.value as OrdenNudo })}><option value="clave">Clave provincial</option><option value="nombre">Nombre</option><option value="localidad">Localidad</option></select></Lbl>
        </div>
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <button type="button" class={BTN_SECONDARY} onClick={() => setFiltros({ ...filtros, descendente: !filtros.descendente })}><Icon name="transfer" />{filtros.descendente ? 'Orden descendente' : 'Orden ascendente'}</button>
          <button type="button" class={BTN_SECONDARY} disabled={exportando || loading || !!error || !grupos.length} onClick={() => exportar('xlsx')}><Icon name="download" />Excel</button>
          <button type="button" class={BTN_SECONDARY} disabled={exportando || loading || !!error || !grupos.length} onClick={() => exportar('pdf')}><Icon name="download" />PDF</button>
          <span class="text-xs text-slate-500">{exportando ? 'Preparando exportación…' : 'Se exportan todos los resultados filtrados.'}</span>
        </div>
        {grupos.length ? <div class="space-y-3">
        {grupos.map((nudo) => {
          const escuelas = nudo.escuelas
          return <Card key={nudo.id ?? 'sin-referencia'}>
            <div class="mb-3 flex flex-wrap items-center gap-2"><h2 class="font-semibold text-slate-900">{nudo.nombre}</h2><Badge tone="blue">{escuelas.length} {escuelas.length === 1 ? 'escuela' : 'escuelas'}</Badge>{!nudo.activo && <Badge>Inactivo</Badge>}</div>
            {escuelas.length ? <ul class="divide-y divide-slate-100">{escuelas.map((e) => <li key={e.id} class="flex items-start gap-2 py-2 text-sm">
              <Icon name="building" class="mt-0.5 size-4 shrink-0 text-sky-600" />
              <div><p class="font-medium text-slate-800">{etiquetaEscuela(e)}{e.nombre ? ` · ${e.nombre}` : ''}</p>{e.localidad && <p class="text-slate-500">{e.localidad}</p>}</div>
            </li>)}</ul> : <p class="text-sm text-slate-500">Sin escuelas asociadas.</p>}
          </Card>
        })}
      </div> : <EmptyState title="Sin resultados" text="Probá con otros filtros." />}
      </>}
      {puedeAdministrar && tab === 'gestion' && <>
        <div class="mb-3 flex justify-end"><button class={BTN_PRIMARY} onClick={() => setEditando('nuevo')}><Icon name="plus" />Nuevo {tipo}</button></div>
        {!data.nudos.length ? <EmptyState title={`Todavía no hay ${plural}`} text="Creá el primero para que las escuelas puedan seleccionarlo." /> : <Card>
          <ul class="-my-4 divide-y divide-slate-100">{data.nudos.map((nudo) => {
            const cantidad = data.escuelas.filter((e) => e.nudo_id === nudo.id).length
            return <li key={nudo.id} class="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p class="font-medium text-slate-900">{nudo.nombre} {!nudo.activo && <Badge>Inactivo</Badge>}</p><p class="text-xs text-slate-500">{cantidad} {cantidad === 1 ? 'escuela asociada' : 'escuelas asociadas'}</p></div>
              <div class="flex gap-2">
                <button type="button" class={BTN_SECONDARY} aria-label={`Editar ${nudo.nombre}`} onClick={() => setEditando(nudo)}><Icon name="edit" /><span class="hidden sm:inline">Editar</span></button>
                <button type="button" class={BTN_SECONDARY} aria-label={`Eliminar ${nudo.nombre}`} title={cantidad ? 'No se puede eliminar: tiene escuelas asociadas' : `Eliminar ${tipo}`} disabled={!!cantidad || eliminando || loading} onClick={() => eliminar(nudo)}><Icon name="trash" /><span class="hidden sm:inline">Eliminar</span></button>
              </div>
            </li>
          })}</ul>
        </Card>}
      </>}
    </>}
    {puedeAdministrar && editando && <NudoForm tipo={tipo} nudo={editando === 'nuevo' ? null : editando} onClose={() => setEditando(null)} onDone={() => { setEditando(null); reload() }} />}
  </>
}

function NudoForm({ tipo, nudo, onClose, onDone }: { tipo: TipoAgrupacion; nudo: Nudo | null; onClose(): void; onDone(): void }) {
  const [nombre, setNombre] = useState(nudo?.nombre ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const guardar = async (e: Event) => {
    e.preventDefault()
    const valor = nombre.trim()
    if (!valor || valor.length > 150) { setError('Ingresá un nombre de hasta 150 caracteres.'); return }
    setBusy(true); setError('')
    const r = await supabase.rpc(tipo === 'nudo' ? 'nudo_guardar' : 'circuito_guardar', { p_id: nudo?.id ?? null, p_nombre: valor })
    setBusy(false)
    if (r.error) { setError(r.error.code === '23505' ? `Ya existe un ${tipo} con ese nombre.` : r.error.message); return }
    toast.ok(`${tipo === 'nudo' ? 'Nudo' : 'Circuito'} ${nudo ? 'actualizado' : 'creado'}`); onDone()
  }
  return <Modal title={`${nudo ? 'Editar' : 'Nuevo'} ${tipo}`} onClose={onClose}>
    <form class="space-y-4" onSubmit={guardar}>
      {error && <Alert tone="error">{error}</Alert>}
      <Lbl label="Nombre"><input class={FIELD} value={nombre} maxLength={150} required disabled={busy} onInput={(e) => setNombre(e.currentTarget.value)} /></Lbl>
      <div class="flex justify-end gap-2"><button type="button" class={BTN_SECONDARY} disabled={busy} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
    </form>
  </Modal>
}
