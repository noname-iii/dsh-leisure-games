/**
 * 经典扫雷 engine: pure, deterministic logic (injectable RNG) shared by the
 * React surface and unit tests. Classic rules: left click reveals (zeros
 * flood), right click flags, the first reveal is always safe (mines are
 * placed after the first click, excluding it and its neighbors), revealing a
 * mine loses (all mines shown), and revealing every non-mine cell wins.
 */

export interface Cell { r: number; c: number }

export interface MineCell {
  mine: boolean
  revealed: boolean
  flagged: boolean
}

export type MinesweeperStatus = 'playing' | 'won' | 'lost'

/** Serialized game state — what gets persisted as progress. */
export interface MinesweeperSnapshot {
  rows: number
  cols: number
  mines: number
  board: MineCell[][]
  status: MinesweeperStatus
  /** Whether the first reveal happened (and mines were placed). */
  started: boolean
  revealedCount: number
}

export interface MinesweeperSettingsLike {
  rows: number
  cols: number
  mines: number
}

export type Rng = () => number

const defaultRng: Rng = () => Math.random()

/** The eight neighbor offsets. */
export const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
]

export function inBounds(snap: { rows: number; cols: number }, r: number, c: number): boolean {
  return r >= 0 && r < snap.rows && c >= 0 && c < snap.cols
}

export function neighborsOf(snap: { rows: number; cols: number }, cell: Cell): Cell[] {
  const out: Cell[] = []
  for (const [dr, dc] of NEIGHBORS) {
    const r = cell.r + dr
    const c = cell.c + dc
    if (inBounds(snap, r, c)) out.push({ r, c })
  }
  return out
}

/** Adjacent mine count (used by the renderer). */
export function adjacentMines(snap: MinesweeperSnapshot, r: number, c: number): number {
  let count = 0
  for (const cell of neighborsOf(snap, { r, c })) {
    if (snap.board[cell.r]?.[cell.c]?.mine === true) count++
  }
  return count
}

/** Fresh board: mines are placed lazily on the first reveal (first click safe). */
export function freshMinesweeper(settings: MinesweeperSettingsLike): MinesweeperSnapshot {
  const rows = settings.rows
  const cols = settings.cols
  const mines = Math.min(settings.mines, rows * cols - 9)
  return {
    rows, cols, mines,
    board: Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ mine: false, revealed: false, flagged: false }))),
    status: 'playing',
    started: false,
    revealedCount: 0,
  }
}

/**
 * Place the mines, excluding the first-clicked cell and its neighbors so the
 * opening reveal is safe (classic behavior).
 */
function placeMines(snap: MinesweeperSnapshot, safe: Cell, rng: Rng): MineCell[][] {
  const excluded = new Set<string>([`${safe.r}:${safe.c}`])
  for (const cell of neighborsOf(snap, safe)) excluded.add(`${cell.r}:${cell.c}`)
  const candidates: Cell[] = []
  for (let r = 0; r < snap.rows; r++) {
    for (let c = 0; c < snap.cols; c++) {
      if (!excluded.has(`${r}:${c}`)) candidates.push({ r, c })
    }
  }
  const board = snap.board.map(row => row.map(cell => ({ ...cell })))
  const count = Math.min(snap.mines, candidates.length)
  for (let i = 0; i < count; i++) {
    const at = Math.floor(rng() * candidates.length)
    const cell = candidates[at]
    if (cell !== undefined) board[cell.r]![cell.c] = { mine: true, revealed: false, flagged: false }
    candidates.splice(at, 1)
  }
  return board
}

