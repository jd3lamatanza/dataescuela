import { useEffect, useState } from 'preact/hooks'

/** Router por hash (#/ruta?x=1): compatible con GitHub Pages sin configuración de servidor. */
const read = () => {
  const h = location.hash.replace(/^#/, '') || '/'
  const [path, query = ''] = h.split('?')
  return { path: path || '/', params: new URLSearchParams(query) }
}

export function useRoute() {
  const [r, setR] = useState(read)
  useEffect(() => {
    const on = () => setR(read())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return r
}

export const go = (to: string) => { location.hash = to }
export const href = (to: string) => '#' + to

/** Actualiza parámetros de la URL actual (filtros/paginación) sin apilar historial. */
export function setParams(patch: Record<string, string | number | null | undefined>) {
  const { path, params } = read()
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') params.delete(k)
    else params.set(k, String(v))
  }
  const q = params.toString()
  location.replace('#' + path + (q ? '?' + q : ''))
}
