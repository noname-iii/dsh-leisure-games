/**
 * Security hardening for the leisure-games client plugin.
 *
 * The plugin persists user-uploaded media (background images / music) and
 * settings as JSON in localStorage. localStorage is shared with every other
 * plugin on the same origin, so its contents must be treated as untrusted
 * input: a crafted payload must never be able to
 *   - inject CSS through the `url(...)` interpolation used for backgrounds,
 *   - load unexpected URL schemes (network resources, `javascript:`, …),
 *   - or force unbounded allocations (huge boards / arrays) that freeze the
 *     page.
 *
 * Everything below is validation-only: invalid values are replaced with safe
 * defaults, never thrown back at the caller.
 */
import type { LeisureState } from './hub-store.ts'
import type { SnakeSnapshot } from './games/snake/engine.ts'
import type { GomokuSnapshot } from './games/gomoku/engine.ts'
import type { TetrisSnapshot, PieceRef, PieceName } from './games/tetris/engine.ts'
import type { MinesweeperSnapshot } from './games/minesweeper/engine.ts'

/** Hard cap on the raw persisted JSON (bytes) before we refuse to parse it. */
export const MAX_STATE_BYTES = 96 * 1024 * 1024

/** Decoded size cap for a single uploaded background image / music file. */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024

/** Strict `#rrggbb` (also accepts `#RRGGBB`). */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/** Allowed raster/vector image MIME types for data-URL backgrounds. */
const IMAGE_TYPES = 'png|jpe?g|gif|webp|avif|bmp|svg\\+xml|tiff|x-icon|heic|heif'
/** Allowed audio MIME types for data-URL background music. */
const AUDIO_TYPES = 'mp3|mpeg|ogg|oga|wav|x-wav|webm|flac|aac|mp4|m4a|x-m4a|3gp'

/**
 * Validate a data URL as self-contained base64 media of the requested kind.
 * The character class `[A-Za-z0-9+/=]` guarantees the value cannot contain
 * quotes, brackets, or parentheses, so it is always safe to interpolate into
 * a CSS `url(...)` token or hand to an <img>/<audio> src.
 */
export function sanitizeDataUrl(value: unknown, kind: 'image' | 'audio'): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.length > MAX_MEDIA_BYTES * 2 + 64) return null
  const pattern = new RegExp(
    kind === 'image'
      ? `^data:image\\/(?:${IMAGE_TYPES});base64,([A-Za-z0-9+/]+={0,2})$`
      : `^data:audio\\/(?:${AUDIO_TYPES});base64,([A-Za-z0-9+/]+={0,2})$`,
  )
  const match = pattern.exec(value)
  if (match === null) return null
  // Base64 decodes to ~3/4 of its encoded length.
  if (match[1]!.length * 0.75 > MAX_MEDIA_BYTES) return null
  return value
}

/** Validate a hex color; null when invalid. */
export function sanitizeHexColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : null
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.max(min, Math.min(max, n))
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function epochOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function oneOf<T>(value: unknown, set: readonly T[], fallback: T): T {
  return (set as readonly unknown[]).includes(value) ? value as T : fallback
}

/** Coerce an unknown value into a board cell clamped inside the board. */
function clampedCell(value: unknown, rows: number, cols: number): { r: number; c: number } {
  const obj = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return { r: num(obj.r, 0, rows - 1, 0), c: num(obj.c, 0, cols - 1, 0) }
}

