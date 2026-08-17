// @vitest-environment jsdom
/**
 * Hub store: the playtime accounting contract — timing starts/stops with the
 * game session, exits stop the clock, the default 30-minute limit blocks play
 * with the rest state, and the 60-minute cooldown resets it. Also settings
 * clamping and the localStorage persistence round-trip.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ACCENT, DEFAULT_ENTRY_TEXT, DEFAULT_STATE, HUB_PERSIST_KEY, LIMIT_RESET_COOLDOWN_MS,
  leisureHub, mergePersistedDefaults, migratePersistedState,
} from '../src/client/hub-store.ts'
import { MAX_STATE_BYTES } from '../src/client/security.ts'

beforeEach(() => {
  localStorage.clear()
})

function instance() {
  return leisureHub.create()
}

describe('hub store', () => {
  it('defaults to the required settings: 30-minute limit on, snake 20×10 with 5 food / 5 obstacles / length 3, gomoku 15×15', () => {
    const store = instance()
    const s = store.getSnapshot()
    expect(s.limitEnabled).toBe(true)
    expect(s.limitMinutes).toBe(30)
    expect(s.settings.snake).toMatchObject({ rows: 20, cols: 10, foodCount: 5, obstacleCount: 5, initialLength: 3 })
    expect(s.settings.gomoku).toMatchObject({ rows: 15, cols: 15 })
  })

  it('accounts playtime only while a session is active (exit stops the clock)', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      const store = instance()
      store.actions.setSessionActive(true)
      vi.setSystemTime(1_000_000 + 10_000)
      store.actions.tick(Date.now())
      store.actions.setSessionActive(false) // exit: accumulates and stops
      vi.setSystemTime(1_000_000 + 60_000)
      store.actions.tick(Date.now())
      expect(store.getSnapshot().playedMs).toBe(10_000)
      expect(store.getSnapshot().sessionStartedAt).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('blocks at the 30-minute default with the rest state and forces the hub home', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      const store = instance()
      store.actions.setView('snake')
      store.actions.setSessionActive(true)
      vi.setSystemTime(1_000_000 + 30 * 60_000)
      store.actions.tick(Date.now())
      const s = store.getSnapshot()
      expect(s.playedMs).toBe(30 * 60_000)
      expect(s.limitReachedAt).toBe(1_000_000 + 30 * 60_000)
      expect(s.view).toBe('home') // forced back with the message
      expect(s.sessionStartedAt).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets 60 minutes after the limit was reached', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      const store = instance()
      store.actions.setSessionActive(true)
      vi.setSystemTime(1_000_000 + 30 * 60_000)
      store.actions.tick(Date.now())
      expect(store.getSnapshot().limitReachedAt).not.toBeNull()
      // Just before the cooldown ends, still blocked.
      vi.setSystemTime(1_000_000 + 30 * 60_000 + LIMIT_RESET_COOLDOWN_MS - 1000)
      store.actions.tick(Date.now())
      expect(store.getSnapshot().limitReachedAt).not.toBeNull()
      // After 60 minutes: reset.
      vi.setSystemTime(1_000_000 + 30 * 60_000 + LIMIT_RESET_COOLDOWN_MS)
      store.actions.tick(Date.now())
      expect(store.getSnapshot().limitReachedAt).toBeNull()
      expect(store.getSnapshot().playedMs).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never blocks while the limit is disabled', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000_000)
      const store = instance()
      store.actions.setLimitEnabled(false)
      store.actions.setSessionActive(true)
      vi.setSystemTime(1_000_000 + 120 * 60_000)
      store.actions.tick(Date.now())
      expect(store.getSnapshot().limitReachedAt).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clamps numeric settings to sane ranges', () => {
    const store = instance()
    store.actions.setLimitMinutes(0)
    expect(store.getSnapshot().limitMinutes).toBe(1)
    store.actions.setLimitMinutes(9999)
    expect(store.getSnapshot().limitMinutes).toBe(600)
    store.actions.setSnakeSettings({ rows: 1, cols: 999 })
    expect(store.getSnapshot().settings.snake.rows).toBe(1) // raw patch passes through; form clamps
    expect(store.getSnapshot().settings.snake.cols).toBe(999)
  })

  it('persists settings and progress to localStorage and rehydrates', () => {
    const store = instance()
    store.actions.setSnakeSettings({ speedMs: 90 })
    store.actions.saveSnakeProgress({
      rows: 20, cols: 10, body: [{ r: 1, c: 1 }], direction: 'up', pendingTurn: null,
      foods: [], obstacles: [], score: 42, steps: 3, status: 'running', overReason: null,
    })
    const revived = leisureHub.create()
    expect(revived.getSnapshot().settings.snake.speedMs).toBe(90)
    expect(revived.getSnapshot().progress.snake?.score).toBe(42)
    localStorage.clear()
  })

  it('view navigation through the shared actions', () => {
    const store = instance()
    store.actions.open()
    expect(store.getSnapshot()).toMatchObject({ open: true, view: 'home' })
    store.actions.setView('gomoku')
    expect(store.getSnapshot().view).toBe('gomoku')
    store.actions.backHome()
    expect(store.getSnapshot().view).toBe('home')
    store.actions.close()
    expect(store.getSnapshot().open).toBe(false)
    expect(DEFAULT_STATE.limitMinutes).toBe(30)
  })
})

describe('persisted-state migration', () => {
  it('upgrades an old (pre-minesweeper / pre-appearance) state with defaults, keeping user values', () => {
    // The exact shape a browser persisted before the minesweeper update.
    const oldState = {
      open: false,
      view: 'home',
      limitEnabled: false,
      limitMinutes: 30,
      playedMs: 5000,
      sessionStartedAt: null,
      limitReachedAt: null,
      settings: {
        snake: { rows: 20, cols: 10, speedMs: 90, foodCount: 5, obstacleCount: 5, initialLength: 3, bgm: null, bgImage: null },
        gomoku: { rows: 15, cols: 15, aiStrength: 'strong', bgm: null, bgImage: null },
        tetris: { cols: 20, rows: 10, speedMs: 800, lockDelayMs: 500, pieceSet: 'classic', showGrid: true, showGhost: true, bgm: null, bgImage: null },
      },
      progress: { snake: null, gomoku: null, tetris: null },
    }
    localStorage.setItem(HUB_PERSIST_KEY, JSON.stringify(oldState))
    migratePersistedState()
    const migrated = JSON.parse(localStorage.getItem(HUB_PERSIST_KEY) ?? '{}') as Record<string, unknown>
    const settings = migrated.settings as Record<string, unknown>
    // Old user values survive…
    expect(settings.snake).toMatchObject({ speedMs: 90 })
    expect(settings.gomoku).toMatchObject({ aiStrength: 'strong' })
    // …and new keys gain defaults.
    expect(settings.minesweeper).toMatchObject({ rows: 20, cols: 30, mines: 17 })
    expect(settings.appearance).toMatchObject({ accent: DEFAULT_ACCENT, entryText: DEFAULT_ENTRY_TEXT })
    expect(migrated.playedMs).toBe(5000)
    // A rehydrated store works end-to-end with the migrated shape.
    const store = leisureHub.create()
    expect(store.getSnapshot().settings.minesweeper.rows).toBe(20)
    expect(store.getSnapshot().settings.appearance.accent).toBe(DEFAULT_ACCENT)
    expect(store.getSnapshot().settings.snake.speedMs).toBe(90)
  })

  it('is idempotent and tolerates malformed persisted values', () => {
    localStorage.setItem(HUB_PERSIST_KEY, 'not-json{')
    expect(() => { migratePersistedState() }).not.toThrow()
    localStorage.setItem(HUB_PERSIST_KEY, '42')
    expect(() => { migratePersistedState() }).not.toThrow()
    // A complete current state survives the merge unchanged.
    localStorage.setItem(HUB_PERSIST_KEY, JSON.stringify(DEFAULT_STATE))
    migratePersistedState()
    expect(JSON.parse(localStorage.getItem(HUB_PERSIST_KEY) ?? '{}')).toEqual(DEFAULT_STATE)
  })

  it('mergePersistedDefaults handles nested objects, arrays, and primitives', () => {
    expect(mergePersistedDefaults({ a: 1, b: { c: 2 } }, { a: 9 })).toEqual({ a: 9, b: { c: 2 } })
    expect(mergePersistedDefaults([1, 2], [3])).toEqual([3])
    expect(mergePersistedDefaults('x', undefined)).toBe('x')
    expect(mergePersistedDefaults({ a: { b: 1 } }, { a: 'junk' })).toEqual({ a: { b: 1 } })
  })

  it('validates and stores the menu accent color', () => {
    const store = instance()
    expect(store.getSnapshot().settings.appearance.accent).toBe(DEFAULT_ACCENT)
    store.actions.setAccent('#e2544a')
    expect(store.getSnapshot().settings.appearance.accent).toBe('#e2544a')
    store.actions.setAccent('red') // invalid → ignored
    expect(store.getSnapshot().settings.appearance.accent).toBe('#e2544a')
    store.actions.setAccent('#AABBCC')
    expect(store.getSnapshot().settings.appearance.accent).toBe('#AABBCC')
  })

  it('validates and stores the game-entry text color of the start menu', () => {
    const store = instance()
    expect(store.getSnapshot().settings.appearance.entryText).toBe(DEFAULT_ENTRY_TEXT)
    store.actions.setEntryText('#ffd54a')
    expect(store.getSnapshot().settings.appearance.entryText).toBe('#ffd54a')
    store.actions.setEntryText('url(javascript:alert(1))') // invalid → ignored
    expect(store.getSnapshot().settings.appearance.entryText).toBe('#ffd54a')
    store.actions.setEntryText('#abcdef')
    expect(store.getSnapshot().settings.appearance.entryText).toBe('#abcdef')
  })
})

describe('security sanitization', () => {
  it('rejects non-data-URL and foreign-scheme media in settings patches', () => {
    const store = instance()
    store.actions.setSnakeSettings({ bgImage: 'https://evil.example/x.png' })
    expect(store.getSnapshot().settings.snake.bgImage).toBeNull()
    store.actions.setGomokuSettings({ bgm: 'javascript:alert(1)' })
    expect(store.getSnapshot().settings.gomoku.bgm).toBeNull()
    // CSS break-out attempts never survive.
    store.actions.setMinesweeperSettings({ bgImage: 'data:image/png;base64,AAAA");background:url("https://evil.example' })
    expect(store.getSnapshot().settings.minesweeper.bgImage).toBeNull()
    store.actions.setTetrisSettings({ bgImage: 'x");background-image:url("y' })
    expect(store.getSnapshot().settings.tetris.bgImage).toBeNull()
  })

  it('accepts well-formed base64 media data URLs', () => {
    const store = instance()
    const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const audio = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
    store.actions.setSnakeSettings({ bgImage: img })
    expect(store.getSnapshot().settings.snake.bgImage).toBe(img)
    store.actions.setSnakeSettings({ bgm: audio })
    expect(store.getSnapshot().settings.snake.bgm).toBe(audio)
  })

  it('sanitizes a tampered persisted payload on migration (huge board, CSS injection, prototype keys)', () => {
    const evil = {
      ...JSON.parse(JSON.stringify(DEFAULT_STATE)),
      settings: {
        ...JSON.parse(JSON.stringify(DEFAULT_STATE.settings)),
        snake: {
          ...JSON.parse(JSON.stringify(DEFAULT_STATE.settings.snake)),
          rows: 999999, cols: -5, bgImage: 'x");background:url("https://evil.example',
        },
        gomoku: { ...JSON.parse(JSON.stringify(DEFAULT_STATE.settings.gomoku)), rows: 1e9 },
        minesweeper: { ...JSON.parse(JSON.stringify(DEFAULT_STATE.settings.minesweeper)), mines: 1e9, cols: 1e6 },
        tetris: { ...JSON.parse(JSON.stringify(DEFAULT_STATE.settings.tetris)), rows: 1e9 },
        appearance: { accent: 'red', entryText: 'url(javascript:x)' },
      },
      playedMs: 1e12,
      limitMinutes: -7,
      view: 'evil-view',
      open: 'yes',
    }
    // Simulate a JSON payload whose text carries its own "__proto__" key.
    const raw = JSON.stringify(evil).replace('"settings"', '"__proto__":{"polluted":true},"settings"')
    localStorage.setItem(HUB_PERSIST_KEY, raw)
    migratePersistedState()
    const migrated = JSON.parse(localStorage.getItem(HUB_PERSIST_KEY) ?? '{}') as Record<string, unknown>
    expect(migrated.view).toBe('home')
    expect(migrated.open).toBe(false)
    expect(migrated.playedMs).toBeLessThanOrEqual(600 * 60_000)
    expect(migrated.limitMinutes).toBe(1)
    const settings = migrated.settings as Record<string, unknown>
    const snake = settings.snake as Record<string, unknown>
    const gomoku = settings.gomoku as Record<string, unknown>
    const minesweeper = settings.minesweeper as Record<string, unknown>
    const tetris = settings.tetris as Record<string, unknown>
    const appearance = settings.appearance as Record<string, unknown>
    expect(snake.rows).toBe(60) // clamped, not 999999
    expect(snake.cols).toBe(8)
    expect(snake.bgImage).toBeNull()
    expect(gomoku.rows).toBe(25)
    expect(minesweeper.mines).toBeLessThanOrEqual(500)
    expect(minesweeper.cols).toBe(60)
    expect(tetris.rows).toBe(40)
    expect(appearance.accent).toBe(DEFAULT_ACCENT)
    expect(appearance.entryText).toBe(DEFAULT_ENTRY_TEXT)
    expect((migrated as Record<string, unknown>).polluted).toBeUndefined()
    // The rehydrated store never sees the hostile values.
    const store = leisureHub.create()
    expect(store.getSnapshot().settings.snake.rows).toBe(60)
    expect(store.getSnapshot().settings.minesweeper.cols).toBe(60)
  })

  it('drops a pathologically oversized persisted payload and resets to defaults', () => {
    // jsdom's localStorage quota (5MB) is far below MAX_STATE_BYTES, so the
    // oversized payload is fed through a mocked getItem instead of setItem.
    const huge = 'x'.repeat(MAX_STATE_BYTES + 1)
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(huge)
    expect(() => { migratePersistedState() }).not.toThrow()
    getItem.mockRestore()
    expect(localStorage.getItem(HUB_PERSIST_KEY)).toBe(JSON.stringify(DEFAULT_STATE))
  })
})
