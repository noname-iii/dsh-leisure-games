/**
 * Hub store: the single persisted state of the leisure-games plugin. One
 * store handle is shared by the sidebar button entry and the shell-overlay
 * panel entry (same root-scope handle → one live instance), so opening the
 * panel from the sidebar and every in-game mutation ride the same snapshot.
 *
 * Persistence contract (localStorage, JSON-safe only): settings, playtime
 * accounting, and per-game progress survive exiting a game, closing the
 * panel, and a full page reload. Timing stops whenever no game session is
 * active — exiting a game or the panel clears the session marker.
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { TetrisSnapshot } from './games/tetris/engine.ts'
import type { SnakeSnapshot } from './games/snake/engine.ts'
import type { GomokuSnapshot } from './games/gomoku/engine.ts'
import type { MinesweeperSnapshot } from './games/minesweeper/engine.ts'
import { MAX_STATE_BYTES, sanitizeDataUrl, sanitizeHexColor, sanitizeLeisureState } from './security.ts'

/** Tab identity of the games. */
export type HubTab = 'tetris' | 'snake' | 'gomoku' | 'minesweeper'

/** Panel view: hub home with the tabs, the settings page, or a game. */
export type HubView = 'home' | 'settings' | HubTab

/** Snake tunables, all persisted. */
export interface SnakeSettings {
  rows: number
  cols: number
  /** Milliseconds per step; smaller is faster. */
  speedMs: number
  foodCount: number
  obstacleCount: number
  initialLength: number
  /** Data-URL background music, null = none. */
  bgm: string | null
  /** Data-URL background image, null = default. */
  bgImage: string | null
}

/** Gomoku tunables, all persisted. */
export interface GomokuSettings {
  rows: number
  cols: number
  aiStrength: 'weak' | 'medium' | 'strong'
  /** Data-URL background music, null = none. */
  bgm: string | null
  /** Data-URL background image, null = default. */
  bgImage: string | null
}

/** Tetris tunables (its own in-game panel feeds these back). */
export interface TetrisSettings {
  cols: number
  rows: number
  /** Base fall speed in ms. */
  speedMs: number
  lockDelayMs: number
  pieceSet: 'classic' | 'extended' | 'single'
  showGrid: boolean
  showGhost: boolean
  /** Data-URL background music, null = none. */
  bgm: string | null
  /** Data-URL background image, null = default. */
  bgImage: string | null
}

/** Minesweeper tunables, all persisted (classic defaults: 20×30, 17 mines). */
export interface MinesweeperSettings {
  rows: number
  cols: number
  mines: number
  /** Data-URL background music, null = none. */
  bgm: string | null
  /** Data-URL background image, null = default. */
  bgImage: string | null
}

/** Per-game saved progress; null = fresh game next time. */
export interface GameProgress {
  snake: SnakeSnapshot | null
  gomoku: GomokuSnapshot | null
  tetris: TetrisSnapshot | null
  minesweeper: MinesweeperSnapshot | null
}

/** Appearance tunables: menu accent color and game-entry text color. */
export interface AppearanceSettings {
  /** Accent color (hex) used by the sidebar button and the hub chrome. */
  accent: string
  /** Text color (hex) of the game entries in the start menu (hub tabs + sidebar label). */
  entryText: string
}

/** Whole plugin state. Everything here is JSON-serializable. */
export interface LeisureState {
  /** Whether the full-screen panel is open. */
  open: boolean
  /** Current panel view. */
  view: HubView
  /** Playtime limit switch. */
  limitEnabled: boolean
  /** Playtime limit in minutes (default 30). */
  limitMinutes: number
  /** Accumulated played milliseconds across finished sessions. */
  playedMs: number
  /** Epoch ms when the current game session started; null = no active session (timing stopped). */
  sessionStartedAt: number | null
  /** Epoch ms when the limit was reached; non-null blocks games until the 60-minute cooldown passes. */
  limitReachedAt: number | null
  settings: {
    snake: SnakeSettings
    gomoku: GomokuSettings
    tetris: TetrisSettings
    minesweeper: MinesweeperSettings
    appearance: AppearanceSettings
  }
  progress: GameProgress
}

/** Cooldown after hitting the limit before playtime resets (60 minutes). */
export const LIMIT_RESET_COOLDOWN_MS = 60 * 60 * 1000

/** localStorage key of the persisted hub state. */
export const HUB_PERSIST_KEY = 'dsh.leisure-games.v1'

/** Default accent color of the menu (sidebar button + hub chrome). */
export const DEFAULT_ACCENT = '#4c78f5'

