export interface SinCierre { clave: string; sin_cierre: number | null }

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export async function leerSinCierre(texto: string): Promise<{ fecha: string; filas: SinCierre[] }> {
  const XLSX = await import('xlsx')
  const libro = XLSX.read(texto.replace(/^\uFEFF/, ''), { type: 'string', FS: ';', raw: true })
  const filas = XLSX.utils.sheet_to_json<string[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, blankrows: true, defval: '', raw: true })
  const titulo = filas.slice(0, 7).map((r) => String(r[0] ?? '')).find((s) => /inscripci[oó]n activa en a[nñ]os anteriores al\s+\d{2}-\d{2}-\d{4}/i.test(s))
  const partes = titulo?.match(/\sal\s+(\d{2})-(\d{2})-(\d{4})/i)
  if (!partes) throw new Error('No se encontró la fecha “…años anteriores al DD-MM-AAAA” en el encabezado.')
  const fecha = `${partes[3]}-${partes[2]}-${partes[1]}`
  const dia = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(dia.getTime()) || dia.toISOString().slice(0, 10) !== fecha) throw new Error('La fecha del archivo no es válida.')

  const cabecera = filas.findIndex((r) => normalizar(String(r[0] ?? '')) === 'clave del establecimiento')
  if (cabecera < 0) throw new Error('No se encontró el encabezado de escuelas del CSV.')
  const h = filas[cabecera].map((v) => normalizar(String(v)))
  if (!h[1]?.includes('cue') || !h[2]?.includes('nombre del establecimiento') || !h[3]?.includes('matricula sin cierre')) {
    throw new Error('Las columnas del CSV no coinciden con el formato esperado de ABC.')
  }
  const resultado: SinCierre[] = []
  const claves = new Set<string>()
  for (let i = cabecera + 1; i < filas.length; i++) {
    const r = filas[i]
    const clave = String(r[0] ?? '').trim()
    if (!clave) break
    if (!/^\d{4}[A-Za-z]{2}\d{4}$/.test(clave)) throw new Error(`Clave de escuela inválida en la fila ${i + 1}.`)
    if (claves.has(clave)) throw new Error(`La clave ${clave} está repetida en el archivo.`)
    claves.add(clave)
    const s = String(r[3] ?? '').trim()
    if (s && (!/^\d+$/.test(s) || Number(s) > 2147483647)) throw new Error(`Valor inválido en la fila ${i + 1}.`)
    resultado.push({ clave, sin_cierre: s ? Number(s) : null })
  }
  if (!resultado.length) throw new Error('El CSV no contiene escuelas.')
  return { fecha, filas: resultado }
}
