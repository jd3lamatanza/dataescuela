import type { AppModule } from '../modules'
import type { IconKey } from './Icon'

type Apariencia = { icon: IconKey; claro: string; oscuro: string }
const estilo = (icon: IconKey, claro: string, oscuro: string): Apariencia => ({ icon, claro, oscuro })

const inicio = estilo('home', '#0369a1', '#7dd3fc')
const mensajes = estilo('mail', '#0f766e', '#5eead4')
const articulacion = estilo('transfer', '#6d28d9', '#c4b5fd')
const matricula = estilo('id-card', '#1d4ed8', '#93c5fd')
const salidas = estilo('bus', '#b45309', '#fbbf24')
const agenda = estilo('calendar-clock', '#6b5b00', '#fef08a')
const labores = estilo('clipboard-check', '#a21c50', '#fbcfe8')
const verano = estilo('sun', '#92400e', '#fde68a')

export const ESTILOS_MODULOS: Record<string, Apariencia> = {
  inicio, mensajes, articulacion, areal: articulacion, distrito: articulacion,
  'matricula-areal': matricula, matricula, matriculas: matricula,
  estadistica: estilo('chart-bars', '#be185d', '#f9a8d4'),
  region: estilo('route', '#4d7c0f', '#bef264'),
  simulado: estilo('login', '#9a3412', '#fed7aa'),
  'usuarios-distrito': estilo('user-settings', '#4338ca', '#a5b4fc'),
  configuracion: estilo('sliders', '#475569', '#cbd5e1'),
  acreditacion: estilo('check', '#047857', '#6ee7b7'),
  'mapa-escolar': estilo('map', '#0e7490', '#67e8f9'),
  escuelas: estilo('school', '#7c3aed', '#ddd6fe'),
  nudos: estilo('network', '#a21caf', '#f0abfc'),
  'circuitos-electorales': estilo('flag', '#b91c1c', '#fca5a5'),
  fichas: estilo('list', '#a16207', '#fde047'),
  planes: estilo('book', '#0f766e', '#5eead4'),
  turnos: estilo('clock', '#b45309', '#fbbf24'),
  inspectores: estilo('users', '#4d7c0f', '#bef264'),
  disposiciones: estilo('document-seal', '#7e22ce', '#d8b4fe'),
  agrupamientos: estilo('layers', '#9d174d', '#f9a8d4'),
  planta: estilo('org', '#15803d', '#86efac'),
  plantas: estilo('org', '#15803d', '#86efac'),
  usuarios: estilo('users', '#4338ca', '#a5b4fc'),
  salidas, 'salidas-areal': salidas, 'salidas-distrito': salidas,
  contingencias: estilo('alert', '#c2410c', '#fdba74'),
  'eventos-escolares': estilo('calendar', '#7c5e10', '#fef9c3'),
  'mis-proyectos': estilo('book', '#9f1239', '#fda4af'),
  'proyectos-escolares': estilo('books', '#115e59', '#99f6e4'),
  'proyectos-areales': estilo('folder-star', '#78350f', '#fcd34d'),
  'agenda-areal': agenda, 'agenda-distrito': agenda,
  labores, 'labores-distrito': labores,
  eav: verano, 'eav-escolar': verano,
  'ayuda-escolar': estilo('help', '#075985', '#bae6fd'),
  'ayuda-distrital': estilo('help', '#075985', '#bae6fd'),
}

export const ESTILOS_CATEGORIAS: Record<string, Apariencia> = {
  escuelas: estilo('building', '#9d174d', '#fbc2da'),
  inspectores: estilo('shield', '#3f6212', '#d9f99d'),
  estadistica: estilo('chart', '#be123c', '#fecdd3'),
  utilidades: estilo('grid', '#0f4c81', '#bfdbfe'),
  sistema: estilo('settings', '#57534e', '#d6d3d1'),
}
export const ESTILO_TEMA = estilo('theme', '#6b21a8', '#e9d5ff')

export const estiloModulo = (modulo: AppModule): Apariencia =>
  ESTILOS_MODULOS[modulo.id] ?? estilo(modulo.icon, '#475569', '#cbd5e1')