/** Default text color of the game entries in the start menu. */
export const DEFAULT_ENTRY_TEXT = '#e6e8f2'

/** Defaults the requirement pins: 30 minutes, snake 20×10 with 5/5/3, gomoku 15×15. */
export const DEFAULT_STATE: LeisureState = {
  open: false,
  view: 'home',
  limitEnabled: true,
  limitMinutes: 30,
  playedMs: 0,
  sessionStartedAt: null,
  limitReachedAt: null,
  settings: {
    snake: {
      rows: 20, cols: 10, speedMs: 160, foodCount: 5, obstacleCount: 5, initialLength: 3,
      bgm: null, bgImage: null,
    },
    gomoku: {
      rows: 15, cols: 15, aiStrength: 'medium',
      bgm: null, bgImage: null,
    },
    tetris: {
      cols: 20, rows: 10, speedMs: 800, lockDelayMs: 500, pieceSet: 'classic',
      showGrid: true, showGhost: true, bgm: null, bgImage: null,
    },
    minesweeper: {
      rows: 20, cols: 30, mines: 17, bgm: null, bgImage: null,
    },
    appearance: {
      accent: DEFAULT_ACCENT,
      entryText: DEFAULT_ENTRY_TEXT,
    },
  },
  progress: { snake: null, gomoku: null, tetris: null, minesweeper: null },
}

/**
 * Recursively merge the default state over a persisted value: every key the
 * defaults define survives with its persisted value when one exists, and
 * missing keys (e.g. settings added in a newer version — minesweeper,
 * appearance) fall back to the defaults. Arrays/primitives pass through the
 * persisted value verbatim.
 */
export function mergePersistedDefaults(defaults: unknown, persisted: unknown): unknown {
  if (Array.isArray(defaults) || typeof defaults !== 'object' || defaults === null) {
    return persisted === undefined || persisted === null ? defaults : persisted
  }
  const source = typeof persisted === 'object' && persisted !== null && !Array.isArray(persisted)
    ? persisted as Record<string, unknown>
    : {}
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) }
  for (const key of Object.keys(defaults as Record<string, unknown>)) {
    // The merged keys always come from the defaults, but reject prototype
    // keys anyway so a crafted payload can never reassign object internals.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    out[key] = mergePersistedDefaults((defaults as Record<string, unknown>)[key], source[key])
  }
  return out
}

/**
 * Upgrade an older persisted state to the current shape before any store is
 * created (runs once at module load; the engine then rehydrates the merged
 * state). Without this, a state saved before a settings key existed (e.g.
 * `settings.minesweeper`) crashes the matching game on open. The merged state
 * is additionally passed through the security sanitizer so tampered or
 * corrupted payloads (CSS-injection strings, huge board sizes, foreign media
 * URLs) are replaced with bounded safe values instead of being trusted.
 */
export function migratePersistedState(): void {
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(HUB_PERSIST_KEY)
    if (raw === null) return
    // A pathologically large payload is dropped wholesale rather than parsed.
    if (raw.length > MAX_STATE_BYTES) {
      localStorage.setItem(HUB_PERSIST_KEY, JSON.stringify(DEFAULT_STATE))
      return
    }
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return
    const merged = mergePersistedDefaults(DEFAULT_STATE, parsed)
    const safe = sanitizeLeisureState(merged, DEFAULT_STATE)
    localStorage.setItem(HUB_PERSIST_KEY, JSON.stringify(safe))
  } catch {
    // Storage failures (quota/private mode) never break the plugin.
  }
}

migratePersistedState()

/** Clamp helpers shared by the settings form. */
export function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

/**
 * The shared hub store handle. Persisted under one localStorage key; both
 * slot entries mount with this handle, so the framework resolves the same
 * live instance for the sidebar button and the overlay panel.
 */
