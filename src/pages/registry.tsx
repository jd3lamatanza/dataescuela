import type { ComponentType } from 'preact'
import { EmptyState, PageHeader } from '../ui/kit'
import { Inicio } from './Inicio'

const Pendiente = (titulo: string) => () => (
  <>
    <PageHeader title={titulo} />
    <EmptyState title="Módulo en construcción" text="Se migra en la próxima etapa." />
  </>
)

/** id de módulo (src/modules.ts) → página. Los módulos sin página muestran "en construcción". */
export const PAGES: Record<string, ComponentType> = {
  inicio: Inicio,
}

export const pageFor = (id: string, label: string): ComponentType => PAGES[id] ?? Pendiente(label)
