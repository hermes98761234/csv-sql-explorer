import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChartView from './components/ChartView'
import ResultsGrid from './components/ResultsGrid'
import Sidebar from './components/Sidebar'
import SqlEditor from './components/SqlEditor'
import { copyOut, getDb, loadCatalog, query, registerFile, type CatalogTable } from './db'
import { tr, type Lang, type T } from './i18n'
import { DEFAULT_QUERY, sampleSql } from './lib/sample'
import {
  buildCopyQuery,
  buildCountQuery,
  buildDescribeQuery,
  buildFullQuery,
  buildPageQuery,
  createFromFileSql,
  csvField,
  csvRows,
  detectFormat,
  isRowQuery,
  quoteIdent,
  splitStatements,
  tableNameFromFile,
  uniqueName,
  type ExportFormat,
  type ViewSpec,
} from './lib/sql'
import {
  loadHistory,
  loadQuery,
  loadSettings,
  pushHistory,
  saveHistory,
  saveQuery,
  saveSettings,
  type HistoryEntry,
  type LoadMode,
  type Settings,
  type Theme,
} from './settings'
import { TContext } from './useT'

interface RowResult {
  id: number
  sql: string
  columns: { name: string; type: string }[]
}
type Tab = 'table' | 'chart' | 'history'

const REPO = 'https://github.com/hermes98761234/csv-sql-explorer'
const EXPORT_PAGE = 20000

