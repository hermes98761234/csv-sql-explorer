/** Pure SQL string helpers for DuckDB. Nothing here touches the database. */

export type FileFormat = 'csv' | 'tsv' | 'parquet' | 'json' | 'ndjson'

/** Quote an identifier: wrap in double quotes and double any embedded quote. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Quote a string literal: wrap in single quotes and double any embedded quote. */
export function quoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** Detects the format from a file name, or null if unsupported. */
export function detectFormat(fileName: string): FileFormat | null {
  const n = fileName.toLowerCase().replace(/\.(gz|zst)$/, '')
  if (/\.(csv|txt)$/.test(n)) return 'csv'
  if (n.endsWith('.tsv') || n.endsWith('.tab')) return 'tsv'
  if (n.endsWith('.parquet') || n.endsWith('.pq')) return 'parquet'
  if (n.endsWith('.ndjson') || n.endsWith('.jsonl')) return 'ndjson'
  if (n.endsWith('.json')) return 'json'
  return null
}

/** A SQL table function call that reads a registered file. */
export function readerExpr(file: string, format: FileFormat): string {
  const f = quoteLiteral(file)
  switch (format) {
    case 'csv':
      return `read_csv(${f}, auto_detect = true, sample_size = 20480)`
    case 'tsv':
      return `read_csv(${f}, auto_detect = true, delim = E'\\t', sample_size = 20480)`
    case 'parquet':
      return `read_parquet(${f})`
    case 'json':
      return `read_json_auto(${f}, format = 'array')`
    case 'ndjson':
      return `read_json_auto(${f}, format = 'newline_delimited')`
  }
}

/** Turns a file name into a safe, readable table name. */
export function tableNameFromFile(fileName: string): string {
  let base = fileName.replace(/^.*[\\/]/, '').replace(/\.(gz|zst)$/i, '').replace(/\.[^.]*$/, '')
  base = base.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
  if (!base) base = 'data'
  if (/^[0-9]/.test(base)) base = `t_${base}`
  return base
}

/** Appends _2, _3 … until the name is not in `taken` (case-insensitive). */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((s) => s.toLowerCase()))
  if (!set.has(name.toLowerCase())) return name
  for (let i = 2; ; i++) {
    const c = `${name}_${i}`
    if (!set.has(c.toLowerCase())) return c
  }
}

/** CREATE statement that exposes a registered file as a table (copied into memory) or a view (read in place). */
export function createFromFileSql(table: string, file: string, format: FileFormat, as: 'table' | 'view'): string {
  const kind = as === 'view' ? 'VIEW' : 'TABLE'
  return `CREATE OR REPLACE ${kind} ${quoteIdent(table)} AS SELECT * FROM ${readerExpr(file, format)}`
}

const INT_TYPES = /^(U?(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT)|INT[1248]?|SHORT|LONG|SIGNED)$/
const FLOAT_TYPES = /^(FLOAT|DOUBLE|REAL|FLOAT[48])$/

export function isNumericType(type: string): boolean {
  const t = type.toUpperCase().trim()
  return INT_TYPES.test(t) || FLOAT_TYPES.test(t) || /^(DECIMAL|NUMERIC)(\(.*\))?$/.test(t)
}

/** Types that Arrow hands to JS in a form we can show directly (anything else is cast to VARCHAR). */
export function isNativeType(type: string): boolean {
  const t = type.toUpperCase().trim()
  if (t.includes('HUGEINT')) return false
  return t === 'VARCHAR' || t === 'BOOLEAN' || INT_TYPES.test(t) || FLOAT_TYPES.test(t)
}

export function isTemporalType(type: string): boolean {
  return /^(DATE|TIMESTAMP|TIME|TIMESTAMPTZ|TIMESTAMP WITH TIME ZONE)/i.test(type.trim())
}

export interface ProfileSql {
  stats: string
  /** Histogram (numeric columns) or top values (others). */
  distribution: string
}

