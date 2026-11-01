import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useAsync, useDebounced } from '../lib/hooks'
import { setParams, useRoute } from '../lib/router'
import { Alert, Card, EmptyState, FIELD, PageHeader, Pager, PAGE_SIZE, RowMenu, Spinner, BTN_SECONDARY, confirmar, toast } from '../ui/kit'
import { Equipo, TIPOS, type TipoEquipo } from '../ui/Equipo'
import { FichaEscuela, nombreEscuela } from '../ui/FichaEscuela'
import { useState } from 'preact/hooks'
import { periodoActual } from './matricula/Escolar'

const ORDEN: Record<string, [string, string[]]> = {
  clave: ['Clave', ['clave', 'numero']], cue: ['CUE', ['cue']], codigo: ['Código', ['codigo', 'numero']], numero: ['Número', ['numero', 'clave']],
  nivel: ['Nivel', ['nivel', 'numero']], modalidad: ['Modalidad', ['modalidad', 'numero']], localidad: ['Localidad', ['localidad', 'numero']],
}
const VISTAS = [{ id: 'ficha', label: 'Ficha de Escuela' }, ...(Object.keys(TIPOS) as TipoEquipo[]).map((k) => ({ id: k, label: TIPOS[k].titulo }))]

export function Escuelas() {
  const { params } = useRoute()
  const eid = Number(params.get('e')) || 0
  return eid ? <Detalle id={eid} vista={params.get('v') ?? 'ficha'} /> : <Listado />
}

