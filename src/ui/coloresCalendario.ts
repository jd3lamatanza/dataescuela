// Clases completas para que Tailwind las detecte.
const COLORS: Record<string, { dot: string; chip: string; card: string }> = {
  green: { dot: 'bg-green-500', chip: 'bg-green-100 text-green-800', card: 'border-green-200 bg-green-50 text-green-700' },
  blue: { dot: 'bg-blue-500', chip: 'bg-blue-100 text-blue-800', card: 'border-blue-200 bg-blue-50 text-blue-700' },
  orange: { dot: 'bg-orange-500', chip: 'bg-orange-100 text-orange-800', card: 'border-orange-200 bg-orange-50 text-orange-700' },
  red: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-800', card: 'border-red-200 bg-red-50 text-red-700' },
  cyan: { dot: 'bg-cyan-500', chip: 'bg-cyan-100 text-cyan-800', card: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  violet: { dot: 'bg-violet-500', chip: 'bg-violet-100 text-violet-800', card: 'border-violet-200 bg-violet-50 text-violet-700' },
  amber: { dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800', card: 'border-amber-200 bg-amber-50 text-amber-700' },
  slate: { dot: 'bg-slate-500', chip: 'bg-slate-100 text-slate-800', card: 'border-slate-200 bg-slate-50 text-slate-700' },
}
export const col = (c?: string) => COLORS[c ?? ''] ?? COLORS.slate
