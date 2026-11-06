export const NIVELES_SALIDAS = [
  { id: 'inicial', label: 'Inicial' },
  { id: 'primario', label: 'Primario' },
  { id: 'secundario', label: 'Secundario' },
] as const
export type NivelSalidas = typeof NIVELES_SALIDAS[number]['id']

export interface SalidaSinIngreso {
  clave: string
  nombre: string
  apellido: string
  dni: string
  turno: string
  anio: string
  seccion: string
  estado: string
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

// Acepta también la grafía "inical" que aparece en pedidos de usuarios.
export function nivelDesdeNombre(nombre: string): NivelSalidas | null {
  const n = normalizar(nombre)
  const hallados = NIVELES_SALIDAS.filter((x) => n.includes(x.id) || (x.id === 'inicial' && n.includes('inical')))
  return hallados.length === 1 ? hallados[0].id : null
}

export async function leerSalidasSinIngreso(texto: string): Promise<{ fecha: string; filas: SalidaSinIngreso[]; nivelTitulo: NivelSalidas | null }> {
  const XLSX = await import('xlsx')
  const libro = XLSX.read(texto.replace(/^\uFEFF/, ''), { type: 'string', FS: ';', raw: true })
  const filas = XLSX.utils.sheet_to_json<string[]>(libro.Sheets[libro.SheetNames[0]], { header: 1, blankrows: true, defval: '', raw: true })
  const titulo = filas.slice(0, 7).map((r) => String(r[0] ?? '')).find((s) => /sin ingreso.*\sal\s+\d{2}-\d{2}-\d{4}/i.test(s))
  const partes = titulo?.match(/\sal\s+(\d{2})-(\d{2})-(\d{4})/i)
  if (!partes) throw new Error('No se encontró la fecha “… al DD-MM-AAAA” en el encabezado.')
  const fecha = `${partes[3]}-${partes[2]}-${partes[1]}`
  const dia = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(dia.getTime()) || dia.toISOString().slice(0, 10) !== fecha) throw new Error('La fecha del archivo no es válida.')

  const cabecera = filas.findIndex((r) => normalizar(String(r[0] ?? '')) === 'nombre' && normalizar(String(r[1] ?? '')) === 'apellido')
  if (cabecera < 0) throw new Error('No se encontró el encabezado de estudiantes del CSV.')
  const h = filas[cabecera].map((v) => normalizar(String(v)))
  const col = (t: string) => h.findIndex((v) => v === t)
  const idx = { nombre: col('nombre'), apellido: col('apellido'), dni: col('dni'), turno: col('turno'), anio: col('ano de estudio'),
    seccion: col('seccion'), clave: col('clave del establecimiento'), estado: col('estado de pase') }
  if (Object.values(idx).some((i) => i < 0)) throw new Error('Las columnas del CSV no coinciden con el formato esperado de ABC.')
  const resultado: SalidaSinIngreso[] = []
  for (let i = cabecera + 1; i < filas.length; i++) {
    const r = filas[i]
    const clave = String(r[idx.clave] ?? '').trim()
    if (!clave && !String(r[idx.nombre] ?? '').trim() && !String(r[idx.apellido] ?? '').trim()) break
    if (!/^\d{4}[A-Za-z]{2}\d{4}$/.test(clave)) throw new Error(`Clave de escuela inválida en la fila ${i + 1}.`)
    const t = (k: keyof typeof idx) => String(r[idx[k]] ?? '').trim()
    resultado.push({ clave, nombre: t('nombre'), apellido: t('apellido'), dni: t('dni'), turno: t('turno'), anio: t('anio'), seccion: t('seccion'), estado: t('estado') })
  }
  if (!resultado.length) throw new Error('El CSV no contiene estudiantes.')
  return { fecha, filas: resultado, nivelTitulo: nivelDesdeNombre(String(titulo)) }
}
