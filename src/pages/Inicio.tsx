import { useAuth } from '../lib/auth'
import { ROLE_LABELS, modulesFor } from '../modules'
import { Card, PageHeader } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { href } from '../lib/router'
import { useAsync } from '../lib/hooks'
import { supabase, check } from '../lib/supabase'

// Plan gratuito de Supabase: 500 MB de base de datos
const LIMITE_DB = 500 * 1024 * 1024

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

function BarraServidor() {
  const { data } = useAsync<Estado>(async () => check(await supabase.rpc('servidor_estado')) as unknown as Estado)
  if (!data) return null
  const mb = data.db_bytes / 1024 / 1024
  const pDb = (data.db_bytes / LIMITE_DB) * 100
  const pCon = (data.conexiones / data.max_conexiones) * 100
  const critico = pDb >= 85 || pCon >= 85
  return (
    <div class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur lg:left-72" aria-label="Estado del servidor">
      <div class="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
        <span class={`text-xs font-semibold ${critico ? 'text-rose-700' : 'text-emerald-700'}`}>{critico ? 'Servidor: atención' : 'Servidor: normal'}</span>
        <Medidor label="Base de datos" texto={`${mb.toFixed(1)} de 500 MB`} pct={pDb} />
        <Medidor label="Conexiones" texto={`${data.conexiones} de ${data.max_conexiones}`} pct={pCon} />
      </div>
    </div>
  )
}

export function Inicio() {
  const { user } = useAuth()
  if (!user) return null
  const mods = modulesFor(user.role).filter((m) => m.id !== 'inicio')
  return (
    <>
      <PageHeader title={`Hola, ${user.name}`} subtitle={`Rol: ${ROLE_LABELS[user.role]}`} />
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mods.map((m) => (
          <a key={m.id} href={href(m.path)} class="group">
            <Card class="h-full transition group-hover:border-sky-300 group-hover:shadow">
              <div class="flex items-center gap-3">
                <span class="flex size-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600"><Icon name={m.icon} /></span>
                <span class="font-medium text-slate-900">{m.label}</span>
              </div>
            </Card>
          </a>
        ))}
      </div>
      {user.role === 'distrital' && <><div class="h-20" /><BarraServidor /></>}
    </>
  )
}
