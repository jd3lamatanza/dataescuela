export const TIPOS_PROYECTO = [
  'Proyecto Institucional', 'Proyecto de Supervisión', 'Proyecto de Evaluación Institucional',
  'Plan de Prevención de Riesgos', 'Proyecto de Articulación', 'Proyecto de ESI',
  'Proyecto de Bibliotecas', 'Proyecto de Nudos', 'Plan de Concurrencia (Continuidad)',
  'Proyecto de Agrupamientos Flexibles', 'Plan de Contingencia',
  'Subproyecto Institucional de Artística', 'Subproyecto Institucional de Educación Física',
  'Subproyecto Institucional de Lenguas Extranjeras', 'Proyecto de Memoria Verdad y Justicia',
  'Proyecto de Malvinas Futuro', 'Proyecto de Leer en Comunidad', 'Proyecto de Niños Narradores', 'Otro',
] as const
export const MAX_PROYECTO = 5 * 1024 * 1024
export const esPdf = (bytes: Uint8Array) =>
  bytes.length >= 5 && [37, 80, 68, 70, 45].every((valor, i) => bytes[i] === valor)
