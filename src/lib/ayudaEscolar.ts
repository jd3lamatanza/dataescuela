export interface GuiaEscolar {
  id: string
  modulo: string
  titulo: string
  descripcion: string
  secciones: { titulo: string; pasos: string[] }[]
  captura_drive: string | null
  posicion: number
  version: number
  actualizado: string
}

export function buscarGuias(guias: readonly GuiaEscolar[], q: string): GuiaEscolar[] {
  const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR')
  const terminos = normalizar(q.trim()).split(/\s+/).filter(Boolean)
  return guias.filter((guia) => {
    const texto = normalizar([guia.titulo, guia.modulo, guia.descripcion, ...guia.secciones.flatMap((s) => [s.titulo, ...s.pasos])].join(' '))
    return terminos.every((t) => texto.includes(t))
  })
}

export type GestionGuia = { accion: 'guardar'; guia: Partial<GuiaEscolar>; imagen?: { mime: string; base64: string }; quitar_captura?: boolean }
  | { accion: 'eliminar'; guia: Pick<GuiaEscolar, 'id' | 'version'> }