/** Count / nulls / distinct / min / max (/ mean). min and max are cast to VARCHAR so every type works. */
export function buildStatsQuery(table: string, column: string, type: string): string {
  const c = quoteIdent(column)
  const mean = isNumericType(type) ? `avg(${c})::DOUBLE` : 'NULL'
  return (
    `SELECT count(*) AS total, count(${c}) AS non_null, count(DISTINCT ${c}) AS distinct_count, ` +
    `min(${c})::VARCHAR AS min, max(${c})::VARCHAR AS max, ${mean} AS mean FROM ${quoteIdent(table)}`
  )
}

/** Equal-width histogram over [min, max]; bucket index 0..bins-1. */
export function buildHistogramQuery(table: string, column: string, bins: number, min: number, max: number): string {
  const c = quoteIdent(column)
  const span = max - min
  if (!(span > 0)) return `SELECT 0 AS bucket, count(${c}) AS n FROM ${quoteIdent(table)} WHERE ${c} IS NOT NULL`
  return (
    `SELECT least(floor((${c}::DOUBLE - ${num(min)}) / ${num(span)} * ${bins})::INTEGER, ${bins - 1}) AS bucket, count(*) AS n ` +
    `FROM ${quoteIdent(table)} WHERE ${c} IS NOT NULL GROUP BY 1 ORDER BY 1`
  )
}

/** Most frequent values of a column. */
export function buildTopValuesQuery(table: string, column: string, limit = 8): string {
  const c = quoteIdent(column)
  return (
    `SELECT ${c}::VARCHAR AS value, count(*) AS n FROM ${quoteIdent(table)} WHERE ${c} IS NOT NULL ` +
    `GROUP BY 1 ORDER BY n DESC, value LIMIT ${Math.max(1, Math.floor(limit))}`
  )
}

export function buildProfile(table: string, column: string, type: string): ProfileSql {
  return { stats: buildStatsQuery(table, column, type), distribution: buildTopValuesQuery(table, column) }
}

function num(n: number): string {
  return Number.isFinite(n) ? String(n) : '0'
}

/** Escapes LIKE wildcards so user text matches literally (use with ESCAPE '\\'). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`)
}

export interface ViewSpec {
  /** The user's SELECT-like statement, no trailing semicolon needed. */
  sql: string
  sort?: { column: string; desc: boolean } | null
  /** Per-column "contains" filters (case-insensitive). */
  filters?: Record<string, string>
  /** Column name and DuckDB type, used to cast exotic types to text. */
  columns?: { name: string; type: string }[]
}

/** Removes trailing whitespace, comments-free semicolons. */
export function stripTrailingSemicolons(sql: string): string {
  return sql.replace(/[\s;]+$/, '')
}

function whereClause(filters: Record<string, string> | undefined): string {
  const parts = Object.entries(filters ?? {})
    .filter(([, v]) => v !== '')
    .map(([col, v]) => `CAST(q.${quoteIdent(col)} AS VARCHAR) ILIKE ${quoteLiteral(`%${escapeLike(v)}%`)} ESCAPE '\\'`)
  return parts.length ? ` WHERE ${parts.join(' AND ')}` : ''
}

function fromClause(v: ViewSpec): string {
  return `FROM (${stripTrailingSemicolons(v.sql)}\n) AS q`
}

/** SELECT COUNT(*) of the filtered view. */
export function buildCountQuery(v: ViewSpec): string {
  return `SELECT count(*) AS n ${fromClause(v)}${whereClause(v.filters)}`
}

