export interface ConfiguracionEmail {
  salidas_destino: string
  sistema_remitente: string
  respuesta: string
  nombre_remitente: string
}

export function validarConfiguracion(c: ConfiguracionEmail): void {
  const correo = /^[^\s\x00-\x1f\x7f@<>]+@[^\s\x00-\x1f\x7f@<>]+\.[^\s\x00-\x1f\x7f@<>]+$/
  for (const valor of [c.salidas_destino, c.sistema_remitente, c.respuesta]) {
    if (valor !== valor.trim() || valor.length > 254 || !correo.test(valor)) throw new Error('Dirección de correo configurada inválida')
  }
  if (c.nombre_remitente !== c.nombre_remitente.trim() || !c.nombre_remitente || c.nombre_remitente.length > 120 || /[\x00-\x1f\x7f<>]/.test(c.nombre_remitente)) throw new Error('Nombre de remitente configurado inválido')
}

export function remitente(c: ConfiguracionEmail) {
  validarConfiguracion(c)
  return `${c.nombre_remitente} <${c.sistema_remitente}>`
}
