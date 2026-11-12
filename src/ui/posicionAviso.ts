export interface PosicionAviso { x: number; y: number }

export function limitarPosicionAviso(posicion: PosicionAviso, ancho: number, alto: number, viewportAncho: number, viewportAlto: number): PosicionAviso {
  const margen = 8
  return {
    x: Math.max(margen, Math.min(posicion.x, Math.max(margen, viewportAncho - ancho - margen))),
    y: Math.max(margen, Math.min(posicion.y, Math.max(margen, viewportAlto - alto - margen))),
  }
}