function Listado() {
  const { user } = useAuth()
  const { params } = useRoute()
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q)
  const nivel = params.get('nivel') ?? ''
  const orden = params.get('orden') && ORDEN[params.get('orden')!] ? params.get('orden')! : 'clave'
  const desc = params.get('dir') === 'desc'
  const page = Math.max(1, Number(params.get('page')) || 1)

  const niveles = useAsync(async () => {
    const r = await supabase.from('escuelas').select('nivel')
    return [...new Set((r.data ?? []).map((x) => x.nivel).filter(Boolean) as string[])].sort()
  })
  const { data, loading, error } = useAsync(async () => {
    let s = supabase.from('escuelas').select('id,clave,cue,codigo,numero,nivel,modalidad,localidad', { count: 'exact' })
    if (nivel) s = s.eq('nivel', nivel)
    const t = dq.trim().slice(0, 80).replace(/[,()%*\\]/g, ' ')
    if (t) s = s.or(['clave', 'cue', 'codigo', 'nivel', 'modalidad', 'localidad'].map((k) => `${k}.ilike.%${t}%`).concat(/^\d+$/.test(t) ? [`numero.eq.${t}`] : []).join(','))
    ORDEN[orden][1].forEach((c, i) => { s = s.order(c, { ascending: i === 0 ? !desc : true, nullsFirst: false }) })
    const r = await s.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    if (r.error) throw r.error
    return { rows: r.data, total: r.count ?? 0 }
  }, [dq, nivel, orden, desc, page])

  const jefatura = user?.role === 'distrital'
  const ver = (id: number, v = 'ficha') => setParams({ e: id, v: v === 'ficha' ? null : v })
  const reset = async (e: { id: number; clave: string }) => {
    if (!(await confirmar('Restablecer contraseña', { text: `Se restablece la contraseña de ${e.clave} a la clave inicial y deberá cambiarla al ingresar.`, ok: 'Restablecer', danger: true }))) return
    const { error } = await supabase.rpc('escuela_reset', { p_escuela: e.id })
    if (error) return toast.error(error.message)
    toast.ok('Contraseña restablecida')
  }
  const habilitarMatricula = async (e: { id: number; clave: string }) => {
    const per = await periodoActual()
    const { data: on, error } = await supabase.rpc('matricula_habilitar', { p_escuela: e.id, p_ciclo: per.ciclo, p_mes: per.mes })
    if (error) return toast.error(error.message)
    toast.ok(on ? `Carga de matrícula habilitada para ${e.clave}` : `Carga de matrícula deshabilitada para ${e.clave}`)
  }
  const Menu = ({ e }: { e: any }) => (
    <RowMenu items={[
      { label: 'Ficha de Escuela', onClick: () => ver(e.id) },
      { label: 'Equipo Directivo', onClick: () => ver(e.id, 'directivo') },
      { label: 'Equipo de Orientación', onClick: () => ver(e.id, 'orientacion') },
      { label: 'Referentes ESI', onClick: () => ver(e.id, 'esi') },
      { label: 'Habilitar/Deshabilitar carga de matrícula', icon: 'unlock', sep: true, hidden: !jefatura, onClick: () => habilitarMatricula(e) },
      { label: 'Restablecer contraseña', danger: true, hidden: !jefatura, onClick: () => reset(e) },
    ]} />
  )

  return (
    <>
      <PageHeader title="Escuelas" subtitle={`Padrón de escuelas · ${data?.total ?? 0} en el listado`} />
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]">
        <input type="search" class={FIELD} placeholder="Clave, CUE, código, número, nivel o localidad" value={q} maxLength={80} aria-label="Buscar"
          onInput={(e) => { setQ(e.currentTarget.value); setParams({ q: e.currentTarget.value, page: null }) }} />
        <select class={FIELD} value={nivel} aria-label="Nivel" onChange={(e) => setParams({ nivel: e.currentTarget.value, page: null })}><option value="">Todos los niveles</option>{niveles.data?.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <select class={FIELD} value={orden} aria-label="Ordenar por" onChange={(e) => setParams({ orden: e.currentTarget.value, page: null })}>{Object.entries(ORDEN).map(([k, [l]]) => <option key={k} value={k}>Orden: {l}</option>)}</select>
        <select class={FIELD} value={desc ? 'desc' : 'asc'} aria-label="Dirección" onChange={(e) => setParams({ dir: e.currentTarget.value === 'desc' ? 'desc' : null, page: null })}><option value="asc">Ascendente</option><option value="desc">Descendente</option></select>
        <button class={BTN_SECONDARY} onClick={() => { setQ(''); setParams({ q: null, nivel: null, orden: null, dir: null, page: null }) }}>Limpiar</button>
      </div>
      {error && <div class="mt-3"><Alert tone="error">{error}</Alert></div>}
      <Card class="mt-3">
        {loading && !data ? <Spinner /> : !data?.rows.length ? <EmptyState title="Sin resultados" text="Probá con otros filtros." /> : (
          <>
            <div class="-m-4 hidden overflow-x-auto md:block">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Clave', 'CUE', 'Código', 'Número', 'Nivel', 'Modalidad', 'Localidad', ''].map((h) => <th key={h} class="px-3 py-2">{h}</th>)}</tr></thead>
                <tbody class="divide-y divide-slate-100">
                  {data.rows.map((e) => (
                    <tr key={e.id} class="hover:bg-slate-50">
                      <td class="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-medium">{e.clave}</td>
                      <td class="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{e.cue}</td>
                      <td class="px-3 py-2.5 text-xs">{e.codigo}</td><td class="px-3 py-2.5 text-xs">{e.numero}</td>
                      <td class="px-3 py-2.5 text-xs">{e.nivel}</td><td class="px-3 py-2.5 text-xs">{e.modalidad}</td><td class="px-3 py-2.5 text-xs">{e.localidad}</td>
                      <td class="px-3 py-2.5"><Menu e={e} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul class="-my-4 divide-y divide-slate-200 md:hidden">
              {data.rows.map((e) => (
                <li key={e.id} class="flex items-start justify-between gap-2 py-3">
                  <div class="min-w-0">
                    <p class="font-semibold">{e.codigo} {e.numero}</p>
                    <p class="font-mono text-xs text-slate-500">{e.clave} · CUE {e.cue}</p>
                    <p class="text-xs text-slate-600">{[e.nivel, e.modalidad].filter(Boolean).join(' · ')}</p>
                    <p class="text-xs text-slate-500">{e.localidad}</p>
                  </div>
                  <Menu e={e} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Pager page={page} total={data?.total ?? 0} onPage={(p) => setParams({ page: p > 1 ? p : null })} />
    </>
  )
}

function Detalle({ id, vista }: { id: number; vista: string }) {
  const { data, error } = useAsync(async () => {
    const r = await supabase.from('escuelas').select('id,clave,cue,tipo,numero,nombre').eq('id', id).maybeSingle()
    if (r.error) throw r.error
    if (!r.data) throw new Error('La escuela no existe o no está asignada a tu área')
    return r.data
  }, [id])
  const v = VISTAS.some((x) => x.id === vista) ? vista : 'ficha'
  const volver = () => setParams({ e: null, v: null })
  return (
    <>
      <button class="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline" onClick={volver}>← Volver al listado</button>
      {error && <Alert tone="error">{error}</Alert>}
      {data && (
        <>
          <PageHeader title={VISTAS.find((x) => x.id === v)!.label} subtitle={`${data.clave} · ${nombreEscuela(data)}`} />
          <nav class="flex gap-2 overflow-x-auto text-sm">
            {VISTAS.map((x) => <button key={x.id} onClick={() => setParams({ v: x.id === 'ficha' ? null : x.id })} class={`min-h-10 whitespace-nowrap rounded-full px-3 font-medium ${x.id === v ? 'bg-sky-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{x.label}</button>)}
          </nav>
          <div class="mt-3">{v === 'ficha' ? <FichaEscuela id={id} onCancel={volver} /> : <Equipo escuelaId={id} tipo={v as TipoEquipo} />}</div>
        </>
      )}
    </>
  )
}
