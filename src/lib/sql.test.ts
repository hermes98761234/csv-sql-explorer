import { describe, expect, it } from 'vitest'
import {
  buildCopyQuery,
  buildCountQuery,
  buildDescribeQuery,
  buildHistogramQuery,
  buildPageQuery,
  buildProfile,
  buildStatsQuery,
  buildTopValuesQuery,
  createFromFileSql,
  csvField,
  detectFormat,
  escapeLike,
  formatCell,
  isNativeType,
  isNumericType,
  isRowQuery,
  quoteIdent,
  quoteLiteral,
  readerExpr,
  splitStatements,
  stripTrailingSemicolons,
  tableNameFromFile,
  toCsv,
  uniqueName,
} from './sql'

describe('quoting', () => {
  it('quotes identifiers and doubles embedded quotes', () => {
    expect(quoteIdent('sales')).toBe('"sales"')
    expect(quoteIdent('my "col"')).toBe('"my ""col"""')
    expect(quoteIdent('select')).toBe('"select"')
  })
  it('quotes literals', () => {
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'")
  })
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
  })
})

describe('files', () => {
  it('detects formats', () => {
    expect(detectFormat('a.CSV')).toBe('csv')
    expect(detectFormat('a.tsv')).toBe('tsv')
    expect(detectFormat('a.parquet')).toBe('parquet')
    expect(detectFormat('a.jsonl')).toBe('ndjson')
    expect(detectFormat('a.json')).toBe('json')
    expect(detectFormat('a.csv.gz')).toBe('csv')
    expect(detectFormat('a.xlsx')).toBeNull()
  })
  it('derives safe unique table names', () => {
    expect(tableNameFromFile('My Data (v2).csv')).toBe('my_data_v2')
    expect(tableNameFromFile('2024-sales.parquet')).toBe('t_2024_sales')
    expect(tableNameFromFile('/x/y/log.csv.gz')).toBe('log')
    expect(tableNameFromFile('.csv')).toBe('data')
    expect(uniqueName('a', ['A', 'a_2'])).toBe('a_3')
    expect(uniqueName('b', ['a'])).toBe('b')
  })
  it('builds reader and create statements', () => {
    expect(readerExpr("o'k.parquet", 'parquet')).toBe("read_parquet('o''k.parquet')")
    expect(readerExpr('a.tsv', 'tsv')).toContain("delim = E'\\t'")
    expect(readerExpr('a.ndjson', 'ndjson')).toContain('newline_delimited')
    expect(createFromFileSql('t', 'f.csv', 'csv', 'table')).toBe(
      `CREATE OR REPLACE TABLE "t" AS SELECT * FROM read_csv('f.csv', auto_detect = true, sample_size = 20480)`,
    )
    expect(createFromFileSql('t', 'f.parquet', 'parquet', 'view')).toContain('CREATE OR REPLACE VIEW "t"')
  })
})

describe('types', () => {
  it('classifies numeric and native types', () => {
    for (const t of ['INTEGER', 'bigint', 'DOUBLE', 'DECIMAL(18,3)', 'UTINYINT', 'HUGEINT']) expect(isNumericType(t), t).toBe(true)
    for (const t of ['VARCHAR', 'DATE', 'TIMESTAMP', 'BOOLEAN']) expect(isNumericType(t), t).toBe(false)
    expect(isNativeType('DOUBLE')).toBe(true)
    expect(isNativeType('DECIMAL(18,3)')).toBe(false)
    expect(isNativeType('HUGEINT')).toBe(false)
    expect(isNativeType('DATE')).toBe(false)
    expect(isNativeType('VARCHAR')).toBe(true)
  })
})

describe('profile queries', () => {
  it('builds stats with a mean only for numbers', () => {
    const num = buildStatsQuery('t', 'price', 'DOUBLE')
    expect(num).toContain('count(*) AS total')
    expect(num).toContain('count(DISTINCT "price")')
    expect(num).toContain('avg("price")::DOUBLE AS mean')
    expect(num).toContain('FROM "t"')
    expect(buildStatsQuery('t', 'name', 'VARCHAR')).toContain('NULL AS mean')
  })
  it('quotes hostile names', () => {
    const q = buildStatsQuery('a"b', 'c"d', 'INTEGER')
    expect(q).toContain('"a""b"')
    expect(q).toContain('"c""d"')
  })
  it('builds a histogram with clamped last bucket', () => {
    const q = buildHistogramQuery('t', 'x', 10, 0, 100)
    expect(q).toContain('floor(("x"::DOUBLE - 0) / 100 * 10)::INTEGER, 9)')
    expect(q).toContain('GROUP BY 1 ORDER BY 1')
  })
  it('handles a constant column', () => {
    expect(buildHistogramQuery('t', 'x', 10, 5, 5)).toContain('0 AS bucket')
  })
  it('builds top values and a profile bundle', () => {
    expect(buildTopValuesQuery('t', 'c', 3)).toContain('LIMIT 3')
    const p = buildProfile('t', 'c', 'VARCHAR')
    expect(p.stats).toContain('min("c")')
    expect(p.distribution).toContain('GROUP BY 1')
  })
})

