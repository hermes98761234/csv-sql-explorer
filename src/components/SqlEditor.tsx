import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { bracketMatching, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { tags as tg } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import type { CatalogTable } from '../db'

const highlight = HighlightStyle.define([
  { tag: [tg.keyword, tg.operatorKeyword, tg.modifier], color: 'var(--hl-keyword)', fontWeight: '600' },
  { tag: [tg.string, tg.special(tg.string)], color: 'var(--hl-string)' },
  { tag: [tg.number, tg.bool, tg.null], color: 'var(--hl-number)' },
  { tag: [tg.comment, tg.lineComment, tg.blockComment], color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [tg.typeName, tg.standard(tg.name)], color: 'var(--hl-type)' },
  { tag: [tg.function(tg.variableName), tg.function(tg.propertyName)], color: 'var(--hl-fn)' },
  { tag: tg.operator, color: 'var(--muted)' },
])

const theme = EditorView.theme({
  '&': { color: 'var(--fg)', backgroundColor: 'var(--panel)', height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
  '.cm-gutters': { backgroundColor: 'var(--panel2)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--line)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' },
  '&.cm-focused': { outline: 'none' },
})

/** Table → column names, for autocompletion. */
function schemaOf(tables: CatalogTable[]): Record<string, string[]> {
  return Object.fromEntries(tables.map((t) => [t.name, t.columns.map((c) => c.name)]))
}

interface Props {
  value: string
  tables: CatalogTable[]
  placeholderText: string
  onChange: (v: string) => void
  onRun: () => void
}

export default function SqlEditor({ value, tables, placeholderText, onChange, onRun }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const lang = useRef(new Compartment())
  const cb = useRef({ onChange, onRun })
  cb.current = { onChange, onRun }

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => (cb.current.onRun(), true) }])),
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
          lang.current.of(sql({ dialect: PostgreSQL, schema: schemaOf(tables), upperCaseKeywords: true })),
          syntaxHighlighting(highlight),
          theme,
          placeholder(placeholderText),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
    // The editor is created once; value and schema are synced below.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(sql({ dialect: PostgreSQL, schema: schemaOf(tables), upperCaseKeywords: true })) })
  }, [tables])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div className="editor" ref={host} />
}
