export interface Boletin { clave: string; completo: number | null; parcial: number | null; sin_carga: number | null }

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export async function leerBoletin(texto: string): Promise<{ fecha: string; trimestre: string | null; filas: Boletin[] }> {
  const XLSX = await import('xlsx')
  const libro = XLSX.read(texto.replace(/^\uFEFF/, ''), { type: 'string', FS: ';', raw: true })
  const filas = XLSX.utils.sheet_to_json<string[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, blankrows: true, defval: '', raw: true })
  const titulo = filas.slice(0, 7).map((r) => String(r[0] ?? '')).find((s) => /bolet[ií]n digital incompleto al\s+\d{2}-\d{2}-\d{4}/i.test(s))
  const partes = titulo?.match(/\sal\s+(\d{2})-(\d{2})-(\d{4})/i)
  if (!partes) throw new Error('No se encontró la fecha “Boletín Digital incompleto al DD-MM-AAAA” en el encabezado.')
  const fecha = `${partes[3]}-${partes[2]}-${partes[1]}`
  const dia = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(dia.getTime()) || dia.toISOString().slice(0, 10) !== fecha) throw new Error('La fecha del archivo no es válida.')
  const trimestre = titulo!.match(/\b(\d+\S*\s+trimestre)\b/i)?.[1] ?? null

  const cabecera = filas.findIndex((r) => normalizar(String(r[0] ?? '')) === 'clave del establecimiento')
  if (cabecera < 0) throw new Error('No se encontró el encabezado de escuelas del CSV.')
  const h = filas[cabecera].map((v) => normalizar(String(v)))
  if (!h[1]?.includes('cue') || !h[2]?.includes('nombre del establecimiento') || h[3] !== 'completo' || h[4] !== 'parcial' || h[5] !== 'sin carga') {
    throw new Error('Las columnas del CSV no coinciden con el formato esperado de ABC.')
  }
  const numero = (v: unknown, linea: number): number | null => {
    const s = String(v ?? '').trim()
    if (!s) return null
    if (!/^\d+$/.test(s) || Number(s) > 2147483647) throw new Error(`Valor inválido en la fila ${linea}.`)
    return Number(s)
  }
  const resultado: Boletin[] = []
  const claves = new Set<string>()
  for (let i = cabecera + 1; i < filas.length; i++) {
    const r = filas[i]
    const clave = String(r[0] ?? '').trim()
    if (!clave) break
    if (!/^\d{4}[A-Za-z]{2}\d{4}$/.test(clave)) throw new Error(`Clave de escuela inválida en la fila ${i + 1}.`)
    if (claves.has(clave)) throw new Error(`La clave ${clave} está repetida en el archivo.`)
    claves.add(clave)
    resultado.push({ clave, completo: numero(r[3], i + 1), parcial: numero(r[4], i + 1), sin_carga: numero(r[5], i + 1) })
  }
  if (!resultado.length) throw new Error('El CSV no contiene escuelas.')
  return { fecha, trimestre, filas: resultado }
}

export const totalBoletin = (b: Boletin) => b.completo === null && b.parcial === null && b.sin_carga === null ? null : (b.completo ?? 0) + (b.parcial ?? 0) + (b.sin_carga ?? 0)
export const avanceBoletin = (b: Boletin) => {
  const t = totalBoletin(b)
  return t && b.completo !== null ? b.completo * 100 / t : null
}
