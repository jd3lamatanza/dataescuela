export interface Dato { label: string; value: number; color: string }
const fmt = (n: number) => n.toLocaleString('es-AR')
const pct = (n: number, t: number) => t ? `${(n * 100 / t).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%` : '—'

export function Leyenda({ datos, total }: { datos: Dato[]; total?: number }) {
  const t = total ?? datos.reduce((s, d) => s + d.value, 0)
  return <ul class="space-y-1 text-sm">
    {datos.map((d) => <li key={d.label} class="flex items-center gap-2">
      <span class="h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} />
      <span class="min-w-0 flex-1 truncate text-slate-700">{d.label}</span>
      <span class="font-semibold tabular-nums">{fmt(d.value)}</span>
      <span class="w-14 text-right text-xs tabular-nums text-slate-500">{pct(d.value, t)}</span>
    </li>)}
  </ul>
}

export function Torta({ datos, centro, etiqueta }: { datos: Dato[]; centro?: string; etiqueta?: string }) {
  const total = datos.reduce((s, d) => s + d.value, 0)
  const r = 15.9155
  let acumulado = 0
  return <div class="flex flex-col items-center gap-3 sm:flex-row">
    <svg viewBox="0 0 42 42" class="h-36 w-36 shrink-0" role="img" aria-label={etiqueta ?? 'Gráfico de torta'}>
      <circle cx="21" cy="21" r={r} fill="none" stroke="#e2e8f0" stroke-width="6" />
      {total > 0 && datos.filter((d) => d.value > 0).map((d) => {
        const largo = d.value * 100 / total
        const el = <circle key={d.label} cx="21" cy="21" r={r} fill="none" stroke={d.color} stroke-width="6" stroke-dasharray={`${largo} ${100 - largo}`} stroke-dashoffset={25 - acumulado} />
        acumulado += largo
        return el
      })}
      {centro && <text x="21" y="22.5" text-anchor="middle" font-size="5.5" font-weight="700" fill="#0f172a">{centro}</text>}
    </svg>
    <div class="w-full min-w-0 flex-1"><Leyenda datos={datos} total={total} /></div>
  </div>
}

export function Barras({ datos, total, sufijo = '' }: { datos: Dato[]; total?: number; sufijo?: string }) {
  const max = Math.max(...datos.map((d) => d.value), 1)
  return <ul class="space-y-2.5">
    {datos.map((d) => <li key={d.label}>
      <div class="flex items-baseline justify-between gap-2 text-sm"><span class="min-w-0 truncate text-slate-700">{d.label}</span>
        <span class="shrink-0 font-semibold tabular-nums">{fmt(d.value)}{sufijo}{total !== undefined && <span class="ml-1.5 text-xs font-normal text-slate-500">{pct(d.value, total)}</span>}</span></div>
      <div class="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full" style={{ width: `${d.value * 100 / max}%`, background: d.color }} /></div>
    </li>)}
  </ul>
}

export function Apilada({ datos }: { datos: Dato[] }) {
  const total = datos.reduce((s, d) => s + d.value, 0)
  return <div>
    <div class="flex h-4 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={datos.map((d) => `${d.label} ${d.value}`).join(', ')}>
      {total > 0 && datos.map((d) => <div key={d.label} style={{ width: `${d.value * 100 / total}%`, background: d.color }} />)}
    </div>
    <div class="mt-3"><Leyenda datos={datos} total={total} /></div>
  </div>
}

export interface Serie { label: string; color: string; puntos: (number | null)[] }
export function Lineas({ etiquetas, series, sufijo = '%' }: { etiquetas: string[]; series: Serie[]; sufijo?: string }) {
  const W = 300, H = 140, L = 30, B = 22, T = 10
  const valores = series.flatMap((s) => s.puntos).filter((v): v is number => v !== null)
  const max = Math.max(...valores, 1)
  const techo = Math.ceil(max / 10) * 10 || 10
  const x = (i: number) => L + (etiquetas.length < 2 ? (W - L) / 2 : i * (W - L - 10) / (etiquetas.length - 1))
  const y = (v: number) => T + (H - T - B) * (1 - v / techo)
  return <div>
    <svg viewBox={`0 0 ${W} ${H}`} class="w-full" role="img" aria-label="Gráfico de líneas">
      {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W} y1={y(techo * f)} y2={y(techo * f)} stroke="#e2e8f0" /><text x={L - 4} y={y(techo * f) + 3} text-anchor="end" font-size="8" fill="#64748b">{Math.round(techo * f)}{sufijo}</text></g>)}
      {etiquetas.map((e, i) => <text key={e} x={x(i)} y={H - 6} text-anchor="middle" font-size="8" fill="#64748b">{e}</text>)}
      {series.map((s) => {
        const pts = s.puntos.map((v, i) => v === null ? null : [x(i), y(v), v] as const)
        const trazo = pts.filter((p) => p !== null).map((p) => `${p![0]},${p![1]}`).join(' ')
        return <g key={s.label}>
          <polyline points={trazo} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" />
          {pts.map((p, i) => p && <g key={i}><circle cx={p[0]} cy={p[1]} r="3" fill={s.color} /><text x={p[0]} y={p[1] - 6} text-anchor="middle" font-size="8" font-weight="600" fill="#0f172a">{p[2].toLocaleString('es-AR', { maximumFractionDigits: 1 })}</text></g>)}
        </g>
      })}
    </svg>
    <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{series.map((s) => <span key={s.label} class="flex items-center gap-1.5"><span class="h-2 w-4 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}</div>
  </div>
}
