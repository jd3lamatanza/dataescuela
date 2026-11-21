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
  firmas_configuradas?: boolean
}
export interface EscuelaCargoForm { cargo: string; escuela: string; externa: boolean; escuelaExterna: string }
export interface DatosPersona { nombre: string; dni: string; escuelas: EscuelaCargoForm[]; email: string }
export interface EscuelaCargo { cargo: string; escuela_id: number | null; escuela_externa: string | null; escuela: Escuela | null; orden: number }
export interface Persona { id: number; nombre: string; dni: string; cargo: string; escuela_id: number | null; escuela_externa: string | null; escuela: Escuela | null; adicionales: EscuelaCargo[]; email: string; constancia_enviada_en: string | null; envio_estado: string; envio_iniciado_en?: string | null }
export interface Progreso { total: number; enviados: number; pendientes: number; en_curso: number; inciertos: number }