function sanitizeSnakeProgress(value: unknown): SnakeSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  const rows = num(o.rows, 8, 60, 20)
  const cols = num(o.cols, 8, 60, 10)
  const cells = Array.isArray(o.body) ? o.body.slice(0, rows * cols).map(c => clampedCell(c, rows, cols)) : []
  const dirs = ['up', 'down', 'left', 'right'] as const
  const statuses = ['running', 'paused', 'over'] as const
  const reasons = ['obstacle', 'self', 'full', null] as const
  return {
    rows,
    cols,
    body: cells,
    direction: oneOf(o.direction, dirs, 'up'),
    pendingTurn: oneOf(o.pendingTurn, [...dirs, null] as const, null),
    foods: Array.isArray(o.foods) ? o.foods.slice(0, rows * cols).map(c => clampedCell(c, rows, cols)) : [],
    obstacles: Array.isArray(o.obstacles) ? o.obstacles.slice(0, rows * cols).map(c => clampedCell(c, rows, cols)) : [],
    score: num(o.score, 0, 1_000_000_000, 0),
    steps: num(o.steps, 0, 1_000_000_000, 0),
    status: oneOf(o.status, statuses, 'over'),
    overReason: oneOf(o.overReason, reasons, null),
  }
}

function sanitizeGomokuProgress(value: unknown): GomokuSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  const rows = num(o.rows, 9, 25, 15)
  const cols = num(o.cols, 9, 25, 15)
  const raw = Array.isArray(o.board) ? o.board.slice(0, rows) : []
  const board: GomokuSnapshot['board'] = []
  for (let r = 0; r < rows; r++) {
    const row: GomokuSnapshot['board'][number] = []
    const source = Array.isArray(raw[r]) ? raw[r] : []
    for (let c = 0; c < cols; c++) {
      row.push(source[c] === 1 || source[c] === 2 ? source[c] : 0)
    }
    board.push(row)
  }
  const roles = ['user', 'ai'] as const
  const statuses = ['setup', 'playing', 'over'] as const
  const winners = ['user', 'ai', 'draw', null] as const
  const strengths = ['weak', 'medium', 'strong'] as const
  return {
    rows,
    cols,
    board,
    userColor: oneOf(o.userColor, [1, 2] as const, 1),
    turn: oneOf(o.turn, roles, 'user'),
    status: oneOf(o.status, statuses, 'over'),
    winner: oneOf(o.winner, winners, null),
    winLine: Array.isArray(o.winLine) ? o.winLine.slice(0, 5).map(c => clampedCell(c, rows, cols)) : null,
    skillUsesLeft: {
      user: num((o.skillUsesLeft as Record<string, unknown> | null | undefined)?.user, 0, 2, 2),
      ai: num((o.skillUsesLeft as Record<string, unknown> | null | undefined)?.ai, 0, 2, 2),
    },
    skillLock: oneOf(o.skillLock, [...roles, null] as const, null),
    usedSkillThisTurn: bool(o.usedSkillThisTurn, false),
    extraMove: bool(o.extraMove, false),
    autoRandom: bool(o.autoRandom, false),
    lastMove: o.lastMove === null || o.lastMove === undefined ? null : clampedCell(o.lastMove, rows, cols),
    aiStrength: oneOf(o.aiStrength, strengths, 'medium'),
    moveCount: num(o.moveCount, 0, 1_000_000, 0),
  }
}

const PIECE_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L', 'U', 'P'] as const

function pieceName(value: unknown): PieceName {
  return oneOf(value, PIECE_NAMES, 'I')
}

function pieceRef(value: unknown): PieceRef | null {
  if (value === null || value === undefined) return null
  const o = typeof value === 'object' ? value as Record<string, unknown> : {}
  return { name: pieceName(o.name), rotation: num(o.rotation, 0, 16, 0) }
}

