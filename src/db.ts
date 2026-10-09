import * as duckdb from '@duckdb/duckdb-wasm'
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'

/** Single-threaded DuckDB-WASM bundles served as static assets: no COOP/COEP headers needed. */
const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
}

export interface QueryResult {
  columns: string[]
  rows: unknown[][]
}

let dbPromise: Promise<{ db: duckdb.AsyncDuckDB; conn: duckdb.AsyncDuckDBConnection }> | null = null

function init() {
  dbPromise ??= (async () => {
    const bundle = await duckdb.selectBundle(BUNDLES)
    const worker = new Worker(bundle.mainWorker!)
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker)
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
    const conn = await db.connect()
    return { db, conn }
  })()
  return dbPromise
}

export function getDb() {
  return init()
}

// One connection, so run statements one at a time.
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}

/** Runs one statement and returns all rows as plain arrays. */
export function query(sql: string): Promise<QueryResult> {
  return serial(async () => {
    const { conn } = await init()
    const t = await conn.query(sql)
    const columns = t.schema.fields.map((f) => f.name)
    const vecs = columns.map((_, i) => t.getChildAt(i)!)
    const rows: unknown[][] = []
    for (let r = 0; r < t.numRows; r++) rows.push(vecs.map((v) => v.get(r)))
    return { columns, rows }
  })
}

/** Registers a browser File for in-place reads (no copy into WASM memory) and returns the virtual name. */
export function registerFile(file: File, virtualName: string): Promise<string> {
  return serial(async () => {
    const { db } = await init()
    await db.registerFileHandle(virtualName, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true)
    return virtualName
  })
}

/** Runs COPY … TO a virtual file, returns its bytes, then deletes it. */
export function copyOut(copySql: string, file: string): Promise<Uint8Array> {
  return serial(async () => {
    const { db, conn } = await init()
    await conn.query(copySql)
    const buf = await db.copyFileToBuffer(file)
    await db.dropFile(file)
    return buf
  })
}

export interface CatalogColumn {
  name: string
  type: string
}
export interface CatalogTable {
  name: string
  isView: boolean
  columns: CatalogColumn[]
}

export async function loadCatalog(): Promise<CatalogTable[]> {
  const tables = await query("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name")
  const cols = await query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' ORDER BY table_name, ordinal_position",
  )
  const map = new Map<string, CatalogTable>()
  for (const [name, type] of tables.rows) map.set(String(name), { name: String(name), isView: String(type) === 'VIEW', columns: [] })
  for (const [t, c, d] of cols.rows) map.get(String(t))?.columns.push({ name: String(c), type: String(d) })
  return [...map.values()]
}
