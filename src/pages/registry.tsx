import type { ComponentType } from 'preact'
import { EmptyState, PageHeader } from '../ui/kit'
import { Inicio } from './Inicio'
import { Usuarios } from './Usuarios'
import { Simulado } from './Simulado'
import { Turnos } from './Turnos'
import { Inspectores } from './Inspectores'
import { Perfil } from './Perfil'
import { Agenda } from './Agenda'
import { Salidas } from './Salidas'
import { Contingencias } from './Contingencias'
import { EventosEscolares } from './EventosEscolares'
import { MisProyectos } from './MisProyectos'
import { ProyectosAreales } from './ProyectosAreales'
import { useAuth } from '../lib/auth'
import { Labores } from './Labores'
import { EscuelaVerano } from './EscuelaVerano'
import { EscuelaVeranoEscolar } from './EscuelaVeranoEscolar'
import { Planes } from './Planes'
import { Agrupamientos } from './Agrupamientos'
import { Escuelas } from './Escuelas'
import { Fichas } from './Fichas'
import { Planta, Plantas } from './Planta'
import { Matricula } from './matricula/Escolar'
import { Matriculas } from './matricula/Distrital'
import { ArticulacionEscolar } from './articulacion/Escolar'
import { ArticulacionSupervision } from './articulacion/Supervision'
import { MatriculasAreal } from './matricula/Areal'
import { Estadistica } from './Estadistica'
import { Configuracion } from './Configuracion'
import { Mensajes } from './Mensajes'
import { Acreditacion } from './Acreditacion'
import { MapaEscolar } from './MapaEscolar'
import { CircuitosElectorales, Nudos } from './Nudos'
import { Disposiciones } from './Disposiciones'
import { AyudaEscolar } from './AyudaEscolar'
import { AyudaDistrital } from './AyudaDistrital'

const Pendiente = (titulo: string) => () => (
  <>
    <PageHeader title={titulo} />
    <EmptyState title="Módulo en construcción" text="Se migra en la próxima etapa." />
  </>
)

const MisProyectosPropios = () => {
  const { user } = useAuth()
  return user?.role === 'areal' ? <ProyectosAreales /> : <MisProyectos />
}

/** id de módulo (src/modules.ts) → página. Los módulos sin página muestran "en construcción". */
export const PAGES: Record<string, ComponentType> = {
  inicio: Inicio,
  usuarios: Usuarios,
  'usuarios-distrito': Usuarios,
  simulado: Simulado,
  turnos: Turnos,
  inspectores: Inspectores,
  disposiciones: Disposiciones,
  'ayuda-escolar': AyudaEscolar,
  'ayuda-distrital': AyudaDistrital,
  perfil: Perfil,
  'agenda-areal': Agenda,
  'agenda-distrito': Agenda,
  labores: Labores,
  eav: EscuelaVerano,
  'eav-escolar': EscuelaVeranoEscolar,
  'labores-distrito': Labores,
  salidas: Salidas,
  contingencias: Contingencias,
  'eventos-escolares': EventosEscolares,
  'mis-proyectos': MisProyectosPropios,
  'proyectos-escolares': MisProyectos,
  'proyectos-areales': ProyectosAreales,
  'salidas-distrito': Salidas,
  'salidas-areal': Salidas,
  planes: Planes,
  agrupamientos: Agrupamientos,
  escuelas: Escuelas,
  nudos: Nudos,
  'circuitos-electorales': CircuitosElectorales,
  fichas: Fichas,
  planta: Planta,
  plantas: Plantas,
  matricula: Matricula,
  matriculas: Matriculas,
  'matricula-areal': MatriculasAreal,
  estadistica: Estadistica,
  configuracion: Configuracion,
  mensajes: Mensajes,
  acreditacion: Acreditacion,
  'mapa-escolar': MapaEscolar,
  articulacion: ArticulacionEscolar,
  areal: ArticulacionSupervision,
  distrito: ArticulacionSupervision,
  region: ArticulacionSupervision,
}

export const pageFor = (id: string, label: string): ComponentType => PAGES[id] ?? Pendiente(label)
