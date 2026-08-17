// @vitest-environment jsdom
/**
 * ui-leisure-games browser half over a real cordis Context: the plugin
 * registers the sidebar button into `sidebar.action` and the panel into
 * `shell.overlay` (both declared here by a stand-in parent entry), entries
 * carry the shared persisted store + locale namespace, the overlay inject
 * face exposes the sessions service, and fiber disposal cascades both
 * registrations. Component smoke: the sidebar button toggles the hub, the
 * hub renders its three tabs/settings/game views, and the agent
 * notifications surface approvals (with command + run/don't-run actions) and
 * completions.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SlotRegistry, type ConversationSnapshot, type ISessions, type SessionId, type SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { useSyncExternalStore } from 'react'
import { apply, inject } from '../src/client/index.ts'
import { DEFAULT_ENTRY_TEXT, leisureHub } from '../src/client/hub-store.ts'
import { LeisureSidebarButton } from '../src/client/SidebarButton.tsx'
import { GameHub, type GameHubProps } from '../src/client/GameHub.tsx'
import { AgentNotifications } from '../src/client/Notifications.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

const EMPTY_LIST: SessionListState = {
  ids: [], byId: {}, current: undefined, phase: 'ready',
  subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
}

interface Observable<T> { getSnapshot(): T; subscribe(fn: () => void): () => void }

/** Synthesize the framework's useStore selector hook over a bare snapshot store. */
function makeUseStore<T>(store: Observable<T>): <S>(selector: (s: T) => S) => S {
  const subscribe = (fn: () => void): (() => void) => store.subscribe(fn)
  let cached: unknown
  const getSnapshot = (selector: (s: T) => unknown): unknown => {
    cached = selector(store.getSnapshot())
    return cached
  }
  return (selector) => useSyncExternalStore(subscribe, () => getSnapshot(selector), () => getSnapshot(selector))
}

/** Stable fake sessions-list selector hook over one fixed snapshot. */
function makeUseSessions(state: SessionListState) {
  return makeUseStore({ getSnapshot: () => state, subscribe: () => () => {} })
}

/** Fake sessions service with the verbs the hub uses. */
function fakeSessions(): ISessions {
  return {
    open: () => {},
    binding: () => undefined,
  } as unknown as ISessions
}

