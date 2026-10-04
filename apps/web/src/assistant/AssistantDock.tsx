import { t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { AssistantPanel, type AssistantMessage } from '@console/ui'
import { useEffect, useRef } from 'react'
import { useAssistant } from './AssistantProvider.tsx'
import { timeline, type Conversation, type Entry } from './conversation.ts'
import { Markdown } from './Markdown.tsx'
import { useWorkProposals } from './proposals.tsx'
import { findProposals, type WorkProposal } from '../screens/work/proposal.ts'
import { clock, dayLabel, quote } from '../lib/format.ts'

/**
 * Панель ассистента справа (компонент дизайн-системы `AssistantPanel`, docked): беседа
 * `surface/1` переводится в сообщения панели. Чего в контракте нет, того на панели нет:
 * у проактивных сообщений не указан источник — подписи «Источник: …» нет.
 */

const time = (iso: string): string => clock(iso)

function approvalWord(state: string): string {
  switch (state) {
    case 'allow': return t`Allowed`
    case 'reject': return t`Declined`
    case 'cancelled': return t`Cancelled: the turn was interrupted`
    case 'expired': return t`The confirmation expired`
    default: return state
  }
}
function sendError(code: string | undefined): string {
  switch (code) {
    case 'network': return t`no connection`
    case 'harness_timeout': return t`the assistant did not answer in time`
    case 'upstream_unavailable': return t`the assistant is unavailable`
    case 'no_permission': return t`no access to the assistant`
    case 'body_too_large': return t`the message is too long`
    default: return code ?? t`error`
  }
}

function approvalOutcome(reason: string, state: string, surface: string | undefined): string {
  const word = approvalWord(state)
  if (surface === 'telegram') return t`Asked to confirm: ${reason} — ${word} in Telegram.`
  if (surface !== undefined && surface !== 'console') return t`Asked to confirm: ${reason} — ${word} in the window.`
  return t`Asked to confirm: ${reason} — ${word}.`
}

function messagesOf(c: Conversation, actions: { retry: (id: string) => void, decide: (id: string, d: 'allow' | 'reject') => void, loadEarlier: () => void, reconnect: () => void, proposal: (messageId: string, index: number, p: WorkProposal) => AssistantMessage }): AssistantMessage[] {
  const out: AssistantMessage[] = []
  if (c.history.nextBefore !== null && c.history.state === 'loaded') {
    out.push({ from: 'asst', text: t`There are earlier messages in this conversation.`, actions: [{ label: t`Show earlier`, variant: 'ghost', onClick: actions.loadEarlier }] })
  }
  let day = ''
  const entries: Entry[] = timeline(c)
  for (const e of entries) {
    const label = dayLabel(e.at)
    if (label !== day && e.kind !== 'delta') {
      day = label
      out.push({ divider: label })
    }
    if (e.kind === 'message') {
      const m = e.message
      if (m.role === 'user') {
        out.push({
          from: 'user', text: m.text, at: time(m.at),
          ...(m.surface === 'telegram' ? { channel: 'Telegram' } : {}),
          ...(m.screenContext?.label !== undefined ? { context: quote(m.screenContext.label) } : {}),
        })
      } else {
        out.push({ from: 'asst', text: <Markdown text={m.text} />, at: time(m.at) })
        // Предложение работы ссылкой — карточкой «Будет заведено» после ответа.
        findProposals(m.text).forEach((p, i) => out.push(actions.proposal(m.id, i, p)))
      }
    } else if (e.kind === 'outgoing') {
      const o = e.outgoing
      out.push({
        from: 'user', text: o.text,
        at: o.state === 'sending' ? t`sending…` : o.state === 'failed' ? t`not sent: ${sendError(o.error)}` : time(o.at),
        ...(o.screenLabel !== undefined ? { context: quote(o.screenLabel) } : {}),
        ...(o.state === 'failed' ? { actions: [{ label: t`Retry`, variant: 'secondary' as const, onClick: () => actions.retry(o.requestId) }] } : {}),
      })
    } else if (e.kind === 'approval') {
      const a = e.approval
      const pending = a.state === 'pending' || a.state === 'deciding'
      out.push({
        from: 'asst',
        text: a.error !== undefined ? t`Please confirm: ${a.reason} Failed: ${sendError(a.error)}.` : t`Please confirm: ${a.reason}`,
        at: time(a.at),
        ...(pending
          ? { actions: [
              { label: t`Allow`, variant: 'human' as const, onClick: () => actions.decide(a.approvalRequestId, 'allow') },
              { label: t`Decline`, variant: 'ghost' as const, onClick: () => actions.decide(a.approvalRequestId, 'reject') },
            ] }
          : { text: approvalOutcome(a.reason, a.state, a.surface) }),
      })
    } else if (e.kind === 'delta') {
      out.push({ from: 'asst', text: <Markdown text={e.text} /> })
    }
  }
  if (c.turnNote !== null) out.push({ from: 'asst', text: c.turnNote.status === 'failed' ? t`The answer failed. Ask again.` : t`The answer was interrupted.` })
  if (c.link === 'sleeping' || c.link === 'waking') out.push({ divider: t`The assistant is waking up…` })
  if (c.link === 'reconnecting') out.push({ divider: t`No connection to the assistant — reconnecting` })
  if (c.link === 'refused') {
    out.push({ from: 'asst', text: c.linkError === 'too_many_streams' ? t`The assistant is open in too many tabs.` : t`The connection to the assistant is closed.`, actions: [{ label: t`Reconnect`, variant: 'secondary', onClick: actions.reconnect }] })
  }
  if (c.history.state === 'failed') out.push({ from: 'asst', text: t`Could not load the conversation history.` })
  return out
}

export function AssistantDock({ suggestions }: { suggestions: string[] }) {
  // Подписка на язык: смена языка перерисовывает ленту.
  useLingui()
  const a = useAssistant()
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!a.open) return
    const t = setTimeout(() => input.current?.focus(), 210)
    return () => clearTimeout(t)
  }, [a.open, a.focusToken])
  const proposal = useWorkProposals()
  const messages = messagesOf(a.conversation, { ...a, proposal })
  const busy = a.conversation.turn !== null && Object.keys(a.conversation.deltas).length === 0
  const send = (text: string): void => {
    if (text.trim() === '') return
    a.send(text.trim())
    a.setDraft('')
  }
  return (
    <AssistantPanel
      docked
      messages={messages}
      busy={busy}
      suggestions={suggestions}
      onSuggest={send}
      value={a.draft}
      onChange={e => a.setDraft(e.target.value)}
      onSend={() => send(a.draft)}
      onClose={() => a.toggle(false)}
      inputRef={input}
    />
  )
}
