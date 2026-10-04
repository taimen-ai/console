import { plural, t } from '@lingui/core/macro'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { cpGet } from '../../api/client.ts'
import type { Artifact } from '../../api/types.ts'

/**
 * Протокол попытки агента (`transcript`, схема `agent-transcript/1`, CP-ADR-0051): что агент
 * говорил и какие инструменты вызывал. Размышления не хранятся — так и написано. Протокол
 * читается как данные (JSON) и показывается текстом: никакой разметки из него не исполняется.
 * Содержимое — в самом артефакте; если ядро вынесло его в хранилище — `GET /artifacts/{id}/content`.
 */

interface Entry { kind: string, text?: string, tool?: string, input?: unknown, isError?: boolean, call?: number | null }
interface Transcript {
  schema?: string
  model?: string | null
  entries?: Entry[]
  final?: { text?: string, truncated?: boolean }
  stats?: { toolCalls?: number, toolErrors?: number, hiddenReasoningBlocks?: number, droppedEntries?: number }
  truncated?: boolean
}

const SHOWN = 30
const clip = (text: string, max: number): string => text.length > max ? `${text.slice(0, max - 1)}…` : text
const brief = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return clip(text.replace(/\s+/g, ' '), 160)
}

function useTranscript(artifact: Artifact) {
  const inline = artifact.content as Transcript | null | undefined
  return useQuery({
    queryKey: ['artifacts', artifact.id, 'content'],
    enabled: inline === null || inline === undefined,
    staleTime: Infinity,
    queryFn: ({ signal }) => cpGet<Transcript>(`/artifacts/${artifact.id}/content`, signal),
    ...(inline !== null && inline !== undefined ? { initialData: inline } : {}),
  })
}

export function Protocol({ artifact }: { artifact: Artifact }) {
  const transcript = useTranscript(artifact)
  const [all, setAll] = useState(false)
  if (transcript.isPending) return <p className="tc-muted">{t`Loading the protocol…`}</p>
  if (transcript.isError || transcript.data.schema !== 'agent-transcript/1') return <p className="tc-muted">{t`The protocol of the attempt could not be read.`}</p>
  const data = transcript.data
  const entries = (data.entries ?? []).filter(e => e.kind !== 'user')
  const shown = all ? entries : entries.slice(0, SHOWN)
  const calls = data.stats?.toolCalls ?? 0
  const errors = data.stats?.toolErrors ?? 0
  const facts = [
    data.model ?? undefined,
    plural(calls, { one: '# tool call', other: '# tool calls' }),
    errors > 0 ? plural(errors, { one: '# error', other: '# errors' }) : undefined,
    t`reasoning is not stored`,
  ].filter((x): x is string => x !== undefined)

  return (
    <div className="tk-protocol">
      <p className="tk-protocol-meta">{facts.join(' · ')}</p>
      <ol className="tk-protocol-steps">
        {shown.map((e, i) => {
          if (e.kind === 'assistant') return <li key={i} className="tk-step-say">{clip(e.text ?? '', 600)}</li>
          if (e.kind === 'tool_call') return <li key={i} className="tk-step-tool"><code>{e.tool}</code> <span className="tc-muted">{brief(e.input)}</span></li>
          if (e.kind === 'tool_result') return e.isError === true ? <li key={i} className="tk-step-error">{t`the tool returned an error`}</li> : null
          return null
        })}
      </ol>
      {entries.length > SHOWN && !all ? <button type="button" className="tk-protocol-more" onClick={() => setAll(true)}>{t`Show the whole protocol`}</button> : null}
      {data.final?.text ? <p className="tk-protocol-final"><b>{t`Result:`}</b> {clip(data.final.text, 2000)}</p> : null}
      {data.truncated === true ? <p className="tc-muted">{t`The protocol is shortened: long entries are cut by the executor.`}</p> : null}
    </div>
  )
}
