export const CATEGORIAS_DESEMPENO = [
  { key: 'aprobadas', label: 'Todas aprobadas', encabezado: 'todas las materias aprobadas', color: 'bg-emerald-500', texto: 'text-emerald-700' },
  { key: 'de_1_2', label: '1 o 2 no aprobadas', encabezado: '1 o 2 materias no aprobadas', color: 'bg-lime-400', texto: 'text-lime-700' },
  { key: 'de_3_4', label: '3 o 4 no aprobadas', encabezado: '3 o 4 materias no aprobadas', color: 'bg-amber-400', texto: 'text-amber-700' },
  { key: 'mas_5', label: '5 o más no aprobadas', encabezado: '5 o mas materias no aprobadas', color: 'bg-orange-500', texto: 'text-orange-700' },
  { key: 'ninguna', label: 'Todas no aprobadas', encabezado: 'todas las materias no aprobadas', color: 'bg-red-500', texto: 'text-red-700' },
  { key: 'sin_info', label: 'Sin información', encabezado: 'sin informacion', color: 'bg-slate-400', texto: 'text-slate-600' },
] as const

export type CategoriaDesempeno = typeof CATEGORIAS_DESEMPENO[number]['key']
export type Desempeno = { clave: string; anio: string; matricula: number | null } & Record<CategoriaDesempeno, number | null>

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export async function leerDesempeno(texto: string): Promise<{ fecha: string; ciclo: number; trimestre: number; filas: Desempeno[] }> {
  const XLSX = await import('xlsx')
  const libro = XLSX.read(texto.replace(/^\uFEFF/, ''), { type: 'string', FS: ';', raw: true })
  const filas = XLSX.utils.sheet_to_json<string[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, blankrows: true, defval: '', raw: true })
  const titulo = filas.slice(0, 7).map((r) => String(r[0] ?? '')).find((s) => /desempe[nñ]o acad[eé]mico/i.test(s)) ?? ''
  const partes = titulo.match(/\sal\s+(\d{2})-(\d{2})-(\d{4})/i)
  if (!partes) throw new Error('No se encontró la fecha “…al DD-MM-AAAA” en el encabezado.')
  const fecha = `${partes[3]}-${partes[2]}-${partes[1]}`
  const dia = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(dia.getTime()) || dia.toISOString().slice(0, 10) !== fecha) throw new Error('La fecha del archivo no es válida.')
  const tri = titulo.match(/\b([123])\s*(?:er|ro|do|to|º|°)?\s+trimestre/i)
  if (!tri) throw new Error('No se encontró el trimestre (1er, 2do o 3er) en el encabezado.')
  const cicloTexto = filas.slice(0, 8).flat().map(String).find((s) => /^ciclo lectivo:\s*\d{4}/i.test(s.trim()))
  if (!cicloTexto) throw new Error('No se encontró el ciclo lectivo en el encabezado.')
  const ciclo = Number(cicloTexto.match(/(\d{4})/)![1])

  const cabecera = filas.findIndex((r) => normalizar(String(r[0] ?? '')) === 'distrito' && normalizar(String(r[4] ?? '')) === 'clave provincial')
  if (cabecera < 0) throw new Error('No se encontró el encabezado de escuelas del CSV.')
  const h = filas[cabecera].map((v) => normalizar(String(v)))
  const anioCol = h.findIndex((v) => v === 'ano de estudio')
  const matriculaCol = h.findIndex((v) => v === 'matricula')
  const cols = CATEGORIAS_DESEMPENO.map((c) => ({ key: c.key, col: h.findIndex((v) => v.startsWith(c.encabezado) && v.includes('(cant.)')) }))
  if (anioCol < 0 || matriculaCol < 0 || cols.some((c) => c.col < 0)) throw new Error('Las columnas del CSV no coinciden con el formato esperado de ABC.')
  const numero = (v: unknown, linea: number): number | null => {
    const s = String(v ?? '').trim()
    if (!s) return null
    if (!/^\d+$/.test(s) || Number(s) > 2147483647) throw new Error(`Valor inválido en la fila ${linea}.`)
    return Number(s)
  }
  const resultado: Desempeno[] = []
  const vistos = new Set<string>()
  for (let i = cabecera + 1; i < filas.length; i++) {
    const r = filas[i]
    const clave = String(r[4] ?? '').trim()
    if (!clave && !String(r[0] ?? '').trim()) break
    if (!/^\d{4}[A-Za-z]{2}\d{4}$/.test(clave)) throw new Error(`Clave de escuela inválida en la fila ${i + 1}.`)
    const anio = String(r[anioCol] ?? '').trim()
    if (!anio) throw new Error(`Falta el año de estudio en la fila ${i + 1}.`)
    if (vistos.has(`${clave}|${anio}`)) throw new Error(`El año ${anio} de la escuela ${clave} está repetido en el archivo.`)
    vistos.add(`${clave}|${anio}`)
    const fila = { clave, anio, matricula: numero(r[matriculaCol], i + 1) } as Desempeno
    for (const c of cols) fila[c.key] = numero(r[c.col], i + 1)
    resultado.push(fila)
  }
  if (!resultado.length) throw new Error('El CSV no contiene escuelas.')
  return { fecha, ciclo, trimestre: Number(tri[1]), filas: resultado }
}

export const nombreTrimestre = (t: number) => `${t}${t === 1 ? 'er' : t === 2 ? 'do' : 'er'} trimestre`
