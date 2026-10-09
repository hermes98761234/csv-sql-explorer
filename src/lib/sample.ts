/** Synthetic sales dataset, generated entirely in SQL from range() and hash(), so it is deterministic. */
export const SAMPLE_TABLE = 'sales'

export function sampleSql(rows = 200000): string {
  const n = Math.max(1, Math.floor(rows))
  return `CREATE OR REPLACE TABLE ${SAMPLE_TABLE} AS
SELECT
  i + 1 AS order_id,
  DATE '2024-01-01' + CAST(hash(i * 7) % 730 AS INTEGER) AS order_date,
  ['North', 'South', 'East', 'West', 'Central'][CAST(hash(i * 13) % 5 AS INTEGER) + 1] AS region,
  ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Headphones', 'Keyboard', 'Mouse', 'Camera'][CAST(hash(i * 17) % 8 AS INTEGER) + 1] AS product,
  CAST(1 + hash(i * 19) % 9 AS INTEGER) AS quantity,
  round(20 + (hash(i * 23) % 98000) / 100.0, 2) AS unit_price,
  round((hash(i * 29) % 30) / 100.0, 2) AS discount,
  CASE WHEN hash(i * 31) % 50 = 0 THEN NULL ELSE 'C' || lpad(CAST(hash(i * 37) % 5000 AS VARCHAR), 4, '0') END AS customer_id
FROM range(${n}) AS t(i);

SELECT region, product, count(*) AS orders, round(sum(quantity * unit_price * (1 - discount)), 2) AS revenue
FROM ${SAMPLE_TABLE}
GROUP BY ALL
ORDER BY revenue DESC;`
}

export const DEFAULT_QUERY = `SELECT region, count(*) AS orders, round(sum(quantity * unit_price * (1 - discount)), 2) AS revenue
FROM sales
GROUP BY region
ORDER BY revenue DESC;`
