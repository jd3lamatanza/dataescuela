export interface Escuela { id: number; nombre: string | null; tipo: string | null; numero: number | null; codigo: string | null; localidad: string | null; eav: string | null }

export const etiquetaEscuela = (e: Escuela) => [e.tipo || e.codigo, e.numero, e.nombre, e.localidad ? `(${e.localidad})` : ''].filter(Boolean).join(' ')
