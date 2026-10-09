import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { query } from '../db'
import { buildPageQuery, formatCell, isNumericType, type ViewSpec } from '../lib/sql'
import { useT } from '../useT'

const ROW_H = 26
const HEAD_H = 64
const COL_W = 168
const BLOCK = 200
const MAX_SCROLL_PX = 8_000_000

interface Props {
  spec: ViewSpec & { columns: { name: string; type: string }[] }
  total: number
  onSort: (column: string) => void
  onFilter: (column: string, value: string) => void
  onError: (msg: string) => void
}

export default function ResultsGrid({ spec, total, onSort, onFilter, onError }: Props) {
  const t = useT()
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(400)
  const [pages, setPages] = useState<{ key: string; map: Map<number, unknown[][]> }>({ key: '', map: new Map() })
  const inflight = useRef(new Set<number>())
  const { columns } = spec

  // Pages depend on sql, sort and filters, not on column widths.
  const key = useMemo(() => JSON.stringify([spec.sql, spec.sort, spec.filters]), [spec.sql, spec.sort, spec.filters])
  const keyRef = useRef(key)
  useEffect(() => {
    keyRef.current = key
    inflight.current = new Set()
  }, [key])
  const cached = pages.key === key ? pages.map : undefined

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const bodyH = Math.min(total * ROW_H, MAX_SCROLL_PX)
  const bodyViewH = Math.max(ROW_H, viewH - HEAD_H)
  const visRows = Math.ceil(bodyViewH / ROW_H) + 1
  const scaled = total * ROW_H > MAX_SCROLL_PX
  let first: number
  if (scaled) {
    const frac = Math.min(1, scrollTop / Math.max(1, bodyH - bodyViewH))
    first = Math.floor(frac * Math.max(0, total - visRows + 1))
  } else first = Math.floor(scrollTop / ROW_H)
  first = Math.max(0, Math.min(first, Math.max(0, total - 1)))
  const last = Math.min(total, first + visRows + 1)
  const offsetTop = scaled ? scrollTop : first * ROW_H

  const load = useCallback(
    (block: number) => {
      if (inflight.current.has(block)) return
      const myKey = keyRef.current
      inflight.current.add(block)
      query(buildPageQuery(spec, BLOCK, block * BLOCK)).then(
        (r) => {
          if (keyRef.current !== myKey) return
          inflight.current.delete(block)
          setPages((p) => ({ key: myKey, map: new Map(p.key === myKey ? p.map : []).set(block, r.rows) }))
        },
        (e: unknown) => {
          if (keyRef.current !== myKey) return
          inflight.current.delete(block)
          onError(e instanceof Error ? e.message : String(e))
        },
      )
    },
    [spec, onError],
  )

  const firstBlock = Math.floor(first / BLOCK)
  const lastBlock = Math.floor(Math.max(first, last - 1) / BLOCK)
  useEffect(() => {
    if (total === 0) return
    const id = setTimeout(() => {
      for (let b = firstBlock; b <= lastBlock; b++) if (!cached?.has(b)) load(b)
    }, 30)
    return () => clearTimeout(id)
  }, [firstBlock, lastBlock, load, total, cached])

  const width = columns.length * COL_W + 56
  const rows = []
  for (let i = first; i < last; i++) {
    const row = cached?.get(Math.floor(i / BLOCK))?.[i % BLOCK]
    rows.push(
      <div className="grow" key={i} style={{ top: (i - first) * ROW_H, height: ROW_H }}>
        <span className="rownum" style={{ width: 56 }}>
          {i + 1}
        </span>
        {columns.map((c, ci) => {
          const v = row?.[ci]
          const text = row ? formatCell(v) : ''
          return (
            <span key={ci} className={`gcell${isNumericType(c.type) ? ' num' : ''}${row && v == null ? ' null' : ''}`} style={{ width: COL_W }} title={text}>
              {row ? (v == null ? 'NULL' : text) : '…'}
            </span>
          )
        })}
      </div>,
    )
  }

  return (
    <div className="grid" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="table" aria-rowcount={total}>
      <div className="ghead" style={{ width, height: HEAD_H }} role="row">
        <span className="rownum" style={{ width: 56 }} />
        {columns.map((c) => {
          const sorted = spec.sort?.column === c.name ? (spec.sort.desc ? '▼' : '▲') : ''
          return (
            <div key={c.name} className="hcell" style={{ width: COL_W }} role="columnheader">
              <button className="link hname" title={t('Click to sort')} onClick={() => onSort(c.name)}>
                <span className="n">{c.name}</span>
                <span className="sort">{sorted}</span>
              </button>
              <span className="ctype">{c.type}</span>
              <input
                className="hfilter"
                aria-label={`${t('Filter')} ${c.name}`}
                placeholder={t('Filter')}
                defaultValue={spec.filters?.[c.name] ?? ''}
                onChange={(e) => onFilter(c.name, e.target.value)}
              />
            </div>
          )
        })}
      </div>
      <div style={{ height: bodyH, width, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>{rows}</div>
      </div>
      {total === 0 && <div className="empty">{t('No rows.')}</div>}
    </div>
  )
}
