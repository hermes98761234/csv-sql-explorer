import type { Lang } from './i18n'

export type Theme = 'auto' | 'light' | 'dark'
export type LoadMode = 'auto' | 'table' | 'view'

export interface Settings {
  theme: Theme
  lang: Lang
  loadMode: LoadMode
}

const KEY = 'csv-sql-explorer:settings'
const QUERY_KEY = 'csv-sql-explorer:query'
const HISTORY_KEY = 'csv-sql-explorer:history'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  lang: typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('uk') ? 'uk' : 'en',
  loadMode: 'auto',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage may be full or blocked; settings are best-effort
  }
}

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>(KEY, {})
  return {
    theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'auto',
    lang: s.lang === 'uk' || s.lang === 'en' ? s.lang : DEFAULT_SETTINGS.lang,
    loadMode: s.loadMode === 'table' || s.loadMode === 'view' ? s.loadMode : 'auto',
  }
}
export const saveSettings = (s: Settings) => write(KEY, s)

export const loadQuery = (fallback: string) => read<string>(QUERY_KEY, fallback)
export const saveQuery = (q: string) => write(QUERY_KEY, q)

export interface HistoryEntry {
  sql: string
  at: number
  ms: number
  rows: number | null
  error?: string
}
export const MAX_HISTORY = 50

export const loadHistory = () => {
  const h = read<HistoryEntry[]>(HISTORY_KEY, [])
  return Array.isArray(h) ? h.slice(0, MAX_HISTORY) : []
}
export const saveHistory = (h: HistoryEntry[]) => write(HISTORY_KEY, h.slice(0, MAX_HISTORY))

/** Newest first, consecutive duplicates collapse, capped. */
export function pushHistory(h: HistoryEntry[], e: HistoryEntry): HistoryEntry[] {
  const rest = h[0]?.sql === e.sql ? h.slice(1) : h
  return [e, ...rest].slice(0, MAX_HISTORY)
}
