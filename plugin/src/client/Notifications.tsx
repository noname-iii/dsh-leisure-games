/**
 * Top-left agent notifications shown inside the games panel: pending approval
 * requests and finished projects. Each card carries the project name, the
 * detail (the model's reason plus the paired command line), and — for
 * approvals — the run/don't-run actions. Clicking a card (outside its action
 * buttons) closes the games panel and opens the owning session, returning the
 * user to the AI Agent interface.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionListState, ConversationSnapshot, RunningToolCall, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Notifications.module.css'

export type AgentNoticeT = TranslateNS<'leisure'>

/** Recursively find a running tool call by id. */
function findCall(calls: readonly ToolCallBlock[], callId: string): RunningToolCall | undefined {
  for (const call of calls) {
    if ('kind' in call) continue
    if (call.callId === callId) return call
    const child = findCall(call.subCalls, callId)
    if (child !== undefined) return child
  }
  return undefined
}

/** Extract the shell command from a bash-family tool call's args. */
export function commandOf(call: RunningToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    return typeof args.command === 'string' ? args.command : undefined
  } catch {
    return undefined
  }
}

export interface ApprovalNotice {
  kind: 'approval'
  sessionId: SessionId
  title: string
  toolName: string
  reason: string | undefined
  command: string | undefined
  wait: PendingWait<'approval'>
}

export interface CompletionNotice {
  kind: 'completion'
  sessionId: SessionId
  title: string
}

export type AgentNotice = ApprovalNotice | CompletionNotice

/**
 * Subscribe to one session's conversation snapshot (its pending waits and
 * running calls live there, not in the list projection).
 */
function useSessionSnapshot(sessions: ISessions, sessionId: SessionId | undefined): ConversationSnapshot | null {
  const binding = useMemo(
    () => (sessionId === undefined ? undefined : sessions.binding(sessionId)),
    [sessions, sessionId],
  )
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(() =>
    binding === undefined ? null : binding.session.getSnapshot())
  useEffect(() => {
    if (binding === undefined) {
      setSnapshot(null)
      return
    }
    setSnapshot(binding.session.getSnapshot())
    return binding.session.subscribe(() => { setSnapshot(binding.session.getSnapshot()) })
  }, [binding])
  return snapshot
}

/** Resolve a session's display title from the list projection. */
function titleOf(list: SessionListState, sessionId: SessionId): string {
  const row = list.byId[sessionId]
  return row?.displayTitle ?? sessionId
}

/** A single row of the notification stack. */
function NoticeCard(props: {
  notice: AgentNotice
  t: AgentNoticeT
  answering: boolean
  onAnswer: (notice: ApprovalNotice, outcome: 'allowed-once' | 'rejected') => void
  onNavigate: (sessionId: SessionId) => void
}) {
  const { notice, t, answering, onAnswer, onNavigate } = props
  const open = (): void => { onNavigate(notice.sessionId) }
  if (notice.kind === 'completion') {
    return (
      <button type="button" className={css.card} data-kind="completion" onClick={open}>
        <div className={css.cardTitle}>{t('notice.completion.title')}</div>
        <div className={css.project}>{t('notice.approval.project')}：{notice.title}</div>
        <div className={css.navHint}>{t('notice.completion.hint')}</div>
      </button>
    )
  }
  const approval = notice
  return (
    <div className={css.card} data-kind="approval">
      <button type="button" className={css.cardBody} onClick={open}>
        <div className={css.cardTitle}>{t('notice.approval.title')}</div>
        <div className={css.project}>{t('notice.approval.project')}：{approval.title}</div>
        <div className={css.detail}>
          <div className={css.detailLabel}>{t('notice.approval.detail')}</div>
          <div className={css.detailText}>
            {approval.reason ?? t('notice.approval.detail') + `（${approval.toolName}）`}
          </div>
        </div>
        {approval.command !== undefined && (
          <div className={css.commandBlock}>
            <div className={css.detailLabel}>{t('notice.approval.command')}</div>
            <code className={css.command}>{approval.command}</code>
          </div>
        )}
        <div className={css.navHint}>{t('notice.backToAgent')}</div>
      </button>
      <div className={css.actions}>
        <button
          type="button"
          className={css.deny}
          disabled={answering}
          onClick={() => { onAnswer(approval, 'rejected') }}
        >
          {t('notice.approval.deny')}
        </button>
        <button
          type="button"
          className={css.allow}
          disabled={answering}
          onClick={() => { onAnswer(approval, 'allowed-once') }}
        >
          {t('notice.approval.allow')}
        </button>
      </div>
    </div>
  )
}

