import { useQuery } from '@tanstack/react-query'
import { API, consoleFetch, getJson } from './client.ts'

/**
 * Люди организации через BFF (`apps/bff/src/org.ts`, TAI-ADR-0058 п.6): добавить человека,
 * довести недоведённое, отключить и включить — потоками, которые идут и в IAM (scope
 * `iam:people`, только администраторам людей), и в ядро. Каждый поток отвечает отчётом по
 * шагам: сбой посреди — не 5xx, а «что сделано и на чём остановились»; повтор доводит.
 */

export const STEPS = ['iam_principal', 'identity', 'cp_principal', 'binding', 'member', 'roles'] as const
/** `idp_user` — пользователь у провайдера входа, если его заводит консоль. */
export type StepName = 'idp_user' | typeof STEPS[number]
export interface StepError { status: number, code: string, missing?: string[] }
export interface Step { name: StepName, status: 'pending' | 'done' | 'reused' | 'failed', error?: StepError }

export interface PersonInput { displayName: string, email: string, subject: string, workspaceId: string, roleIds: string[], permissions: string[], createIdpUser?: boolean }
export interface FlowReport {
  flowId: string, complete: boolean, steps: Step[], iamPrincipalId: string | null, cpPrincipalId: string | null, loginUrl: string | null
  /** Пользователь у провайдера, если его заводила консоль; временный пароль — только у нового, один раз. */
  idpUser?: { created: boolean, temporaryPassword?: string }
}

export interface PendingPerson {
  kind: 'core' | 'iam_only'
  displayName: string
  iamPrincipalId: string | null
  cpPrincipalId: string | null
  input: PersonInput | null
  missing: StepName[]
}
/**
 * `iam: false` — у вошедшего нет `iam:people`: добавлять людей нельзя, видно недоведённое в ядре.
 * `idpAdmin` — консоль заводит пользователя у провайдера входа сама.
 */
export interface PendingPage { items: PendingPerson[], truncated: boolean, iam: boolean, idpAdmin?: boolean }

type Status = 'pending' | 'done' | 'reused' | 'failed' | 'skipped'
export interface DisableReport { complete: boolean, iam: Status, cp: Status, error?: StepError & { service: 'iam' | 'cp' } }
export interface EnableReport { complete: boolean, iam: Status, cp: Status, binding: Status, permissions: string[] | null, error?: StepError & { service: 'iam' | 'cp' } }

const post = async <T>(path: string, body: unknown, key?: string): Promise<T> => {
  const response = await consoleFetch(`${API}/org${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(key !== undefined ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body),
  })
  return await response.json() as T
}

export function usePendingPeople() {
  return useQuery({
    queryKey: ['org', 'people', 'pending'], staleTime: 30_000, retry: false,
    queryFn: ({ signal }) => getJson<PendingPage>(`${API}/org/people/pending`, { signal }),
  })
}

export const addPerson = (input: PersonInput): Promise<FlowReport> => post('/people', input)
export const disablePersonFlow = (id: string, reason: string): Promise<DisableReport> => post(`/people/${id}:disable`, reason.trim() !== '' ? { reason: reason.trim() } : {})
export const enablePersonFlow = (id: string, reason: string, permissions: string[], key: string): Promise<EnableReport> =>
  post(`/people/${id}:enable`, { permissions, ...(reason.trim() !== '' ? { reason: reason.trim() } : {}) }, key)
