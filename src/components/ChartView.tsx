import { useEffect, useMemo, useState } from 'react'
import { query } from '../db'
import { niceTicks, shortNum, toNumber, type ChartKind } from '../lib/chart'
import { buildPageQuery, isNumericType, isTemporalType, type ViewSpec } from '../lib/sql'
import { useT } from '../useT'

const MAX_POINTS = 2000
const MAX_BARS = 40
const W = 860
const H = 380
const M = { l: 64, r: 16, t: 14, b: 70 }

interface Props {
  spec: ViewSpec & { columns: { name: string; type: string }[] }
  total: number
}

export default function ChartView({ spec, total }: Props) {
  const t = useT()
  const cols = spec.columns
  const numeric = cols.filter((c) => isNumericType(c.type))
  const [kind, setKind] = useState<ChartKind>('bar')
  const [x, setX] = useState(() => (cols.find((c) => !isNumericType(c.type)) ?? cols[0])?.name ?? '')
  const [y, setY] = useState(() => (numeric.find((c) => c.name !== x) ?? numeric[0])?.name ?? '')
  const [data, setData] = useState<unknown[][] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    setData(null)
    setErr('')
    // Only the two plotted columns, taken from the sorted and filtered view.
    const sel = { ...spec, columns: cols.filter((c) => c.name === x || c.name === y) }
    if (!x || !y || sel.columns.length === 0) return
    query(buildPageQuery(sel, MAX_POINTS, 0)).then(
      (r) => live && setData(r.rows.map((row) => (x === y ? [row[0], row[0]] : sel.columns[0].name === x ? row : [row[1], row[0]]))),
      (e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
    // oxlint-disable-next-line react/exhaustive-deps
  }, [spec.sql, spec.sort, spec.filters, x, y])

  const pts = useMemo(() => {
    if (!data) return []
    const xType = cols.find((c) => c.name === x)?.type ?? ''
    const out: { label: string; xv: number | null; yv: number }[] = []
    for (const [xr, yr] of data) {
      const yv = toNumber(yr)
      if (yv === null) continue
      let xv = toNumber(xr)
      if (xv === null && isTemporalType(xType) && typeof xr === 'string') {
        const d = Date.parse(xr)
        xv = Number.isNaN(d) ? null : d
      }
      out.push({ label: xr == null ? 'NULL' : String(xr), xv, yv })
    }
    return out
  }, [data, cols, x])

  if (numeric.length === 0) return <p className="muted pad">{t('Charts need at least one numeric column.')}</p>

  const shown = kind === 'bar' ? pts.slice(0, MAX_BARS) : pts
  const scatterOk = kind !== 'scatter' || shown.every((p) => p.xv !== null)
  const ys = shown.map((p) => p.yv)
  const yMin = Math.min(0, ...ys)
  const yMax = Math.max(0, ...ys)
  const yTicks = niceTicks(yMin, yMax, 5)
  const y0 = yTicks[0] ?? 0
  const y1 = yTicks[yTicks.length - 1] ?? 1
  const iw = W - M.l - M.r
  const ih = H - M.t - M.b
  const sy = (v: number) => M.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih

  let body: React.ReactNode = null
  let xTicks: { pos: number; label: string }[] = []
  if (shown.length > 0 && scatterOk) {
    if (kind === 'scatter') {
      const xs = shown.map((p) => p.xv as number)
      const tk = niceTicks(Math.min(...xs), Math.max(...xs), 6)
      const x0 = tk[0] ?? 0
      const x1 = tk[tk.length - 1] ?? 1
      const sx = (v: number) => M.l + ((v - x0) / (x1 - x0 || 1)) * iw
      xTicks = tk.map((v) => ({ pos: sx(v), label: shortNum(v) }))
      body = shown.map((p, i) => (
        <circle key={i} cx={sx(p.xv as number)} cy={sy(p.yv)} r={3} className="pt">
          <title>{`${p.label}, ${p.yv}`}</title>
        </circle>
      ))
    } else {
      const n = shown.length
      const step = iw / n
      const every = Math.ceil(n / 12)
      xTicks = shown.map((p, i) => ({ pos: M.l + step * (i + 0.5), label: i % every === 0 ? p.label : '' }))
      if (kind === 'bar') {
        const bw = Math.max(1, step * 0.7)
        body = shown.map((p, i) => (
          <rect key={i} x={M.l + step * (i + 0.5) - bw / 2} y={Math.min(sy(p.yv), sy(0))} width={bw} height={Math.abs(sy(p.yv) - sy(0))} className="pt-bar">
            <title>{`${p.label}: ${p.yv}`}</title>
          </rect>
        ))
      } else {
        const d = shown.map((p, i) => `${i ? 'L' : 'M'}${(M.l + step * (i + 0.5)).toFixed(1)},${sy(p.yv).toFixed(1)}`).join('')
        body = (
          <>
            <path d={d} className="line" fill="none" />
            {n <= 100 && shown.map((p, i) => <circle key={i} cx={M.l + step * (i + 0.5)} cy={sy(p.yv)} r={2.5} className="pt"><title>{`${p.label}: ${p.yv}`}</title></circle>)}
          </>
        )
      }
    }
  }

  const colOptions = (list: { name: string }[]) => list.map((c) => <option key={c.name}>{c.name}</option>)
  return (
    <div className="chart">
      <div className="chart-ctl">
        <label>
          {t('Type')}{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value as ChartKind)}>
            <option value="bar">{t('Bar')}</option>
            <option value="line">{t('Line')}</option>
            <option value="scatter">{t('Scatter')}</option>
          </select>
        </label>
        <label>
          X <select value={x} onChange={(e) => setX(e.target.value)}>{colOptions(cols)}</select>
        </label>
        <label>
          Y <select value={y} onChange={(e) => setY(e.target.value)}>{colOptions(numeric)}</select>
        </label>
        <span className="muted">
          {kind === 'bar' && pts.length > MAX_BARS
            ? t('First {0} bars of {1} rows.', MAX_BARS, total.toLocaleString())
            : total > MAX_POINTS
              ? t('First {0} of {1} rows.', MAX_POINTS, total.toLocaleString())
              : ''}
        </span>
      </div>
      {err && <p className="err pad">{err}</p>}
      {!scatterOk && <p className="muted pad">{t('Scatter needs a numeric X column.')}</p>}
      {data && shown.length === 0 && scatterOk && <p className="muted pad">{t('Nothing to plot.')}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Chart of the results')} className="chart-svg">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} className="gridline" />
            <text x={M.l - 6} y={sy(v) + 4} textAnchor="end" className="axis">
              {shortNum(v)}
            </text>
          </g>
        ))}
        {xTicks.map((tk, i) =>
          tk.label ? (
            <text key={i} className="axis" textAnchor="end" transform={`translate(${tk.pos},${H - M.b + 14}) rotate(-35)`}>
              {tk.label.length > 16 ? `${tk.label.slice(0, 15)}…` : tk.label}
            </text>
          ) : null,
        )}
        <line x1={M.l} x2={W - M.r} y1={sy(0)} y2={sy(0)} className="axisline" />
        {body}
      </svg>
    </div>
  )
}
