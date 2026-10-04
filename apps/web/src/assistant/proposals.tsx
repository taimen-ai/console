import type { AssistantMessage } from '@console/ui'
import { t } from '@lingui/core/macro'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useMe, usePrincipals } from '../api/directory.ts'
import { useTaskTypes } from '../api/executors.ts'
import { useScope, workspaceOptions } from '../api/scope.tsx'
import { raiseError, raiseWork } from '../screens/work/AssignDialog.tsx'
import { proposalKey, proposalReady, type WorkProposal } from '../screens/work/proposal.ts'

/**
 * Предложения работы в ленте ассистента: ссылку `/work/new?…` в ответе консоль показывает
 * карточкой «Будет заведена работа — нужна ваша подпись» (компонент `proposal` панели).
 * «Завести работу» заводит её тем же `POST /tasks`, что форма, с ключом идемпотентности из
 * сообщения: повтор после перезагрузки вернёт ту же работу. Чего не хватает (результата или
 * срока) — кнопка «Дополнить» открывает форму с заполненными полями; «Изменить» — тоже форму.
 */

type State = { state: 'raising' } | { state: 'done', publicId: string } | { state: 'failed', error: string }

export function useWorkProposals() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const me = useMe().data?.principal.id
  const people = usePrincipals().data
  const scope = useScope()
  // Названия типов — все активные: тип из предложения может быть из любого пространства.
  const { types } = useTaskTypes(null)
  const [states, setStates] = useState<Record<string, State>>({})
  const fallbackSpace: string | undefined = scope.ws ?? workspaceOptions(scope.nodes)[0]?.value ?? undefined

  const accept = async (key: string, messageId: string, index: number, p: WorkProposal): Promise<void> => {
    setStates(s => ({ ...s, [key]: { state: 'raising' } }))
    try {
      const space = p.ws ?? fallbackSpace
      const owner = p.owner ?? me
      const task = await raiseWork({
        title: p.title, result: p.result ?? '', due: new Date(p.due!).toISOString(),
        ...(p.basis !== undefined ? { basis: p.basis } : {}),
        ...(p.type !== undefined ? { typeKey: p.type } : {}),
        ...(p.exec !== undefined ? { assigneeId: p.exec } : {}),
        ...(owner !== undefined ? { ownerId: owner } : {}),
        ...(space !== undefined ? { workspaceId: space } : {}),
      }, await proposalKey(messageId, index))
      void client.invalidateQueries({ queryKey: ['tasks'] })
      setStates(s => ({ ...s, [key]: { state: 'done', publicId: task.publicId } }))
    } catch (error) {
      setStates(s => ({ ...s, [key]: { state: 'failed', error: raiseError(error) } }))
    }
  }

  /** Сообщение-карточка предложения `index` из ответа `messageId`. */
  return (messageId: string, index: number, p: WorkProposal): AssistantMessage => {
    const key = `${messageId}:${index}`
    const st = states[key]
    const ready = proposalReady(p)
    const edit = (): void => { void navigate({ to: '/work/new', search: { ...p } }) }
    const type = p.type !== undefined ? types.find(ty => ty.key === p.type)?.displayName ?? p.type : t`Free-form work`
    const name = (id: string | undefined, none: string): string => id === undefined ? none : id === me ? t`you` : people?.get(id)?.displayName ?? '—'
    const due = p.due !== undefined ? new Date(p.due).toLocaleString(undefined, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : t`not set — add it`
    const where = p.ws !== undefined ? scope.nodes.find(n => n.id === p.ws)?.path.join(' / ') : undefined
    return {
      from: 'asst',
      proposal: p.title,
      fields: [
        [t`Type`, type],
        [t`Result`, p.result ?? t`not set — add it`],
        [t`Executes`, name(p.exec, t`not assigned yet`)],
        [t`Owner`, name(p.owner ?? me, t`you`)],
        [t`Due`, due],
        ...(where !== undefined ? [[t`Where`, where] as [string, string]] : []),
        ...(st?.state === 'failed' ? [[t`Not raised`, st.error] as [string, string]] : []),
      ],
      ...(st?.state === 'done'
        ? { done: <>{t`Raised:`} <Link to="/work/$ref" params={{ ref: st.publicId }}>{st.publicId}</Link></> }
        : st?.state === 'raising'
          ? { done: t`Raising…` }
          : {
              acceptLabel: ready ? t`Raise the work` : t`Complete`,
              onAccept: ready ? () => void accept(key, messageId, index, p) : edit,
              onEdit: edit,
            }),
    }
  }
}