/**
 * The notification stack. `useSessions` is the runtime standard hook of the
 * overlay entry; `sessions` is the service face injected for answering and
 * navigating.
 */
export function AgentNotifications(props: {
  useSessions: SnapshotSelectorHook<SessionListState>
  sessions: ISessions
  t: AgentNoticeT
  onNavigate: (sessionId: SessionId) => void
}) {
  const { useSessions, sessions, t, onNavigate } = props
  const list = useSessions(state => state)
  // The list status outranks sibling waits (a question hides a coexisting
  // approval), so bind both statuses and let the per-session snapshot filter
  // to real approval waits.
  const approvalIds = useMemo(
    () => list.ids.filter(id => {
      const status = list.byId[id]?.pendingInteraction
      return status === 'approval' || status === 'question'
    }),
    [list],
  )
  const completedIds = useMemo(
    () => list.ids.filter(id => list.byId[id]?.completed === true),
    [list],
  )
  const [answering, setAnswering] = useState<Record<string, boolean>>({})

  const answer = (notice: ApprovalNotice, outcome: 'allowed-once' | 'rejected'): void => {
    setAnswering(prev => ({ ...prev, [notice.wait.key]: true }))
    void notice.wait.respond({
      ok: true,
      value: { sessionId: notice.sessionId, approvalId: notice.wait.payload.approvalId, outcome },
    }).then(
      () => { setAnswering(prev => ({ ...prev, [notice.wait.key]: false })) },
      () => { setAnswering(prev => ({ ...prev, [notice.wait.key]: false })) },
    )
  }

  const cards: ReactNode[] = []
  for (const sessionId of approvalIds) {
    cards.push(
      <ApprovalCard key={`approval:${sessionId}`} sessionId={sessionId} title={titleOf(list, sessionId)}
        sessions={sessions} t={t} answering={answering} onAnswer={answer} onNavigate={onNavigate} />,
    )
  }
  for (const sessionId of completedIds) {
    cards.push(
      <NoticeCard key={`completion:${sessionId}`}
        notice={{ kind: 'completion', sessionId, title: titleOf(list, sessionId) }}
        t={t} answering={false} onAnswer={() => {}} onNavigate={onNavigate} />,
    )
  }
  if (cards.length === 0) return null
  return <div className={css.stack}>{cards}</div>
}

/** Approval card: binds to the owning session's snapshot for the wait payload and command. */
function ApprovalCard(props: {
  sessionId: SessionId
  title: string
  sessions: ISessions
  t: AgentNoticeT
  answering: Record<string, boolean>
  onAnswer: (notice: ApprovalNotice, outcome: 'allowed-once' | 'rejected') => void
  onNavigate: (sessionId: SessionId) => void
}) {
  const { sessionId, title, sessions, t, answering, onAnswer, onNavigate } = props
  const snapshot = useSessionSnapshot(sessions, sessionId)
  const waits = useMemo(
    () => snapshot?.pending.filter((wait): wait is PendingWait<'approval'> => wait.kind === 'approval') ?? [],
    [snapshot],
  )
  if (waits.length === 0) return null
  return (
    <>
      {waits.map(wait => (
        <NoticeCard
          key={wait.key}
          t={t}
          answering={answering[wait.key] === true}
          onAnswer={onAnswer}
          onNavigate={onNavigate}
          notice={{
            kind: 'approval',
            sessionId,
            title,
            toolName: wait.payload.toolName,
            reason: wait.payload.reason,
            command: wait.payload.callId === undefined
              ? undefined
              : commandOf(findCall(snapshot?.runningCalls ?? [], wait.payload.callId)),
            wait,
          }}
        />
      ))}
    </>
  )
}
