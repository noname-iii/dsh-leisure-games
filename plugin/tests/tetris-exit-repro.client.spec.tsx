// @vitest-environment jsdom
/**
 * Repro probe for the tetris exit crash (#185) seen in the live browser:
 * full key sequence (arrows + soft drop + q) then unmount, with a rAF
 * polyfill so the real game loop runs under jsdom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { leisureHub } from '../src/client/hub-store.ts'
import { TetrisGame } from '../src/client/games/tetris/TetrisGame.tsx'
import { zh } from '../src/client/locales.ts'
import type { GameProps } from '../src/client/games/shared.ts'

afterEach(() => { localStorage.clear(); cleanup() })

function makeUseStore<T>(store: { getSnapshot(): T; subscribe(fn: () => void): () => void }): <S>(sel: (s: T) => S) => S {
  let cached: unknown
  const subscribe = (fn: () => void): (() => void) => store.subscribe(fn)
  const getSnapshot = (selector: (s: T) => unknown): unknown => {
    cached = selector(store.getSnapshot())
    return cached
  }
  return (selector) => useSyncExternalStore(subscribe, () => getSnapshot(selector), () => getSnapshot(selector))
}

describe('tetris exit repro', () => {
  it('survives the full key sequence and unmount', async () => {
    const raf = new Map<number, FrameRequestCallback>()
    let nextId = 1
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      raf.set(nextId, cb)
      return nextId++
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => { raf.delete(id) })
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const store = leisureHub.create()
    const props = {
      useStore: makeUseStore(store),
      actions: store.actions,
      t: makeTranslate(zh) as never,
      onExit: () => { store.actions.backHome() },
      timeLeft: '29:59',
    } as GameProps
    const view = render(<TetrisGame {...props} />)
    // Run 60 frames of the game loop.
    for (let i = 0; i < 60; i++) {
      now += 16.7
      const callbacks = [...raf.values()]
      raf.clear()
      act(() => { for (const cb of callbacks) cb(now) })
    }
    // Key sequence from the E2E.
    act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft' }) })
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }) })
    act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }) })
    act(() => { fireEvent.keyDown(window, { key: 'q' }) })
    act(() => { view.unmount() })
    vi.unstubAllGlobals()
    expect(true).toBe(true)
  })
})
