/** Chart maths: nice axis ticks and value coercion. */

export type ChartKind = 'bar' | 'line' | 'scatter'

/** "Nice" axis ticks (1, 2, 5 × 10^k steps) covering [min, max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) {
    const d = min === 0 ? 1 : Math.abs(min) * 0.1
    min -= d
    max += d
  }
  const raw = (max - min) / Math.max(1, target)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let k = 0; k < 1000; k++) {
    const v = Number((start + k * step).toPrecision(12))
    ticks.push(v)
    if (v >= max - step * 1e-9) break
  }
  return ticks
}

/** Converts a cell to a finite number, or null. Accepts bigint, numeric strings and Dates. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'bigint') return Number(v)
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Compact number label: 1200 → 1.2k, 0.00012 → 1.2e-4. */
export function shortNum(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `${trim(n / 1e9)}B`
  if (a >= 1e6) return `${trim(n / 1e6)}M`
  if (a >= 1e4) return `${trim(n / 1e3)}k`
  if (a !== 0 && a < 1e-3) return n.toExponential(1)
  return trim(n)
}

function trim(n: number): string {
  return String(Number(n.toFixed(2)))
}