function sanitizeTetrisProgress(value: unknown): TetrisSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  const rows = num(o.rows, 8, 40, 10)
  const cols = num(o.cols, 6, 30, 20)
  const raw = Array.isArray(o.grid) ? o.grid.slice(0, rows) : []
  const grid: (string | null)[][] = []
  for (let r = 0; r < rows; r++) {
    const row: (string | null)[] = []
    const source = Array.isArray(raw[r]) ? raw[r] : []
    for (let c = 0; c < cols; c++) {
      const cell = typeof source[c] === 'string' ? source[c].slice(0, 9) : ''
      row.push(/^#[0-9a-fA-F]{3,8}$/.test(cell) ? cell : null)
    }
    grid.push(row)
  }
  const pieceSets = ['classic', 'extended', 'single'] as const
  return {
    cols,
    rows,
    baseSpeedMs: num(o.baseSpeedMs, 80, 1600, 800),
    lockDelayMs: num(o.lockDelayMs, 0, 2000, 500),
    pieceSet: oneOf(o.pieceSet, pieceSets, 'classic'),
    grid,
    score: num(o.score, 0, 1_000_000_000, 0),
    lines: num(o.lines, 0, 1_000_000, 0),
    level: num(o.level, 1, 99, 1),
    hold: pieceRef(o.hold),
    canHold: bool(o.canHold, true),
    queue: Array.isArray(o.queue) ? o.queue.slice(0, 64).map(pieceRef).filter((p): p is PieceRef => p !== null) : [],
    bag: Array.isArray(o.bag) ? o.bag.slice(0, 64).map(pieceName) : [],
    current: pieceRef(o.current),
    curX: num(o.curX, 0, cols, 0),
    curY: num(o.curY, -rows, rows, 0),
    dropTimerMs: num(o.dropTimerMs, 0, 1_000_000, 0),
    lockTimerMs: num(o.lockTimerMs, 0, 1_000_000, 0),
    onGround: bool(o.onGround, false),
    started: bool(o.started, false),
    paused: bool(o.paused, false),
    gameOver: bool(o.gameOver, false),
  }
}

function sanitizeMinesweeperProgress(value: unknown): MinesweeperSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  const rows = num(o.rows, 5, 40, 20)
  const cols = num(o.cols, 5, 60, 30)
  const raw = Array.isArray(o.board) ? o.board.slice(0, rows) : []
  const board: MinesweeperSnapshot['board'] = []
  for (let r = 0; r < rows; r++) {
    const row: MinesweeperSnapshot['board'][number] = []
    const source = Array.isArray(raw[r]) ? raw[r] : []
    for (let c = 0; c < cols; c++) {
      const cell = typeof source[c] === 'object' && source[c] !== null ? source[c] as Record<string, unknown> : {}
      row.push({
        mine: bool(cell.mine, false),
        revealed: bool(cell.revealed, false),
        flagged: bool(cell.flagged, false),
      })
    }
    board.push(row)
  }
  const statuses = ['playing', 'won', 'lost'] as const
  return {
    rows,
    cols,
    mines: num(o.mines, 1, 500, 17),
    board,
    status: oneOf(o.status, statuses, 'playing'),
    started: bool(o.started, false),
    revealedCount: num(o.revealedCount, 0, rows * cols, 0),
  }
}

/**
 * Sanitize a fully-shaped (defaults-merged) state into a strictly bounded
 * value. Used on every rehydrate so a tampered or corrupted localStorage
 * payload can never produce huge allocations, CSS injection, or exotic
 * media sources. `defaults` supplies the fallbacks.
 */
