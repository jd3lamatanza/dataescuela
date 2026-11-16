export function formatearFechaNacimiento(valor: string): string {
  const digitos = valor.replace(/\D/g, '').slice(0, 8)
  return [digitos.slice(0, 2), digitos.slice(2, 4), digitos.slice(4, 8)].filter(Boolean).join('/')
}

export function fechaNacimientoISO(valor: string, hoy = new Date()): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor)
  if (!match) return null
  const [, diaTexto, mesTexto, anioTexto] = match
  const dia = Number(diaTexto), mes = Number(mesTexto), anio = Number(anioTexto)
  const bisiesto = anio % 4 === 0 && (anio % 100 !== 0 || anio % 400 === 0)
  const dias = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (anio < 1 || mes < 1 || mes > 12 || dia < 1 || dia > dias[mes - 1]) return null
  const fecha = `${anioTexto}-${mesTexto}-${diaTexto}`
  const limite = `${hoy.getFullYear().toString().padStart(4, '0')}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
  return fecha <= limite ? fecha : null
}