/** One page of the sorted and filtered view. */
export function buildPageQuery(v: ViewSpec, limit: number, offset: number): string {
  const proj = v.columns?.length
    ? v.columns
        .map((c) => (isNativeType(c.type) ? `q.${quoteIdent(c.name)}` : `CAST(q.${quoteIdent(c.name)} AS VARCHAR) AS ${quoteIdent(c.name)}`))
        .join(', ')
    : 'q.*'
  const order = v.sort ? ` ORDER BY q.${quoteIdent(v.sort.column)} ${v.sort.desc ? 'DESC' : 'ASC'} NULLS LAST` : ''
  return `SELECT ${proj} ${fromClause(v)}${whereClause(v.filters)}${order} LIMIT ${Math.floor(limit)} OFFSET ${Math.floor(offset)}`
}

/** The full sorted and filtered view as one SELECT (no paging), for COPY. */
export function buildFullQuery(v: ViewSpec): string {
  const order = v.sort ? ` ORDER BY q.${quoteIdent(v.sort.column)} ${v.sort.desc ? 'DESC' : 'ASC'} NULLS LAST` : ''
  return `SELECT q.* ${fromClause(v)}${whereClause(v.filters)}${order}`
}

export type ExportFormat = 'csv' | 'parquet' | 'json'

/** COPY statement writing the query to a virtual file. */
export function buildCopyQuery(query: string, file: string, format: ExportFormat): string {
  const opts = {
    csv: 'FORMAT CSV, HEADER true',
    parquet: 'FORMAT PARQUET, COMPRESSION zstd',
    json: 'FORMAT JSON, ARRAY true',
  }[format]
  return `COPY (${stripTrailingSemicolons(query)}) TO ${quoteLiteral(file)} (${opts})`
}

/** DESCRIBE of a user query, to learn column names and types before paging. */
export function buildDescribeQuery(sql: string): string {
  return `DESCRIBE SELECT * FROM (${stripTrailingSemicolons(sql)}\n) AS q`
}

/** Splits a script into statements at top-level semicolons, honouring quotes and comments. */
export function splitStatements(script: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  while (i < script.length) {
    const ch = script[i]
    const two = script.slice(i, i + 2)
    if (two === '--') {
      const end = script.indexOf('\n', i)
      const stop = end === -1 ? script.length : end
      cur += script.slice(i, stop)
      i = stop
    } else if (two === '/*') {
      const end = script.indexOf('*/', i + 2)
      const stop = end === -1 ? script.length : end + 2
      cur += script.slice(i, stop)
      i = stop
    } else if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < script.length) {
        if (script[j] === ch) {
          if (script[j + 1] === ch) j += 2
          else break
        } else j++
      }
      cur += script.slice(i, j + 1)
      i = j + 1
    } else if (ch === ';') {
      if (hasCode(cur)) out.push(cur.trim())
      cur = ''
      i++
    } else {
      cur += ch
      i++
    }
  }
  if (hasCode(cur)) out.push(cur.trim())
  return out
}

function hasCode(s: string): boolean {
  return s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim() !== ''
}

/** True if the statement returns rows and can be wrapped as a subquery. */
export function isRowQuery(stmt: string): boolean {
  const body = stmt.replace(/^(\s|--[^\n]*\n?|\/\*[\s\S]*?\*\/)+/, '')
  return /^\(?\s*(SELECT|WITH|FROM|VALUES|TABLE)\b/i.test(body)
}

/** RFC 4180 field: quote when it holds a delimiter, quote, CR or LF. */
export function csvField(s: string, delimiter = ','): string {
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Formats a cell value from Arrow for display and export. null becomes ''. */
export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  if (v instanceof Uint8Array) return `\\x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}`
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))
  } catch {
    return String(v)
  }
}

/** CSV lines for data rows only (CRLF after each line). */
export function csvRows(rows: unknown[][], delimiter = ','): string {
  return rows.map((r) => r.map((c) => csvField(formatCell(c), delimiter)).join(delimiter) + '\r\n').join('')
}

/** Builds a CSV document (CRLF line ends, header row first). */
export function toCsv(header: string[], rows: unknown[][], delimiter = ','): string {
  return header.map((c) => csvField(c, delimiter)).join(delimiter) + '\r\n' + csvRows(rows, delimiter)
}