describe('paged view queries', () => {
  const base = { sql: 'SELECT * FROM t;  ' }
  it('strips semicolons', () => {
    expect(stripTrailingSemicolons('select 1 ;;\n')).toBe('select 1')
  })
  it('pages without sort or filter', () => {
    const q = buildPageQuery(base, 500, 1000)
    expect(q).toContain('SELECT q.* FROM (SELECT * FROM t')
    expect(q).toContain(') AS q LIMIT 500 OFFSET 1000')
  })
  it('sorts with qualified column and nulls last', () => {
    const q = buildPageQuery({ ...base, sort: { column: 'a b', desc: true } }, 10, 0)
    expect(q).toContain('ORDER BY q."a b" DESC NULLS LAST')
  })
  it('filters case-insensitively and escapes input', () => {
    const q = buildCountQuery({ ...base, filters: { name: "it's 100%", empty: '' } })
    expect(q).toContain(`CAST(q."name" AS VARCHAR) ILIKE '%it''s 100\\%%' ESCAPE '\\'`)
    expect(q).not.toContain('"empty"')
  })
  it('casts non-native types to text', () => {
    const q = buildPageQuery({ ...base, columns: [{ name: 'd', type: 'DATE' }, { name: 'n', type: 'BIGINT' }] }, 5, 0)
    expect(q).toContain('CAST(q."d" AS VARCHAR) AS "d", q."n"')
  })
  it('builds describe', () => {
    expect(buildDescribeQuery('select 1;')).toBe('DESCRIBE SELECT * FROM (select 1\n) AS q')
  })
})

describe('export queries', () => {
  it('builds COPY statements', () => {
    expect(buildCopyQuery('select 1;', 'out.parquet', 'parquet')).toBe("COPY (select 1) TO 'out.parquet' (FORMAT PARQUET, COMPRESSION zstd)")
    expect(buildCopyQuery('select 1', 'o.json', 'json')).toContain('FORMAT JSON, ARRAY true')
    expect(buildCopyQuery('select 1', 'o.csv', 'csv')).toContain('FORMAT CSV, HEADER true')
  })
})

describe('statements', () => {
  it('splits on top-level semicolons only', () => {
    expect(splitStatements("select 'a;b'; select \"x;\" -- c;\n; /* ; */ select 3")).toEqual([
      "select 'a;b'",
      'select "x;" -- c;',
      '/* ; */ select 3',
    ])
    expect(splitStatements(' ; -- only a comment\n')).toEqual([])
  })
  it('recognises row-returning statements', () => {
    expect(isRowQuery('  -- hi\nselect 1')).toBe(true)
    expect(isRowQuery('WITH a AS (select 1) select * from a')).toBe(true)
    expect(isRowQuery('FROM t')).toBe(true)
    expect(isRowQuery('CREATE TABLE x(a int)')).toBe(false)
    expect(isRowQuery('DESCRIBE t')).toBe(false)
  })
})

describe('csv export formatting', () => {
  it('quotes fields only when needed', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('l1\nl2')).toBe('"l1\nl2"')
    expect(csvField('a\tb', '\t')).toBe('"a\tb"')
  })
  it('formats cells', () => {
    expect(formatCell(null)).toBe('')
    expect(formatCell(undefined)).toBe('')
    expect(formatCell(12345678901234567890n)).toBe('12345678901234567890')
    expect(formatCell(1.5)).toBe('1.5')
    expect(formatCell(false)).toBe('false')
    expect(formatCell(new Date(Date.UTC(2024, 0, 2)))).toBe('2024-01-02T00:00:00.000Z')
    expect(formatCell(new Uint8Array([1, 255]))).toBe('\\x01ff')
    expect(formatCell({ a: 1n })).toBe('{"a":"1"}')
  })
  it('builds a CRLF document with header', () => {
    expect(toCsv(['id', 'note'], [[1, 'a,b'], [2n, null]])).toBe('id,note\r\n1,"a,b"\r\n2,\r\n')
    expect(toCsv(['a'], [])).toBe('a\r\n')
  })
})