/** Boot the plugin over fake faces, with the two parent slots declared by a stand-in root entry. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, (() => null) as never)
  const locale = new LocaleRuntime(ctx)
  ctx.reflect.provide('locale', locale)
  ctx.reflect.provide('sessions', fakeSessions())
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber
  return { ctx, fiber, locale }
}

describe('ui-leisure-games browser plugin', () => {
  it('registers the sidebar button and the overlay panel with the shared store and locale', async () => {
    const b = await bench()
    const sidebar = b.ctx.slots.entries('sidebar.action')
    expect(sidebar).toHaveLength(1)
    expect(sidebar[0]?.options).toMatchObject({ id: 'leisure-games' })
    expect(sidebar[0]?.locale).toBe('leisure')
    expect(sidebar[0]?.store).toBeDefined()
    const overlay = b.ctx.slots.entries('shell.overlay')
    expect(overlay).toHaveLength(1)
    expect(overlay[0]?.options).toMatchObject({ id: 'leisure-games' })
    expect(overlay[0]?.store).toBeDefined()
    // The overlay inject face carries the sessions service for notifications.
    const injected = overlay[0]?.inject as (actions: unknown) => { sessions: ISessions }
    expect(injected({})['sessions']).toBeDefined()
    expect(injected({})['sessions'].open).toBeTypeOf('function')
    // Dictionaries registered.
    expect((b.locale as unknown as { bind: (ns: string) => (key: string) => string }).bind('leisure')('hub.title'))
      .toBe('DSH-Leisure-Games')
  })

  it('disposal cascades both registrations with the fiber (HMR safety)', async () => {
    const b = await bench()
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('sidebar.action')).toHaveLength(0)
    expect(b.ctx.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('the sidebar button toggles the shared hub store', () => {
    const store = leisureHub.create()
    const t = makeTranslate(zh)
    const view = render(
      <LeisureSidebarButton
        wide={true}
        useStore={makeUseStore(store) as never}
        actions={store.actions as never}
        t={t as never}
      />,
    )
    expect(store.getSnapshot().open).toBe(false)
    act(() => { fireEvent.click(view.getByRole('button')) })
    expect(store.getSnapshot().open).toBe(true)
    expect(store.getSnapshot().view).toBe('home')
    act(() => { fireEvent.click(view.getByRole('button')) })
    expect(store.getSnapshot().open).toBe(false)
  })
})

describe('GameHub smoke', () => {
  function renderHub(store = leisureHub.create()) {
    const props = {
      useStore: makeUseStore(store),
      actions: store.actions,
      t: makeTranslate(zh),
      useSessions: makeUseSessions(EMPTY_LIST),
      sessions: fakeSessions(),
    } as unknown as GameHubProps
    const view = render(<GameHub {...props} />)
    const mutate = (fn: () => void): void => { act(fn) }
    return { view, store, mutate }
  }

  it('renders nothing while closed, then the three game tabs, settings, and exit', () => {
    const { view, store, mutate } = renderHub()
    expect(screen.queryByText('DSH-Leisure-Games')).toBeNull()
    mutate(() => { store.actions.open() })
    expect(view.getAllByText('DSH-Leisure-Games').length).toBeGreaterThan(0)
    expect(view.getByText('Tetris - 俄罗斯方块')).toBeTruthy()
    expect(view.getByText('Nsnake - 贪吃蛇')).toBeTruthy()
    expect(view.getByText('Leiting Wuziqi - 技能五子棋')).toBeTruthy()
    expect(view.getByRole('button', { name: /设置/ })).toBeTruthy()
    expect(view.getAllByText('退出游戏').length).toBeGreaterThan(0)
  })

  it('enters the snake game, returns home, and stops the session clock', async () => {
    const { view, store, mutate } = renderHub()
    mutate(() => { store.actions.open() })
    fireEvent.click(view.getByRole('button', { name: /Nsnake - 贪吃蛇/ }))
    expect(store.getSnapshot().view).toBe('snake')
    expect(store.getSnapshot().sessionStartedAt).not.toBeNull() // in game → timing
    // Pausing does NOT stop the clock (只有退出游戏才停止计时).
    fireEvent.click(view.getByRole('button', { name: /暂停/ }))
    expect(store.getSnapshot().sessionStartedAt).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: /返回主页/ }))
    await act(async () => {}) // flush the deferred atomic exit transition
    expect(store.getSnapshot().view).toBe('home')
    expect(store.getSnapshot().sessionStartedAt).toBeNull() // exit stopped timing
  })

  it('enters gomoku, picks black, and the board appears', () => {
    const { view, store, mutate } = renderHub()
    mutate(() => { store.actions.open() })
    fireEvent.click(view.getByRole('button', { name: /Leiting Wuziqi/ }))
    expect(view.getByText('选择执子颜色')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /执黑/ }))
    expect(store.getSnapshot().progress.gomoku).not.toBeNull() // progress persisted live
    expect(view.getByText('轮到你落子')).toBeTruthy()
  })

  it('settings edits persist and the limit toggle works', async () => {
    const { view, store, mutate } = renderHub()
    mutate(() => { store.actions.open() })
    fireEvent.click(view.getByRole('button', { name: /设置/ }))
    expect(view.getByText('游玩时长限制')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '已开启' }))
    expect(store.getSnapshot().limitEnabled).toBe(false)
    fireEvent.click(view.getByRole('button', { name: /返回主页/ }))
    await act(async () => {}) // flush the deferred atomic exit transition
    expect(store.getSnapshot().view).toBe('home')
  })

  it('customizes the menu accent and the game-entry text colors from the appearance settings', () => {
    const { view, store, mutate } = renderHub()
    mutate(() => { store.actions.open() })
    fireEvent.click(view.getByRole('button', { name: /设置/ }))
    expect(view.getByText('菜单按钮颜色')).toBeTruthy()
    expect(view.getByText('游戏入口文字颜色')).toBeTruthy()
    const inputs = view.container.querySelectorAll('input[type="color"]')
    expect(inputs.length).toBe(2)
    fireEvent.change(inputs[0]!, { target: { value: '#e2544a' } })
    expect(store.getSnapshot().settings.appearance.accent).toBe('#e2544a')
    fireEvent.change(inputs[1]!, { target: { value: '#ffd54a' } })
    expect(store.getSnapshot().settings.appearance.entryText).toBe('#ffd54a')
    // The panel root exposes both colors as CSS variables for the chrome.
    const styled = view.container.querySelector<HTMLElement>('[style*="--leisure-accent"]')
    expect(styled?.style.getPropertyValue('--leisure-accent')).toBe('#e2544a')
    expect(styled?.style.getPropertyValue('--leisure-entry-text')).toBe('#ffd54a')
    const resets = view.getAllByRole('button', { name: '恢复默认' })
    fireEvent.click(resets[0]!)
    expect(store.getSnapshot().settings.appearance.accent).toBe('#4c78f5')
    fireEvent.click(resets[1]!)
    expect(store.getSnapshot().settings.appearance.entryText).toBe(DEFAULT_ENTRY_TEXT)
  })
})

describe('agent notifications', () => {
  const sid = (k: string): SessionId => k as SessionId

  function snapshotWithApproval(options: {
    approvalId: string
    toolName: string
    reason: string
    callId?: string
    command?: string
  }): ConversationSnapshot {
    const wait = new PendingWait('approval', `rpc:${options.approvalId}` as never, sid('s-approval'), {
      approvalId: options.approvalId as never,
      toolName: options.toolName,
      ...(options.callId === undefined ? {} : { callId: options.callId }),
      reason: options.reason,
    }, async () => ({ accepted: true } as never))
    const runningCalls = options.callId === undefined ? [] : [{
      callId: options.callId,
      name: 'bash',
      argsRaw: JSON.stringify({ command: options.command ?? 'echo hi' }),
      turn: 1,
      step: 1,
      time: 0,
      callView: null,
      subCalls: [],
    }]
    const pending = [wait]
    return {
      sessionId: sid('s-approval'),
      views: undefined as never,
      chat: undefined as never,
      nodes: [],
      turnTimings: new Map(),
      turnEnds: new Map(),
      partial: null,
      runningCalls: runningCalls as never,
      pending: pending as never,
      queue: [],
      running: true,
      subagent: null,
      composerPhase: 'active',
      removed: false,
      openState: 'open',
      openError: null,
      hasMore: false,
      loadingOlder: false,
      promptError: null,
      blank: false,
      lastAgentError: null,
    } as unknown as ConversationSnapshot
  }

  function renderNotifications(list: SessionListState, snapshots: Map<string, ConversationSnapshot>) {
    const sessions = {
      binding: (id: SessionId) => {
        const snapshot = snapshots.get(id)
        if (snapshot === undefined) return undefined
        return {
          sessionId: id,
          session: { getSnapshot: () => snapshot, subscribe: () => () => {} },
          ctx: undefined as never,
        }
      },
    } as unknown as ISessions
    const navigated: SessionId[] = []
    const view = render(
      <AgentNotifications
        useSessions={makeUseStore({ getSnapshot: () => list, subscribe: () => () => {} }) as never}
        sessions={sessions}
        t={makeTranslate(zh) as never}
        onNavigate={id => { navigated.push(id) }}
      />,
    )
    return { view, navigated }
  }

  function row(id: SessionId, displayTitle: string, extra: Partial<SessionListState['byId'][SessionId]> = {}): SessionListState {
    return {
      ids: [id],
      byId: { [id]: {
        id, displayTitle, running: true, blank: false, updatedAt: 1, ...extra,
      } },
      current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }
  }

  it('shows an approval card with project, detail, command, and run/don\'t-run actions', () => {
    const list = row(sid('s-approval'), '演示项目', { pendingInteraction: 'approval' })
    const { view } = renderNotifications(list, new Map([[
      's-approval',
      snapshotWithApproval({
        approvalId: 'ap-1', toolName: 'bash', reason: '需要运行构建命令', callId: 'call-1', command: 'pnpm run build',
      }),
    ]]))
    expect(view.getByText('AI 请求批准操作')).toBeTruthy()
    expect(view.getByText(/演示项目/)).toBeTruthy()
    expect(view.getByText('需要运行构建命令')).toBeTruthy()
    expect(view.getByText('pnpm run build')).toBeTruthy()
    expect(view.getByRole('button', { name: '运行' })).toBeTruthy()
    expect(view.getByRole('button', { name: '不运行' })).toBeTruthy()
  })

  it('surfaces an approval that a coexisting question hides in the list status', () => {
    const list = row(sid('s-approval'), '演示项目', { pendingInteraction: 'question' })
    const { view } = renderNotifications(list, new Map([[
      's-approval',
      snapshotWithApproval({ approvalId: 'ap-2', toolName: 'rm', reason: '删除文件' }),
    ]]))
    expect(view.getByText('AI 请求批准操作')).toBeTruthy()
    expect(view.getByText(/删除文件/)).toBeTruthy()
  })

  it('shows a completion card and navigates back to the agent on click', () => {
    const list = row(sid('s-done'), '已完成项目', { running: false, completed: true })
    const { view, navigated } = renderNotifications(list, new Map())
    const card = view.getByText('AI 已完成项目')
    expect(card).toBeTruthy()
    fireEvent.click(card)
    expect(navigated).toEqual([sid('s-done')])
  })

  it('answers a pending approval through the carrier and navigates by card click', () => {
    const snapshot = snapshotWithApproval({ approvalId: 'ap-3', toolName: 'bash', reason: '运行脚本', callId: 'c3', command: 'node x.js' })
    const list = row(sid('s-approval'), '演示项目', { pendingInteraction: 'approval' })
    const { view, navigated } = renderNotifications(list, new Map([['s-approval', snapshot]]))
    const wait = snapshot.pending[0] as PendingWait<'approval'>
    const respondSpy = vi.spyOn(wait, 'respond')
    fireEvent.click(view.getByRole('button', { name: '运行' }))
    expect(respondSpy).toHaveBeenCalledWith({
      ok: true,
      value: { sessionId: sid('s-approval'), approvalId: 'ap-3' as never, outcome: 'allowed-once' },
    })
    fireEvent.click(view.getByText('AI 请求批准操作'))
    expect(navigated).toEqual([sid('s-approval')])
  })
})