export function sanitizeLeisureState(merged: unknown, defaults: LeisureState): LeisureState {
  const s = typeof merged === 'object' && merged !== null ? merged as Record<string, unknown> : {}
  const set = (s.settings as Record<string, unknown> | null | undefined) ?? {}
  const snake = (set.snake as Record<string, unknown> | null | undefined) ?? {}
  const gomoku = (set.gomoku as Record<string, unknown> | null | undefined) ?? {}
  const tetris = (set.tetris as Record<string, unknown> | null | undefined) ?? {}
  const minesweeper = (set.minesweeper as Record<string, unknown> | null | undefined) ?? {}
  const appearance = (set.appearance as Record<string, unknown> | null | undefined) ?? {}
  const progress = (s.progress as Record<string, unknown> | null | undefined) ?? {}

  const minesweeperRows = num(minesweeper.rows, 5, 40, defaults.settings.minesweeper.rows)
  const minesweeperCols = num(minesweeper.cols, 5, 60, defaults.settings.minesweeper.cols)
  const mines = Math.min(
    num(minesweeper.mines, 1, 500, defaults.settings.minesweeper.mines),
    Math.max(1, minesweeperRows * minesweeperCols - 1),
  )

  return {
    open: bool(s.open, false),
    view: oneOf(s.view, ['home', 'settings', 'tetris', 'snake', 'gomoku', 'minesweeper'] as const, 'home'),
    limitEnabled: bool(s.limitEnabled, true),
    limitMinutes: num(s.limitMinutes, 1, 600, defaults.limitMinutes),
    playedMs: num(s.playedMs, 0, 600 * 60_000, 0),
    sessionStartedAt: epochOrNull(s.sessionStartedAt),
    limitReachedAt: epochOrNull(s.limitReachedAt),
    settings: {
      snake: {
        rows: num(snake.rows, 8, 60, defaults.settings.snake.rows),
        cols: num(snake.cols, 8, 60, defaults.settings.snake.cols),
        speedMs: num(snake.speedMs, 60, 1200, defaults.settings.snake.speedMs),
        foodCount: num(snake.foodCount, 0, 20, defaults.settings.snake.foodCount),
        obstacleCount: num(snake.obstacleCount, 0, 30, defaults.settings.snake.obstacleCount),
        initialLength: num(snake.initialLength, 2, 20, defaults.settings.snake.initialLength),
        bgm: sanitizeDataUrl(snake.bgm, 'audio'),
        bgImage: sanitizeDataUrl(snake.bgImage, 'image'),
      },
      gomoku: {
        rows: num(gomoku.rows, 9, 25, defaults.settings.gomoku.rows),
        cols: num(gomoku.cols, 9, 25, defaults.settings.gomoku.cols),
        aiStrength: oneOf(gomoku.aiStrength, ['weak', 'medium', 'strong'] as const, defaults.settings.gomoku.aiStrength),
        bgm: sanitizeDataUrl(gomoku.bgm, 'audio'),
        bgImage: sanitizeDataUrl(gomoku.bgImage, 'image'),
      },
      tetris: {
        cols: num(tetris.cols, 6, 30, defaults.settings.tetris.cols),
        rows: num(tetris.rows, 8, 40, defaults.settings.tetris.rows),
        speedMs: num(tetris.speedMs, 80, 1600, defaults.settings.tetris.speedMs),
        lockDelayMs: num(tetris.lockDelayMs, 0, 2000, defaults.settings.tetris.lockDelayMs),
        pieceSet: oneOf(tetris.pieceSet, ['classic', 'extended', 'single'] as const, defaults.settings.tetris.pieceSet),
        showGrid: bool(tetris.showGrid, defaults.settings.tetris.showGrid),
        showGhost: bool(tetris.showGhost, defaults.settings.tetris.showGhost),
        bgm: sanitizeDataUrl(tetris.bgm, 'audio'),
        bgImage: sanitizeDataUrl(tetris.bgImage, 'image'),
      },
      minesweeper: {
        rows: minesweeperRows,
        cols: minesweeperCols,
        mines,
        bgm: sanitizeDataUrl(minesweeper.bgm, 'audio'),
        bgImage: sanitizeDataUrl(minesweeper.bgImage, 'image'),
      },
      appearance: {
        accent: sanitizeHexColor(appearance.accent) ?? defaults.settings.appearance.accent,
        entryText: sanitizeHexColor(appearance.entryText) ?? defaults.settings.appearance.entryText,
      },
    },
    progress: {
      snake: sanitizeSnakeProgress(progress.snake),
      gomoku: sanitizeGomokuProgress(progress.gomoku),
      tetris: sanitizeTetrisProgress(progress.tetris),
      minesweeper: sanitizeMinesweeperProgress(progress.minesweeper),
    },
  }
}
