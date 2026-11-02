import { useAuth } from '../lib/auth'
import { ROLE_LABELS, modulesFor } from '../modules'
import { Card, PageHeader } from '../ui/kit'
import { Icon } from '../ui/Icon'
import { href } from '../lib/router'
import { Calendario } from '../ui/Calendario'

export function Inicio() {
  const { user } = useAuth()
  if (!user) return null
  const mods = modulesFor(user.role).filter((m) => m.id !== 'inicio')
  return (
    <>
      <PageHeader title={`Hola, ${user.name}`} subtitle={`Rol: ${ROLE_LABELS[user.role]}`} />
      <section aria-label="Calendario"><Calendario /></section>
      <h2 class="mb-2 mt-6 text-sm font-semibold uppercase text-slate-500">Módulos</h2>
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
    </>
  )
}