function download(data: BlobPart | BlobPart[], name: string, type: string) {
  const url = URL.createObjectURL(new Blob(Array.isArray(data) ? data : [data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const t: T = useCallback((s, ...a) => tr(settings.lang, s, ...a), [settings.lang])
  const [engine, setEngine] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [engineErr, setEngineErr] = useState('')
  const [tables, setTables] = useState<CatalogTable[]>([])
  const [sql, setSql] = useState(() => loadQuery(DEFAULT_QUERY))
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<RowResult | null>(null)
  const [sort, setSort] = useState<ViewSpec['sort']>(null)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [total, setTotal] = useState(0)
  const [tab, setTab] = useState<Tab>('table')
  const [sideOpen, setSideOpen] = useState(() => window.innerWidth > 800)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const runId = useRef(0)
  const filterTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => saveHistory(history), [history])
  useEffect(() => saveQuery(sql), [sql])
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = settings.theme
    root.lang = settings.lang
  }, [settings.theme, settings.lang])

  const refreshCatalog = useCallback(async () => setTables(await loadCatalog()), [])

  useEffect(() => {
    getDb().then(
      async () => {
        await refreshCatalog()
        setEngine('ready')
      },
      (e: unknown) => {
        setEngine('failed')
        setEngineErr(msg(e))
      },
    )
  }, [refreshCatalog])

  const spec: (ViewSpec & { columns: { name: string; type: string }[] }) | null = useMemo(
    () => (result ? { sql: result.sql, columns: result.columns, sort, filters } : null),
    [result, sort, filters],
  )

  const run = useCallback(
    async (text: string) => {
      const stmts = splitStatements(text)
      if (stmts.length === 0 || engine !== 'ready') return
      setBusy(t('Running…'))
      setError('')
      setNote('')
      const t0 = performance.now()
      let rows: number | null = null
      let failure = ''
      try {
        for (const s of stmts.slice(0, -1)) await query(s)
        const last = stmts[stmts.length - 1]
        if (isRowQuery(last)) {
          const d = await query(buildDescribeQuery(last))
          const columns = d.rows.map((r) => ({ name: String(r[0]), type: String(r[1]) }))
          const n = Number((await query(buildCountQuery({ sql: last }))).rows[0][0])
          setResult({ id: ++runId.current, sql: last, columns })
          setSort(null)
          setFilters({})
          setTotal(n)
          rows = n
          setTab((x) => (x === 'chart' ? x : 'table'))
        } else {
          await query(last)
          setResult(null)
          setNote(t('Statement executed.'))
        }
      } catch (e) {
        failure = msg(e)
        setError(failure)
      }
      const ms = Math.round(performance.now() - t0)
      setHistory((h) => pushHistory(h, { sql: text.trim(), at: Date.now(), ms, rows, error: failure || undefined }))
      try {
        await refreshCatalog()
      } catch {
        // catalog is informational
      }
      setBusy('')
    },
    [engine, refreshCatalog, t],
  )

  const runEditor = useCallback(() => void run(sql), [run, sql])

  const openFiles = useCallback(
    async (files: File[]) => {
      if (engine !== 'ready' || files.length === 0) return
      setBusy(t('Loading files…'))
      setError('')
      let taken = tables.map((x) => x.name)
      let lastTable = ''
      try {
        for (const file of files) {
          const format = detectFormat(file.name)
          if (!format) {
            setError(t('Unsupported file type: {0}', file.name))
            continue
          }
          const vname = `file_${Date.now()}_${file.name}`
          await registerFile(file, vname)
          const table = uniqueName(tableNameFromFile(file.name), taken)
          taken = [...taken, table]
          const as = pickMode(settings.loadMode, format)
          await query(createFromFileSql(table, vname, format, as))
          lastTable = table
        }
        await refreshCatalog()
      } catch (e) {
        setError(msg(e))
      }
      setBusy('')
      if (lastTable) {
        const q = `SELECT * FROM ${quoteIdent(lastTable)}`
        setSql(q)
        void run(q)
      }
    },
    [engine, tables, settings.loadMode, refreshCatalog, run, t],
  )

  const loadSample = useCallback(async () => {
    await run(sampleSql())
    setSql(DEFAULT_QUERY)
    await run(DEFAULT_QUERY)
  }, [run])

  const onSort = useCallback((column: string) => {
    setSort((s) => (s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true }))
  }, [])

  const onFilter = useCallback(
    (column: string, value: string) => {
      clearTimeout(filterTimer.current)
      filterTimer.current = setTimeout(async () => {
        if (!result) return
        const next = { ...filters, [column]: value }
        if (value === '') delete next[column]
        try {
          const n = Number((await query(buildCountQuery({ sql: result.sql, filters: next }))).rows[0][0])
          setFilters(next)
          setTotal(n)
        } catch (e) {
          setError(msg(e))
        }
      }, 300)
    },
    [result, filters],
  )

  const doExport = useCallback(
    async (format: ExportFormat) => {
      if (!spec) return
      setBusy(t('Exporting…'))
      setError('')
      try {
        if (format === 'csv') {
          const parts: string[] = [spec.columns.map((c) => csvField(c.name)).join(',') + '\r\n']
          for (let off = 0; ; off += EXPORT_PAGE) {
            const r = await query(buildPageQuery(spec, EXPORT_PAGE, off))
            parts.push(csvRows(r.rows))
            if (r.rows.length < EXPORT_PAGE) break
          }
          download(parts, 'results.csv', 'text/csv')
        } else {
          const file = `export_${Date.now()}.${format}`
          const buf = await copyOut(buildCopyQuery(buildFullQuery(spec), file, format), file)
          download(buf as BlobPart, `results.${format}`, format === 'json' ? 'application/json' : 'application/octet-stream')
        }
      } catch (e) {
        setError(msg(e))
      }
      setBusy('')
    },
    [spec, t],
  )

  const dropTable = useCallback(
    async (tb: CatalogTable) => {
      try {
        await query(`DROP ${tb.isView ? 'VIEW' : 'TABLE'} IF EXISTS ${quoteIdent(tb.name)}`)
        await refreshCatalog()
      } catch (e) {
        setError(msg(e))
      }
    },
    [refreshCatalog],
  )

  const insertText = useCallback((text: string) => setSql((s) => (s && !/\s$/.test(s) ? `${s} ${text}` : s + text)), [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void openFiles([...e.dataTransfer.files])
  }

  return (
    <TContext.Provider value={t}>
      <div
        className="app"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={onDrop}
      >
        <header className="top">
          <h1 className="brand">CSV SQL Explorer</h1>
          <div className="actions">
            <button className="primary" disabled={engine !== 'ready' || !!busy} onClick={() => fileInput.current?.click()}>
              {t('Open files…')}
            </button>
            <button disabled={engine !== 'ready' || !!busy} onClick={() => void loadSample()}>
              {t('Load sample data')}
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept=".csv,.tsv,.txt,.tab,.parquet,.pq,.json,.jsonl,.ndjson,.gz"
              onChange={(e) => {
                void openFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>
          <div className="settings">
            <label title={t('Load CSV and JSON files into memory (table) or read them in place (view). Auto reads Parquet in place.')}>
              {t('Load as')}{' '}
              <select value={settings.loadMode} onChange={(e) => setSettings({ ...settings, loadMode: e.target.value as LoadMode })}>
                <option value="auto">{t('Auto')}</option>
                <option value="table">{t('Table (memory)')}</option>
                <option value="view">{t('View (in place)')}</option>
              </select>
            </label>
            <label>
              {t('Language')}{' '}
              <select value={settings.lang} onChange={(e) => setSettings({ ...settings, lang: e.target.value as Lang })}>
                <option value="en">English</option>
                <option value="uk">Українська</option>
              </select>
            </label>
            <label>
              {t('Theme')}{' '}
              <select value={settings.theme} onChange={(e) => setSettings({ ...settings, theme: e.target.value as Theme })}>
                <option value="auto">{t('System')}</option>
                <option value="light">{t('Light')}</option>
                <option value="dark">{t('Dark')}</option>
              </select>
            </label>
          </div>
        </header>

        <div className="body">
          <aside className={`side${sideOpen ? '' : ' closed'}`}>
            <div className="side-head">
              <h2>{t('Tables')}</h2>
              <button className="small side-toggle" aria-expanded={sideOpen} onClick={() => setSideOpen(!sideOpen)}>
                {sideOpen ? t('Hide') : t('Show')}
              </button>
            </div>
            {sideOpen && (
              <div className="side-scroll">
                <Sidebar
                  tables={tables}
                  onPreview={(name) => {
                    const q = `SELECT * FROM ${quoteIdent(name)}`
                    setSql(q)
                    void run(q)
                  }}
                  onInsert={insertText}
                  onDrop={dropTable}
                />
              </div>
            )}
          </aside>

          <main className="work">
            <SqlEditor value={sql} tables={tables} placeholderText={t('Write SQL, then press Ctrl+Enter')} onChange={setSql} onRun={runEditor} />
            <div className="runbar">
              <button className="primary" disabled={engine !== 'ready' || !!busy} onClick={runEditor} title="Ctrl+Enter">
                ▶ {t('Run')} <kbd>Ctrl+Enter</kbd>
              </button>
              <span className="status" role="status">
                {engine === 'loading' && t('Starting DuckDB…')}
                {engine === 'failed' && <span className="err">{t('DuckDB failed to start: {0}', engineErr)}</span>}
                {busy || (result && t('{0} rows', total.toLocaleString()))}
                {!busy && note}
              </span>
              <span className="spacer" />
              <span className="exports">
                {t('Export')}:
                {(['csv', 'parquet', 'json'] as const).map((f) => (
                  <button key={f} className="small" disabled={!spec || !!busy} onClick={() => void doExport(f)}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </span>
            </div>
            {error && (
              <pre className="error" role="alert">
                {error}
              </pre>
            )}
            <div className="tabs" role="tablist">
              {(['table', 'chart', 'history'] as const).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {k === 'table' ? t('Results') : k === 'chart' ? t('Chart') : `${t('History')} (${history.length})`}
                </button>
              ))}
            </div>
            <div className="pane">
              {tab === 'table' &&
                (spec ? (
                  <ResultsGrid key={result!.id} spec={spec} total={total} onSort={onSort} onFilter={onFilter} onError={setError} />
                ) : (
                  <div className="hero">
                    <p>{note || t('Open a CSV, TSV, Parquet, JSON or NDJSON file, or write a query.')}</p>
                    <p className="muted">{t('Files stay in your browser. Drop them anywhere on this page.')}</p>
                  </div>
                ))}
              {tab === 'chart' && (spec ? <ChartView key={result!.id} spec={spec} total={total} /> : <p className="muted pad">{t('Run a query to chart its results.')}</p>)}
              {tab === 'history' && (
                <div className="history">
                  <div className="hist-head">
                    <button className="small" disabled={history.length === 0} onClick={() => setHistory([])}>
                      {t('Clear history')}
                    </button>
                  </div>
                  {history.length === 0 && <p className="muted pad">{t('No queries yet.')}</p>}
                  <ul>
                    {history.map((h, i) => (
                      <li key={`${h.at}-${i}`} className={h.error ? 'bad' : ''}>
                        <pre>{h.sql}</pre>
                        <div className="meta">
                          <span>{new Date(h.at).toLocaleTimeString()}</span>
                          <span>{h.ms} ms</span>
                          <span>{h.error ? t('error') : h.rows === null ? '' : t('{0} rows', h.rows.toLocaleString())}</span>
                          <span className="spacer" />
                          <button className="small" onClick={() => setSql(h.sql)}>
                            {t('Load')}
                          </button>
                          <button
                            className="small"
                            disabled={!!busy}
                            onClick={() => {
                              setSql(h.sql)
                              void run(h.sql)
                            }}
                          >
                            {t('Run')}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </main>
        </div>

        <footer className="foot muted">
          {t('Runs entirely in your browser with DuckDB-WASM. Your data never leaves your device.')}{' '}
          <a href={REPO}>{t('Source on GitHub')}</a>
        </footer>
        {dragging && <div className="dropzone">{t('Drop files to open')}</div>}
      </div>
    </TContext.Provider>
  )
}

function pickMode(mode: LoadMode, format: string): 'table' | 'view' {
  if (mode !== 'auto') return mode
  return format === 'parquet' ? 'view' : 'table'
}
