import type { CategoriaFicha, FichaInscripcion } from './estadisticaFichas'

export type RegistroAsistencia = {
  clave: string; fecha: string; ciclo: number | null; matricula: number | null
  de_28_44: number | null; mas_45: number | null
}
export type RegistroDesempeno = {
  clave: string; fecha: string; ciclo: number; trimestre: number; matricula: number | null
  de_3_4: number | null; mas_5: number | null; ninguna: number | null
}

export function porcentaje(n: number | null, base: number | null): number | null {
  return n === null || base === null || base <= 0 ? null : n * 100 / base
}

export function deficitMatricula(activa: number | null, inicial: number | null): number | null {
  if (activa === null || inicial === null || inicial <= 0) return null
  return Math.max(0, inicial - activa) * 100 / inicial
}

export function completamiento(f: FichaInscripcion | undefined, categorias: readonly { key: CategoriaFicha }[]): number | null {
  if (!f || f.matricula === null || f.matricula <= 0) return null
  const matricula = f.matricula
  const faltantes = categorias.map((c) => f[c.key])
  if (!faltantes.length) return null
  if (faltantes.some((v) => v === null || v > matricula)) return null
  return 100 - faltantes.reduce<number>((s, v) => s + (v ?? 0), 0) * 100 / (matricula * faltantes.length)
}

export function porcentajeAgregado<T>(
  filas: T[], numeradores: (keyof T)[], denominador: keyof T,
): number | null {
  if (!filas.length) return null
  let numerador = 0, base = 0
  for (const f of filas) {
    const d = f[denominador]
    if (typeof d !== 'number') return null
    base += d
    for (const campo of numeradores) {
      const valor = f[campo]
      if (typeof valor !== 'number') return null
      numerador += valor
    }
  }
  return porcentaje(numerador, base)
}

export function correlacion(pares: readonly (readonly [number, number])[]): number | null {
  if (pares.length < 3) return null
  const mx = pares.reduce((s, p) => s + p[0], 0) / pares.length
  const my = pares.reduce((s, p) => s + p[1], 0) / pares.length
  let xy = 0, xx = 0, yy = 0
  for (const [x, y] of pares) {
    xy += (x - mx) * (y - my)
    xx += (x - mx) ** 2
    yy += (y - my) ** 2
  }
  return xx === 0 || yy === 0 ? null : Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)))
}

export function prioridadConjunta(pares: readonly (readonly [number | null, number | null])[], menorX = false): (number | null)[] {
  const completos = pares.map(([x, y], i) => ({ x, y, i }))
    .filter((p): p is { x: number; y: number; i: number } => p.x !== null && p.y !== null)
  const rangos = (campo: 'x' | 'y', menor: boolean) => {
    const orden = [...completos].sort((a, b) => menor ? a[campo] - b[campo] : b[campo] - a[campo])
    const resultado = new Map<number, number>()
    for (let i = 0; i < orden.length;) {
      let fin = i + 1
      while (fin < orden.length && orden[fin][campo] === orden[i][campo]) fin++
      const rango = (i + fin - 1) / 2
      for (let j = i; j < fin; j++) resultado.set(orden[j].i, rango)
      i = fin
    }
    return resultado
  }
  const rx = rangos('x', menorX), ry = rangos('y', false)
  return pares.map((_, i) => rx.has(i) && ry.has(i) ? (rx.get(i)! + ry.get(i)!) / 2 : null)
}
