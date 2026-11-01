import { useAsync } from '../lib/hooks'
import { supabase, check } from '../lib/supabase'

// Plan gratuito de Supabase: 500 MB de base de datos
const LIMITE_DB = 500 * 1024 * 1024

interface Uso { dia: string; rest: number; auth: number; storage: number; realtime: number }
interface Estado { db_bytes: number; conexiones: number; max_conexiones: number; usuarios: number }

function Medidor({ label, texto, pct }: { label: string; texto: string; pct: number }) {
  const color = pct >= 85 ? 'bg-rose-500' : pct >= 60 ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div class="min-w-0 flex-1">
      <div class="flex justify-between gap-2 text-xs"><span class="font-medium text-slate-700">{label}</span><span class="text-slate-500">{texto}</span></div>
      <div class="mt-1 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div class={`h-full rounded-full ${color}`} style={{ width: `${Math.max(Math.min(pct, 100), 1)}%` }} />
      </div>
    </div>
  )
}

export function BarraServidor({ collapsed }: { collapsed: boolean }) {
  const { data } = useAsync<Estado>(async () => check(await supabase.rpc('servidor_estado')) as unknown as Estado)
  // Supabase no limita la cantidad de solicitudes a la API en el plan gratuito
  const uso = useAsync<Uso | null>(async () => {
    const { data: d, error } = await supabase.functions.invoke('uso')
    if (error) return null
    const hoy = new Date().toISOString().slice(0, 10)
    return ((d?.dias ?? []) as Uso[]).find((x) => x.dia === hoy) ?? null
  })
  if (!data) return null
  const sol = uso.data ? uso.data.rest + uso.data.auth + uso.data.storage + uso.data.realtime : null
  const mb = data.db_bytes / 1024 / 1024
  const pDb = (data.db_bytes / LIMITE_DB) * 100
  const pCon = (data.conexiones / data.max_conexiones) * 100
  const critico = pDb >= 85 || pCon >= 85
  return (
    <div class={`fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur ${collapsed ? 'lg:left-16' : 'lg:left-64'}`} aria-label="Estado del servidor">
      <div class="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
        <span class={`text-xs font-semibold ${critico ? 'text-rose-700' : 'text-emerald-700'}`}>{critico ? 'Servidor: atención' : 'Servidor: normal'}</span>
        <Medidor label="Base de datos" texto={`${mb.toFixed(1)} de 500 MB`} pct={pDb} />
        <div class="min-w-0 flex-1 text-xs"><p class="font-medium text-slate-700">Solicitudes hoy</p><p class="mt-1 text-slate-500">{sol === null ? (uso.loading ? '…' : 'sin datos') : `${sol.toLocaleString('es-AR')} · sin límite`}</p></div>
        <Medidor label="Conexiones" texto={`${data.conexiones} de ${data.max_conexiones}`} pct={pCon} />
      </div>
    </div>
  )
}

