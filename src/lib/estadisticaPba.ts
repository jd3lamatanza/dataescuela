export interface MatriculaPba {
  clave: string
  activa: number | null
  anterior: number | null
  inicial: number | null
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export async function leerMatriculaPba(texto: string): Promise<{ fecha: string; filas: MatriculaPba[] }> {
  const XLSX = await import('xlsx')
  const libro = XLSX.read(texto.replace(/^\uFEFF/, ''), { type: 'string', FS: ';', raw: true })
  const filas = XLSX.utils.sheet_to_json<string[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, blankrows: true, defval: '', raw: true })
  const titulo = filas.slice(0, 7).map((r) => String(r[0] ?? '')).find((s) => /matr[ií]cula activa al\s+\d{2}-\d{2}-\d{4}/i.test(s))
  const partes = titulo?.match(/matr[ií]cula activa al\s+(\d{2})-(\d{2})-(\d{4})/i)
  if (!partes) throw new Error('No se encontró la fecha “Matrícula activa al DD-MM-AAAA” en el encabezado.')
  const fecha = `${partes[3]}-${partes[2]}-${partes[1]}`
  const dia = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(dia.getTime()) || dia.toISOString().slice(0, 10) !== fecha) throw new Error('La fecha del archivo no es válida.')

  const cabecera = filas.findIndex((r) => normalizar(String(r[0] ?? '')) === 'clave del establecimiento')
  if (cabecera < 0) throw new Error('No se encontró el encabezado de escuelas del CSV.')
  const h = filas[cabecera].map((v) => normalizar(String(v)))
  if (!h[1]?.includes('cue') || !h[2]?.includes('nombre del establecimiento') ||
      !h[3]?.includes('matricula activa') || !h[4]?.includes('matricula inscripta') || !h[5]?.includes('matricula relevamiento inicial')) {
    throw new Error('Las columnas del CSV no coinciden con el formato esperado de ABC.')
  }
  const numero = (v: unknown, linea: number): number | null => {
    const s = String(v ?? '').trim()
    if (!s) return null
    if (!/^\d+$/.test(s) || Number(s) > 2147483647) throw new Error(`Matrícula inválida en la fila ${linea}.`)
    return Number(s)
  }
  const resultado: MatriculaPba[] = []
  const claves = new Set<string>()
  for (let i = cabecera + 1; i < filas.length; i++) {
    const r = filas[i]
    const clave = String(r[0] ?? '').trim()
    if (!clave) break
    if (!/^\d{4}[A-Za-z]{2}\d{4}$/.test(clave)) throw new Error(`Clave de escuela inválida en la fila ${i + 1}.`)
    if (claves.has(clave)) throw new Error(`La clave ${clave} está repetida en el archivo.`)
    claves.add(clave)
    resultado.push({ clave, activa: numero(r[3], i + 1), anterior: numero(r[4], i + 1), inicial: numero(r[5], i + 1) })
  }
  if (!resultado.length) throw new Error('El CSV no contiene escuelas.')
  return { fecha, filas: resultado }
}

export function diferencia(actual: number | null, base: number | null) {
  if (actual === null || base === null) return { valor: null, porcentaje: null }
  const valor = actual - base
  return { valor, porcentaje: base === 0 ? null : valor * 100 / base }
}

export function coincideAgrupamiento(codigosEscuela: ReadonlySet<string> | undefined, codigosGrupo: ReadonlySet<string> | null) {
  if (!codigosGrupo) return true
  return codigosEscuela ? [...codigosEscuela].some((codigo) => codigosGrupo.has(codigo)) : false
}

export const fechaPba = (fecha: string) => fecha.split('-').reverse().join('/')
export const numeroPba = (n: number | null) => n === null ? 'Sin dato' : n.toLocaleString('es-AR')
export const diferenciaPba = (actual: number | null, base: number | null) => {
  const { valor, porcentaje } = diferencia(actual, base)
  if (valor === null) return 'Sin dato'
  return `${valor > 0 ? '+' : ''}${numeroPba(valor)} (${porcentaje === null ? 'sin porcentaje' : `${porcentaje > 0 ? '+' : ''}${porcentaje.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`})`
}