export const leisureHub = defineStore({
  init: (): LeisureState => JSON.parse(JSON.stringify(DEFAULT_STATE)) as LeisureState,
  persist: HUB_PERSIST_KEY,
  actions: {
    /** Open the panel on the hub home. */
    open: (d) => { d.open = true; d.view = 'home' },
    /** Close the panel entirely (exit game); any active session timing stops via endSession below. */
    close: (d) => { d.open = false; d.view = 'home' },
    /** Switch the panel view; moving away from a game view stops its session timing. */
    setView: (d, view: HubView) => { d.view = view },
    /** Leave a game back to the hub home and stop timing. */
    backHome: (d) => { d.view = 'home' },
    /**
     * One atomic exit transition: stop the session clock and return home in a
     * single store update (two sequential updates re-render subscribers
     * between them, which races the game unmount — see the exit crash notes).
     */
    exitToHome: (d) => {
      if (d.sessionStartedAt !== null) {
        d.playedMs += Date.now() - d.sessionStartedAt
        d.sessionStartedAt = null
      }
      d.view = 'home'
    },
    /** Record that a game session became active (running) or stopped (paused/exited/over). */
    setSessionActive: (d, active: boolean) => {
      if (active) {
        if (d.sessionStartedAt === null) d.sessionStartedAt = Date.now()
      } else if (d.sessionStartedAt !== null) {
        d.playedMs += Date.now() - d.sessionStartedAt
        d.sessionStartedAt = null
      }
    },
    /**
     * One timer tick (driven by a 1s interval in the panel). Accounts elapsed
     * playtime, enforces the limit, and applies the 60-minute cooldown reset.
     */
    tick: (d, now: number) => {
      if (d.limitReachedAt !== null) {
        if (now - d.limitReachedAt >= LIMIT_RESET_COOLDOWN_MS) {
          d.playedMs = 0
          d.limitReachedAt = null
        }
      }
      if (d.sessionStartedAt !== null) {
        const delta = Math.max(0, now - d.sessionStartedAt)
        d.playedMs += delta
        d.sessionStartedAt = now
        if (d.limitEnabled && d.playedMs >= d.limitMinutes * 60_000) {
          d.playedMs = d.limitMinutes * 60_000
          d.limitReachedAt = now
          d.sessionStartedAt = null
          // Force the player back to the hub with the rest message.
          d.view = 'home'
        }
      }
    },
    setLimitEnabled: (d, enabled: boolean) => { d.limitEnabled = enabled },
    setLimitMinutes: (d, minutes: number) => { d.limitMinutes = clampInt(minutes, 1, 600) },
    setSnakeSettings: (d, patch: Partial<SnakeSettings>) => {
      const next: SnakeSettings = { ...d.settings.snake, ...patch }
      if (patch.bgm !== undefined) next.bgm = sanitizeDataUrl(patch.bgm, 'audio')
      if (patch.bgImage !== undefined) next.bgImage = sanitizeDataUrl(patch.bgImage, 'image')
      d.settings.snake = next
    },
    setGomokuSettings: (d, patch: Partial<GomokuSettings>) => {
      const next: GomokuSettings = { ...d.settings.gomoku, ...patch }
      if (patch.bgm !== undefined) next.bgm = sanitizeDataUrl(patch.bgm, 'audio')
      if (patch.bgImage !== undefined) next.bgImage = sanitizeDataUrl(patch.bgImage, 'image')
      d.settings.gomoku = next
    },
    setTetrisSettings: (d, patch: Partial<TetrisSettings>) => {
      const next: TetrisSettings = { ...d.settings.tetris, ...patch }
      if (patch.bgm !== undefined) next.bgm = sanitizeDataUrl(patch.bgm, 'audio')
      if (patch.bgImage !== undefined) next.bgImage = sanitizeDataUrl(patch.bgImage, 'image')
      d.settings.tetris = next
    },
    setMinesweeperSettings: (d, patch: Partial<MinesweeperSettings>) => {
      const next: MinesweeperSettings = { ...d.settings.minesweeper, ...patch }
      if (patch.bgm !== undefined) next.bgm = sanitizeDataUrl(patch.bgm, 'audio')
      if (patch.bgImage !== undefined) next.bgImage = sanitizeDataUrl(patch.bgImage, 'image')
      d.settings.minesweeper = next
    },
    /** Set the menu accent color (validated hex); invalid values are ignored. */
    setAccent: (d, accent: string) => {
      const safe = sanitizeHexColor(accent)
      if (safe !== null) d.settings.appearance.accent = safe
    },
    /** Set the game-entry text color of the start menu (validated hex); invalid values are ignored. */
    setEntryText: (d, color: string) => {
      const safe = sanitizeHexColor(color)
      if (safe !== null) d.settings.appearance.entryText = safe
    },
    saveSnakeProgress: (d, snapshot: SnakeSnapshot | null) => { d.progress.snake = snapshot },
    saveGomokuProgress: (d, snapshot: GomokuSnapshot | null) => { d.progress.gomoku = snapshot },
    saveTetrisProgress: (d, snapshot: TetrisSnapshot | null) => { d.progress.tetris = snapshot },
    saveMinesweeperProgress: (d, snapshot: MinesweeperSnapshot | null) => { d.progress.minesweeper = snapshot },
  },
})

/** Baked action set type, for components receiving `actions`. */
export type LeisureActions = ReturnType<typeof leisureHub.create>['actions']
