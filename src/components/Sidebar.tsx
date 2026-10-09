import { useEffect, useState } from 'react'
import { query, type CatalogTable } from '../db'
import { shortNum } from '../lib/chart'
import { buildHistogramQuery, buildStatsQuery, buildTopValuesQuery, isNumericType, quoteIdent } from '../lib/sql'
import { useT } from '../useT'

interface Stats {
  total: number
  nonNull: number
  distinct: number
  min: string | null
  max: string | null
  mean: number | null
}
interface Profile {
  stats: Stats
  bars: { label: string; n: number }[]
  numeric: boolean
}

async function runProfile(table: string, column: string, type: string): Promise<Profile> {
  const r = (await query(buildStatsQuery(table, column, type))).rows[0]
  const stats: Stats = {
    total: Number(r[0]),
    nonNull: Number(r[1]),
    distinct: Number(r[2]),
    min: r[3] == null ? null : String(r[3]),
    max: r[4] == null ? null : String(r[4]),
    mean: r[5] == null ? null : Number(r[5]),
  }
  const numeric = isNumericType(type)
  const lo = Number(stats.min)
  const hi = Number(stats.max)
  if (numeric && stats.nonNull > 0 && Number.isFinite(lo) && Number.isFinite(hi)) {
    const bins = 20
    const rows = (await query(buildHistogramQuery(table, column, bins, lo, hi))).rows
    const counts = new Array<number>(bins).fill(0)
    for (const [b, n] of rows) counts[Math.min(bins - 1, Number(b))] += Number(n)
    const w = (hi - lo) / bins
    return { stats, numeric, bars: counts.map((n, i) => ({ label: `${shortNum(lo + i * w)} – ${shortNum(lo + (i + 1) * w)}`, n })) }
  }
  const rows = (await query(buildTopValuesQuery(table, column, 8))).rows
  return { stats, numeric, bars: rows.map(([v, n]) => ({ label: String(v), n: Number(n) })) }
}

function ProfileView({ table, column, type }: { table: string; column: string; type: string }) {
  const t = useT()
  const [p, setP] = useState<Profile | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    runProfile(table, column, type).then(
      (r) => live && setP(r),
      (e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [table, column, type])
  if (err) return <div className="profile err">{err}</div>
  if (!p) return <div className="profile muted">{t('Profiling…')}</div>
  const s = p.stats
  const max = Math.max(1, ...p.bars.map((b) => b.n))
  const pct = s.total ? ((s.total - s.nonNull) / s.total) * 100 : 0
  return (
    <div className="profile">
      <dl>
        <dt>{t('Count')}</dt>
        <dd>{s.total.toLocaleString()}</dd>
        <dt>{t('Nulls')}</dt>
        <dd>
          {(s.total - s.nonNull).toLocaleString()} ({pct.toFixed(pct < 10 && pct > 0 ? 1 : 0)}%)
        </dd>
        <dt>{t('Distinct')}</dt>
        <dd>{s.distinct.toLocaleString()}</dd>
        <dt>{t('Min')}</dt>
        <dd title={s.min ?? ''}>{s.min ?? '—'}</dd>
        <dt>{t('Max')}</dt>
        <dd title={s.max ?? ''}>{s.max ?? '—'}</dd>
        {s.mean !== null && (
          <>
            <dt>{t('Mean')}</dt>
            <dd>{Number(s.mean.toPrecision(6))}</dd>
          </>
        )}
      </dl>
      {p.bars.length > 0 && (
        <>
          <div className="muted small-label">{p.numeric ? t('Histogram') : t('Top values')}</div>
          <div className={p.numeric ? 'hist' : 'tops'}>
            {p.bars.map((b, i) =>
              p.numeric ? (
                <span key={i} className="bar" style={{ height: `${(b.n / max) * 100}%` }} title={`${b.label}: ${b.n.toLocaleString()}`} />
              ) : (
                <div key={i} className="top" title={`${b.label}: ${b.n.toLocaleString()}`}>
                  <span className="fill" style={{ width: `${(b.n / max) * 100}%` }} />
                  <span className="lbl">{b.label}</span>
                  <span className="cnt">{b.n.toLocaleString()}</span>
                </div>
              ),
            )}
          </div>
          {p.numeric && (
            <div className="hist-axis">
              <span>{shortNum(Number(s.min))}</span>
              <span>{shortNum(Number(s.max))}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface Props {
  tables: CatalogTable[]
  onPreview: (table: string) => void
  onInsert: (text: string) => void
  onDrop: (table: CatalogTable) => void
}

export default function Sidebar({ tables, onPreview, onInsert, onDrop }: Props) {
  const t = useT()
  const [openCol, setOpenCol] = useState<string | null>(null)
  if (tables.length === 0) return <p className="muted pad">{t('No tables yet. Open a file or load the sample dataset.')}</p>
  return (
    <ul className="tables">
      {tables.map((tb) => (
        <li key={tb.name}>
          <div className="tname">
            <button className="link name" title={t('Insert table name')} onClick={() => onInsert(quoteIdent(tb.name))}>
              <span className="kind">{tb.isView ? t('view') : t('table')}</span> {tb.name}
            </button>
            <button className="small" title={t('Preview table')} onClick={() => onPreview(tb.name)}>
              ▶
            </button>
            <button className="small danger" title={t('Drop')} aria-label={t('Drop')} onClick={() => onDrop(tb)}>
              ✕
            </button>
          </div>
          <ul className="cols">
            {tb.columns.map((c) => {
              const id = `${tb.name}\u0000${c.name}`
              const open = openCol === id
              return (
                <li key={c.name}>
                  <button className={`col${open ? ' open' : ''}`} aria-expanded={open} onClick={() => setOpenCol(open ? null : id)} onDoubleClick={() => onInsert(quoteIdent(c.name))}>
                    <span className="cname">{c.name}</span>
                    <span className="ctype">{c.type}</span>
                  </button>
                  {open && <ProfileView table={tb.name} column={c.name} type={c.type} />}
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )
}
