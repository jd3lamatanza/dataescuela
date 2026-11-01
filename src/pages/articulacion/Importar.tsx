import { useState } from 'preact/hooks'
import { supabase } from '../../lib/supabase'
import { parseNomina, type Nomina } from '../../lib/nomina'
import { Alert, BTN_PRIMARY, BTN_SECONDARY, Modal, toast } from '../../ui/kit'

type Clase = 'ok' | 'dni' | 'propio' | 'otra' | 'repetido'
const ETIQ: Record<Clase, string> = { ok: 'Para importar', dni: 'DNI inválido', propio: 'Ya cargado en tu escuela', otra: 'Cargado en otra escuela', repetido: 'Repetido en el archivo' }

export function ImportarNomina({ o, ciclo, onClose, onDone }: { o: { cue: string; clave: string }; ciclo: number; onClose(): void; onDone(): void }) {
  const [nom, setNom] = useState<Nomina | null>(null)
  const [cls, setCls] = useState<{ dni: string; nombre: string; curso: string; c: Clase; donde?: string }[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const leer = async (file: File) => {
    setErr(''); setNom(null); setBusy(true)
    try {
      const n = await parseNomina(await file.arrayBuffer())
      if (n.clave && n.clave !== o.clave && n.cue !== o.cue) throw new Error('El archivo corresponde a otra escuela')
      if (n.ciclo && n.ciclo !== ciclo) throw new Error(`El archivo es del ciclo ${n.ciclo} y estás cargando el ciclo ${ciclo}`)
      if (n.rows.length > 1500) throw new Error('El archivo supera las 1500 filas')
      const dnis = [...new Set(n.rows.map((r) => r.dni).filter((d) => /^\d{6,9}$/.test(d)))]
      const ub = new Map<string, { propio: boolean; donde: string }>()
      for (let i = 0; i < dnis.length; i += 500) {
        const r = await supabase.rpc('dnis_ubicacion', { p_ciclo: ciclo, p_dnis: dnis.slice(i, i + 500) })
        if (r.error) throw r.error
        for (const x of r.data as any[]) ub.set(x.dni, { propio: x.propio, donde: x.donde })
      }
      const visto = new Set<string>()
      setCls(n.rows.map((r) => {
        if (!/^\d{6,9}$/.test(r.dni)) return { ...r, c: 'dni' as Clase }
        const u = ub.get(r.dni)
        if (u) return { ...r, c: (u.propio ? 'propio' : 'otra') as Clase, donde: u.donde }
        if (visto.has(r.dni)) return { ...r, c: 'repetido' as Clase }
        visto.add(r.dni)
        return { ...r, c: 'ok' as Clase }
      }))
      setNom(n)
    } catch (e: any) { setErr(e.message ?? 'No se pudo leer el archivo') } finally { setBusy(false) }
  }

  const ok = cls.filter((r) => r.c === 'ok')
  const importar = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('egresantes_importar', { p_ciclo: ciclo, p_filas: ok.map(({ dni, nombre, curso }) => ({ dni, nombre, curso })) })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.ok(`${(data as any).insertados} estudiantes importados`); onDone(); onClose()
  }

  return (
    <Modal title={`Importar nómina · Ciclo ${ciclo}`} onClose={onClose} wide>
      <p class="mb-3 text-sm text-slate-600">Subí el reporte nominal de estudiantes (.xls, hasta 2 MB). Solo se importan los estudiantes nuevos; el destino se completa después.</p>
      <input type="file" accept=".xls,.xlsx" class="block w-full text-sm" disabled={busy} onChange={(e) => e.currentTarget.files?.[0] && leer(e.currentTarget.files[0])} />
      {err && <div class="mt-3"><Alert tone="error">{err}</Alert></div>}
      {nom && (
        <div class="mt-4 space-y-3 text-sm">
          <p>{cls.length} estudiantes en el archivo{nom.bajas ? ` (${nom.bajas} bajas omitidas)` : ''}.</p>
          <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(ETIQ) as Clase[]).map((k) => <li key={k} class="rounded-md border border-slate-200 p-2"><b>{cls.filter((r) => r.c === k).length}</b> <span class="text-slate-600">{ETIQ[k]}</span></li>)}
          </ul>
          {cls.some((r) => r.c === 'otra') && (
            <details class="text-xs"><summary class="cursor-pointer text-slate-600">Ver DNI cargados en otras escuelas</summary>
              <ul class="mt-1 space-y-0.5">{cls.filter((r) => r.c === 'otra').slice(0, 50).map((r) => <li key={r.dni}>{r.dni} · {r.nombre} → {r.donde}</li>)}</ul></details>
          )}
          <div class="flex justify-end gap-2"><button class={BTN_SECONDARY} onClick={onClose}>Cancelar</button><button class={BTN_PRIMARY} disabled={busy || !ok.length} onClick={importar}>Importar {ok.length}</button></div>
        </div>
      )}
    </Modal>
  )
}
