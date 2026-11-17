export function validarFirmas(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6 ||
    value.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(value).size !== value.length) {
    throw new Error('Seleccioná entre una y seis firmas válidas.')
  }
  return value
}

export function comprobarFirmas(ids: number[], firmas: { id: number }[]) {
  if (firmas.length !== ids.length || ids.some((id) => !firmas.some((firma) => firma.id === id))) {
    throw new Error('Una firma seleccionada ya no está disponible. Actualizá la selección.')
  }
}