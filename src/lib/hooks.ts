import { useCallback, useEffect, useState } from 'preact/hooks'

/** Carga asincrónica con estado; `reload()` vuelve a ejecutar. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true)
    fn().then((d) => { if (live) { setData(d); setError(null) } })
      .catch((e) => { if (live) setError(e.message ?? String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [...deps, n])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return { data, error, loading, reload }
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}