/** Flood reveal from a zero cell (BFS over zero and numbered cells). */
function floodReveal(board: MineCell[][], start: Cell, snap: { rows: number; cols: number }): number {
  let revealed = 0
  const queue: Cell[] = [start]
  const seen = new Set<string>([`${start.r}:${start.c}`])
  while (queue.length > 0) {
    const cell = queue.shift()!
    const target = board[cell.r]?.[cell.c]
    if (target === undefined || target.revealed || target.flagged || target.mine) continue
    target.revealed = true
    revealed++
    let adjacent = 0
    for (const n of neighborsOf(snap, cell)) {
      if (board[n.r]?.[n.c]?.mine === true) adjacent++
    }
    if (adjacent === 0) {
      for (const n of neighborsOf(snap, cell)) {
        const key = `${n.r}:${n.c}`
        if (!seen.has(key) && board[n.r]?.[n.c]?.revealed !== true) {
          seen.add(key)
          queue.push(n)
        }
      }
    }
  }
  return revealed
}

/** Reveal a cell (left click). Returns the new snapshot. */
export function revealCell(snap: MinesweeperSnapshot, cell: Cell, rng: Rng = defaultRng): MinesweeperSnapshot {
  if (snap.status !== 'playing') return snap
  if (!inBounds(snap, cell.r, cell.c)) return snap
  const target = snap.board[cell.r]?.[cell.c]
  if (target === undefined || target.revealed || target.flagged) return snap
  if (!snap.started) {
    const board = placeMines(snap, cell, rng)
    let next: MinesweeperSnapshot = { ...snap, board, started: true }
    return revealCell(next, cell, rng)
  }
  if (target.mine) {
    // Lost: reveal every mine (flags stay as they were).
    const board = snap.board.map(row => row.map(c => ({ ...c })))
    board[cell.r]![cell.c] = { ...target, revealed: true }
    for (let r = 0; r < snap.rows; r++) {
      for (let c = 0; c < snap.cols; c++) {
        if (board[r]![c]!.mine) board[r]![c] = { ...board[r]![c]!, revealed: true }
      }
    }
    return { ...snap, board, status: 'lost' }
  }
  const board = snap.board.map(row => row.map(c => ({ ...c })))
  const revealed = floodReveal(board, cell, snap)
  const revealedCount = snap.revealedCount + revealed
  const won = revealedCount >= snap.rows * snap.cols - snap.mines
  return { ...snap, board, revealedCount, ...(won ? { status: 'won' } : {}) }
}

/** Toggle a flag on an unrevealed cell (right click). */
export function flagCell(snap: MinesweeperSnapshot, cell: Cell): MinesweeperSnapshot {
  if (snap.status !== 'playing') return snap
  const target = snap.board[cell.r]?.[cell.c]
  if (target === undefined || target.revealed) return snap
  const board = snap.board.map(row => row.map(c => ({ ...c })))
  board[cell.r]![cell.c] = { ...target, flagged: !target.flagged }
  return { ...snap, board }
}

/**
 * Classic chord: reveal all unflagged neighbors of a revealed numbered cell
 * when its adjacent flag count matches the number. Returns the snapshot
 * (no-op when the chord is not legal or nothing changes).
 */
export function chordCell(snap: MinesweeperSnapshot, cell: Cell, rng: Rng = defaultRng): MinesweeperSnapshot {
  if (snap.status !== 'playing') return snap
  const target = snap.board[cell.r]?.[cell.c]
  if (target === undefined || !target.revealed || target.mine) return snap
  let flags = 0
  for (const n of neighborsOf(snap, cell)) {
    if (snap.board[n.r]?.[n.c]?.flagged === true) flags++
  }
  if (flags !== adjacentMines(snap, cell.r, cell.c)) return snap
  let next = snap
  for (const n of neighborsOf(snap, cell)) {
    const neighbor = snap.board[n.r]?.[n.c]
    if (neighbor !== undefined && !neighbor.revealed && !neighbor.flagged) {
      next = revealCell(next, n, rng)
      if (next.status !== 'playing') break
    }
  }
  return next
}

/** Serialization sanity: the snapshot is plain JSON. */
export function isMinesweeperSnapshot(value: unknown): value is MinesweeperSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snap = value as Record<string, unknown>
  return Array.isArray(snap.board) && typeof snap.rows === 'number' && typeof snap.cols === 'number'
}
