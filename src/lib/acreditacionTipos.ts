import type { Escuela } from './escuelaEtiqueta'

export interface Evento {
  id: string
  nombre: string
  lugar: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  descripcion: string
  estado: 'pendiente' | 'activo' | 'finalizado'
}
export interface DatosPersona { nombre: string; dni: string; cargo: string; escuela: string; externa: boolean; escuelaExterna: string; email: string }
export interface Persona { id: number; nombre: string; dni: string; cargo: string; escuela_id: number | null; escuela_externa: string | null; escuela: Escuela | null; email: string; constancia_enviada_en: string | null; envio_estado: string }
export interface Progreso { total: number; enviados: number; pendientes: number; en_curso: number; inciertos: number }
