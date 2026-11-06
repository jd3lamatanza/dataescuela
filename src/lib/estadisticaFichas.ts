export const CATEGORIAS_FICHA = [
  { key: 'dni_tramite', label: 'DNI físico en trámite', encabezado: 'no tiene el dni fisico y esta en tramite' },
  { key: 'dni_sin_tramite', label: 'DNI físico sin trámite', encabezado: 'no tiene el dni fisico y no esta en tramite' },
  { key: 'sin_dni', label: 'Sin DNI argentino', encabezado: 'no posee dni argentino' },
  { key: 'genero', label: 'Identidad de género', encabezado: 'identidad de genero' },
  { key: 'nacimiento', label: 'Lugar de nacimiento', encabezado: 'lugar de nacimiento' },
  { key: 'salud', label: 'Información de salud', encabezado: 'informacion de salud' },
  { key: 'inclusion', label: 'Inclusión', encabezado: 'inclusion' },
  { key: 'complementaria', label: 'Educación complementaria', encabezado: 'educacion complementaria' },
] as const

export type CategoriaFicha = typeof CATEGORIAS_FICHA[number]['key']
export type FichaInscripcion = { clave: string; matricula: number | null } & Record<CategoriaFicha, number | null>

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export async function leerFichasInscripcion(texto: string): Promise<{ fecha: string; filas: FichaInscripcion[] }> {
  const XLSX = await import('xlsx')
  const libro = XLSX.read(texto.replace(/^\uFEFF/, ''), { type: 'string', FS: ';', raw: true })
  const filas = XLSX.utils.sheet_to_json<string[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, blankrows: true, defval: '', raw: true })
  const titulo = filas.slice(0, 7).map((r) => String(r[0] ?? '')).find((s) => /ficha de inscripci[oó]n al\s+\d{2}-\d{2}-\d{4}/i.test(s))
  const partes = titulo?.match(/al\s+(\d{2})-(\d{2})-(\d{4})/i)
  if (!partes) throw new Error('No se encontró la fecha “…ficha de inscripción al DD-MM-AAAA” en el encabezado.')
  const fecha = `${partes[3]}-${partes[2]}-${partes[1]}`
  const dia = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(dia.getTime()) || dia.toISOString().slice(0, 10) !== fecha) throw new Error('La fecha del archivo no es válida.')

  const cabecera = filas.findIndex((r) => normalizar(String(r[0] ?? '')) === 'clave del establecimiento')
  if (cabecera < 0) throw new Error('No se encontró el encabezado de escuelas del CSV.')
  const h = filas[cabecera].map((v) => normalizar(String(v)))
  const columna = (texto: string) => h.findIndex((v) => v.includes(texto))
  const matriculaCol = columna('matricula total')
  const cols = CATEGORIAS_FICHA.map((c) => ({ key: c.key, col: h.findIndex((v) => v.endsWith(c.encabezado)) }))
  if (!h[1]?.includes('cue') || matriculaCol < 0 || cols.some((c) => c.col < 0)) {
    throw new Error('Las columnas del CSV no coinciden con el formato esperado de fichas de inscripción.')
  }
  const numero = (v: unknown, linea: number): number | null => {
    const s = String(v ?? '').trim()
    if (!s) return null
    if (!/^\d+$/.test(s) || Number(s) > 2147483647) throw new Error(`Valor inválido en la fila ${linea}.`)
    return Number(s)
  }
  const resultado: FichaInscripcion[] = []
  const claves = new Set<string>()
  for (let i = cabecera + 1; i < filas.length; i++) {
    const r = filas[i]
    const clave = String(r[0] ?? '').trim()
    if (!clave) break
    if (!/^\d{4}[A-Za-z]{2}\d{4}$/.test(clave)) throw new Error(`Clave de escuela inválida en la fila ${i + 1}.`)
    if (claves.has(clave)) throw new Error(`La clave ${clave} está repetida en el archivo.`)
    claves.add(clave)
    const ficha = { clave, matricula: numero(r[matriculaCol], i + 1) } as FichaInscripcion
    for (const c of cols) ficha[c.key] = numero(r[c.col], i + 1)
    resultado.push(ficha)
  }
  if (!resultado.length) throw new Error('El CSV no contiene escuelas.')
  return { fecha, filas: resultado }
}

export const porcentajeFicha = (n: number | null, total: number | null) =>
  n === null || !total ? null : n * 100 / total
export const porcentajeTexto = (p: number | null) =>
  p === null ? '—' : `${p.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`
