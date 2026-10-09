import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { sampleSql } from './sample'
import { buildCopyQuery, buildCountQuery, buildDescribeQuery, buildHistogramQuery, buildPageQuery, buildStatsQuery, buildTopValuesQuery, createFromFileSql, quoteIdent } from './sql'

// Runs the generated SQL against the real DuckDB (blocking Node build of duckdb-wasm).
const require = createRequire(import.meta.url)
let conn: any
let db: any

const rows = (r: { toArray(): unknown[] }) => r.toArray().map((x) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))))

beforeAll(async () => {
  const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs')
  const dist = dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'))
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR)
  db = await duckdb.createDuckDB({ mvp: { mainModule: join(dist, 'duckdb-mvp.wasm'), mainWorker: '' }, eh: { mainModule: join(dist, 'duckdb-eh.wasm'), mainWorker: '' } }, logger, duckdb.NODE_RUNTIME)
  await db.instantiate(() => {})
  conn = db.connect()
}, 120000)

describe('generated SQL runs on DuckDB', () => {
  it('builds the sample dataset', () => {
    for (const s of sampleSql(1000).split(/;\s*\n\s*\n/)) conn.query(s.replace(/;\s*$/, ''))
    const n = rows(conn.query('SELECT count(*) AS n FROM sales'))
    expect(n[0].n).toBe(1000)
    const d = rows(conn.query(buildDescribeQuery('SELECT * FROM sales')))
    expect(d.map((x: { column_name: string }) => x.column_name)).toEqual(['order_id', 'order_date', 'region', 'product', 'quantity', 'unit_price', 'discount', 'customer_id'])
  })
  it('profiles', () => {
    const s = rows(conn.query(buildStatsQuery('sales', 'unit_price', 'DECIMAL(10,2)')))[0]
    expect(s.total).toBe(1000)
    expect(s.mean).toBeGreaterThan(20)
    expect(rows(conn.query(buildTopValuesQuery('sales', 'region', 3)))).toHaveLength(3)
    const h = rows(conn.query(buildHistogramQuery('sales', 'quantity', 8, 1, 9)))
    expect(h.reduce((a: number, b: { n: number }) => a + b.n, 0)).toBe(1000)
    expect(rows(conn.query(buildStatsQuery('sales', 'order_date', 'DATE')))[0].min).toMatch(/^2024-/)
  })
  it('pages, sorts and filters', () => {
    const v = { sql: 'SELECT * FROM sales;', sort: { column: 'order_id', desc: true }, filters: { region: 'nor' }, columns: [{ name: 'order_id', type: 'BIGINT' }, { name: 'order_date', type: 'DATE' }, { name: 'region', type: 'VARCHAR' }] }
    const total = rows(conn.query(buildCountQuery(v)))[0].n
    expect(total).toBeGreaterThan(100)
    const page = rows(conn.query(buildPageQuery(v, 5, 0)))
    expect(page).toHaveLength(5)
    expect(page[0].order_id).toBeGreaterThan(page[1].order_id)
    expect(typeof page[0].order_date).toBe('string')
  })
  it('reads files and exports', () => {
    db.registerFileText('x.csv', 'a,b\n1,"x,y"\n2,z\n')
    conn.query(createFromFileSql('weird "name"', 'x.csv', 'csv', 'table'))
    expect(rows(conn.query(`SELECT * FROM ${quoteIdent('weird "name"')} ORDER BY a`))[1].b).toBe('z')
    db.registerFileText('t.tsv', 'a\tb\n1\tx\n')
    conn.query(createFromFileSql('tt', 't.tsv', 'tsv', 'view'))
    expect(rows(conn.query('SELECT b FROM tt'))[0].b).toBe('x')
    db.registerFileText('n.ndjson', '{"a":1}\n{"a":2}\n')
    conn.query(createFromFileSql('nn', 'n.ndjson', 'ndjson', 'table'))
    expect(rows(conn.query('SELECT sum(a)::INTEGER AS s FROM nn'))[0].s).toBe(3)
    db.registerFileText('j.json', '[{"a":1},{"a":5}]')
    conn.query(createFromFileSql('jj', 'j.json', 'json', 'table'))
    expect(rows(conn.query('SELECT sum(a)::INTEGER AS s FROM jj'))[0].s).toBe(6)
    for (const f of ['csv', 'parquet', 'json'] as const) {
      conn.query(buildCopyQuery('SELECT * FROM nn', `out.${f}`, f))
      expect(db.copyFileToBuffer(`out.${f}`).length).toBeGreaterThan(4)
    }
    db.registerFileBuffer('rt.parquet', db.copyFileToBuffer('out.parquet'))
    expect(rows(conn.query("SELECT count(*) AS n FROM read_parquet('rt.parquet')"))[0].n).toBe(2)
  })
})
