import type { ComponentType } from 'preact'
import { EmptyState, PageHeader } from '../ui/kit'
import { Inicio } from './Inicio'
import { Usuarios } from './Usuarios'
import { Simulado } from './Simulado'
import { Turnos } from './Turnos'
import { Planes } from './Planes'
import { Agrupamientos } from './Agrupamientos'
import { Escuelas } from './Escuelas'
import { Fichas } from './Fichas'
import { ArticulacionEscolar } from './articulacion/Escolar'
import { ArticulacionSupervision } from './articulacion/Supervision'

const Pendiente = (titulo: string) => () => (
  <>
    <PageHeader title={titulo} />
    <EmptyState title="Módulo en construcción" text="Se migra en la próxima etapa." />
  </>
)

/** id de módulo (src/modules.ts) → página. Los módulos sin página muestran "en construcción". */
export const PAGES: Record<string, ComponentType> = {
  inicio: Inicio,
  usuarios: Usuarios,
  'usuarios-distrito': Usuarios,
  simulado: Simulado,
  turnos: Turnos,
  planes: Planes,
  agrupamientos: Agrupamientos,
  escuelas: Escuelas,
  fichas: Fichas,
  articulacion: ArticulacionEscolar,
  areal: ArticulacionSupervision,
  distrito: ArticulacionSupervision,
  region: ArticulacionSupervision,
}

export const pageFor = (id: string, label: string): ComponentType => PAGES[id] ?? Pendiente(label)
