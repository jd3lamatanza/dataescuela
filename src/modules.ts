export const ROLES = ['admin', 'regional', 'distrital', 'areal', 'escolar'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  regional: 'Regional',
  distrital: 'Distrital',
  areal: 'Areal',
  escolar: 'Escolar',
}

export const BRAND = { name: 'DataEscuela v2', org: 'Jefatura Distrital 3 - La Matanza' } as const

export type IconName = 'home' | 'users' | 'school' | 'map' | 'chart' | 'building' | 'settings' | 'bell' | 'search' | 'check' | 'alert' | 'shield' | 'transfer' | 'login' | 'route' | 'list' | 'clock' | 'book' | 'layers' | 'clipboard' | 'org'

export interface AppModule {
  id: string
  label: string
  /** Ruta del router (hash): #/path */
  path: string
  icon: IconName
  roles: readonly Role[]
  /** Mostrar en la barra inferior móvil */
  primary?: boolean
}

// Registro único de módulos. Agregar un módulo = una línea aquí + su página en src/pages/registry.ts
export const MODULES: readonly AppModule[] = [
  { id: 'inicio', label: 'Inicio', path: '/', icon: 'home', roles: ROLES, primary: true },
  { id: 'articulacion', label: 'Articulación', path: '/articulacion', icon: 'transfer', roles: ['escolar'], primary: true },
  { id: 'areal', label: 'Articulación', path: '/areal', icon: 'transfer', roles: ['areal'], primary: true },
  { id: 'distrito', label: 'Articulación', path: '/distrito', icon: 'transfer', roles: ['distrital'], primary: true },
  { id: 'region', label: 'Región', path: '/region', icon: 'chart', roles: ['regional'], primary: true },
  { id: 'simulado', label: 'Ingreso simulado', path: '/simulado', icon: 'login', roles: ['distrital'], primary: true },
  { id: 'usuarios-distrito', label: 'Usuarios', path: '/usuarios-distrito', icon: 'users', roles: ['distrital'], primary: true },
  { id: 'escuelas', label: 'Escuelas', path: '/escuelas', icon: 'building', roles: ['distrital', 'areal'], primary: true },
  { id: 'fichas', label: 'Fichas de Datos', path: '/fichas', icon: 'clipboard', roles: ['escolar'], primary: true },
  { id: 'planes', label: 'Planes de Estudio', path: '/planes', icon: 'book', roles: ['admin'], primary: true },
  { id: 'turnos', label: 'Turnos', path: '/turnos', icon: 'clock', roles: ['admin'], primary: true },
  { id: 'agrupamientos', label: 'Agrupamiento de Matrículas', path: '/agrupamientos', icon: 'layers', roles: ['admin'], primary: false },
  { id: 'planta', label: 'Mi Planta', path: '/planta', icon: 'org', roles: ['escolar'], primary: true },
  { id: 'matricula', label: 'Matrícula', path: '/matricula', icon: 'chart', roles: ['escolar'], primary: true },
  { id: 'plantas', label: 'Plantas', path: '/plantas', icon: 'org', roles: ['distrital'], primary: true },
  { id: 'matriculas', label: 'Matrícula', path: '/matriculas', icon: 'chart', roles: ['distrital'], primary: true },
  { id: 'usuarios', label: 'Usuarios', path: '/usuarios', icon: 'users', roles: ['admin'], primary: true },
]

export const canAccess = (m: AppModule, role: Role) => m.roles.includes(role)
export const modulesFor = (role: Role) => MODULES.filter((m) => canAccess(m, role))
