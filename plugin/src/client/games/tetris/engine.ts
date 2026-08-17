/**
 * 俄罗斯方块 engine: a serializable port of the Tetris L2 web version's core
 * (7-bag, SRS-like kicks, lock delay, hold, ghost, scoring). The board is
 * landscape by default (20 wide × 10 tall). Snapshot-based so the whole game
 * survives exiting and reloading.
 */

export type PieceName = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L' | 'U' | 'P'

export type PieceSetId = 'classic' | 'extended' | 'single'

export interface PieceDef {
  name: PieceName
  color: string
  shape: number[][]
}

/** A piece occurrence: definition resolved by name + rotation. */
export interface PieceRef { name: PieceName; rotation: number }

export type Rng = () => number

const defaultRng: Rng = () => Math.random()

export const PIECE_SETS: Record<PieceSetId, readonly PieceDef[]> = {
  classic: [
    { name: 'I', color: '#1daed8', shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
    { name: 'O', color: '#f4c430', shape: [[1, 1], [1, 1]] },
    { name: 'T', color: '#a06cd5', shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'S', color: '#4ec57a', shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
    { name: 'Z', color: '#e25f5f', shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
    { name: 'J', color: '#4a7ccc', shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'L', color: '#e68e3c', shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
  ],
  extended: [
    { name: 'I', color: '#1daed8', shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
    { name: 'O', color: '#f4c430', shape: [[1, 1], [1, 1]] },
    { name: 'T', color: '#a06cd5', shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'S', color: '#4ec57a', shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
    { name: 'Z', color: '#e25f5f', shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
    { name: 'J', color: '#4a7ccc', shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'L', color: '#e68e3c', shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
    { name: 'U', color: '#7bd5c4', shape: [[1, 0, 1], [1, 1, 1]] },
    { name: 'P', color: '#d56fb0', shape: [[1, 1], [1, 1], [1, 0]] },
  ],
  single: [
    { name: 'I', color: '#1daed8', shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
  ],
}

/** SRS-like wall-kick offsets, in the L2 web order. */
export const KICKS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1],
]

/** All distinct rotations of a shape matrix. */
export function buildRotations(shape: number[][]): number[][][] {
  const rots: number[][][] = []
  let current = shape.map(row => [...row])
  for (let i = 0; i < 4; i++) {
    const key = JSON.stringify(current)
    if (!rots.some(rot => JSON.stringify(rot) === key)) rots.push(current)
    const h = current.length
    const w = current[0]?.length ?? 0
    const rotated: number[][] = []
    for (let x = 0; x < w; x++) {
      const row: number[] = []
      for (let y = h - 1; y >= 0; y--) row.push(current[y]?.[x] ?? 0)
      rotated.push(row)
    }
    current = rotated
  }
  return rots.length > 0 ? rots : [shape.map(row => [...row])]
}

/** Resolve a piece definition and its rotations. */
export function rotationsOf(name: PieceName, set: PieceSetId): number[][][] {
  const def = PIECE_SETS[set].find(piece => piece.name === name)
    ?? PIECE_SETS.classic.find(piece => piece.name === name)
  if (def === undefined) return [[[1]]]
  return buildRotations(def.shape)
}

export function colorOf(name: PieceName, set: PieceSetId): string {
  const def = PIECE_SETS[set].find(piece => piece.name === name)
    ?? PIECE_SETS.classic.find(piece => piece.name === name)
  return def?.color ?? '#888888'
}

/** The full serializable game state. Cells are hex colors (strings) or null. */
export interface TetrisSnapshot {
  cols: number
  rows: number
  baseSpeedMs: number
  lockDelayMs: number
  pieceSet: PieceSetId
  grid: (string | null)[][]
  score: number
  lines: number
  level: number
  hold: PieceRef | null
  canHold: boolean
  /** Next pieces; `queue[0]` becomes current on spawn. */
  queue: PieceRef[]
  /** The bag of pieces not yet queued. */
  bag: PieceName[]
  current: PieceRef | null
  curX: number
  curY: number
  dropTimerMs: number
  lockTimerMs: number
  onGround: boolean
  started: boolean
  paused: boolean
  gameOver: boolean
}

export interface TetrisSettingsLike {
  cols: number
  rows: number
  speedMs: number
  lockDelayMs: number
  pieceSet: PieceSetId
}

/** Occupied cells of a piece at an offset. */
export function pieceCells(name: PieceName, rotation: number, set: PieceSetId, ox: number, oy: number): Array<[number, number]> {
  const matrix = rotationsOf(name, set)[rotation] ?? [[1]]
  const out: Array<[number, number]> = []
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < (matrix[r]?.length ?? 0); c++) {
      if (matrix[r]?.[c]) out.push([ox + c, oy + r])
    }
  }
  return out
}

export function pieceWidth(name: PieceName, rotation: number, set: PieceSetId): number {
  return rotationsOf(name, set)[rotation]?.[0]?.length ?? 1
}

export function rotationCount(name: PieceName, set: PieceSetId): number {
  return rotationsOf(name, set).length
}

/** Whether the current piece fits at (x, y). */
export function isValid(snap: TetrisSnapshot, x: number, y: number): boolean {
  if (snap.current === null) return false
  for (const [cx, cy] of pieceCells(snap.current.name, snap.current.rotation, snap.pieceSet, x, y)) {
    if (cx < 0 || cx >= snap.cols || cy >= snap.rows) return false
    if (cy >= 0 && snap.grid[cy]?.[cx] !== null) return false
  }
  return true
}

/** Effective fall speed for the current level (the L2 formula). */
export function fallSpeed(snap: TetrisSnapshot): number {
  return Math.max(60, Math.floor(snap.baseSpeedMs * Math.pow(0.85, snap.level - 1)))
}

/** Fresh game; the current piece spawns from the queue. */
export function initTetris(settings: TetrisSettingsLike, rng: Rng = defaultRng): TetrisSnapshot {
  const snap: TetrisSnapshot = {
    cols: settings.cols,
    rows: settings.rows,
    baseSpeedMs: settings.speedMs,
    lockDelayMs: settings.lockDelayMs,
    pieceSet: settings.pieceSet,
    grid: Array.from({ length: settings.rows }, () => Array<string | null>(settings.cols).fill(null)),
    score: 0,
    lines: 0,
    level: 1,
    hold: null,
    canHold: true,
    queue: [],
    bag: [],
    current: null,
    curX: 0,
    curY: 0,
    dropTimerMs: 0,
    lockTimerMs: 0,
    onGround: false,
    started: false,
    paused: false,
    gameOver: false,
  }
  return startTetris(snap, rng)
}

/** (Re)start: clear the board and spawn the first piece. */
export function startTetris(snap: TetrisSnapshot, rng: Rng = defaultRng): TetrisSnapshot {
  const next: TetrisSnapshot = {
    ...snap,
    grid: Array.from({ length: snap.rows }, () => Array<string | null>(snap.cols).fill(null)),
    score: 0,
    lines: 0,
    level: 1,
    hold: null,
    canHold: true,
    queue: [],
    bag: [],
    current: null,
    dropTimerMs: 0,
    lockTimerMs: 0,
    onGround: false,
    started: true,
    paused: false,
    gameOver: false,
  }
  return spawnPiece(next, rng)
}

function shuffledBag(snap: TetrisSnapshot, rng: Rng): PieceName[] {
  const defs = [...PIECE_SETS[snap.pieceSet].map(piece => piece.name)]
  for (let i = defs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = defs[i]!
    defs[i] = defs[j]!
    defs[j] = tmp
  }
  return defs
}

/** Keep the preview queue at 5 pieces. */
function fillQueue(snap: TetrisSnapshot, rng: Rng): TetrisSnapshot {
  const queue = [...snap.queue]
  let bag = [...snap.bag]
  while (queue.length < 5) {
    if (bag.length === 0) bag = shuffledBag(snap, rng)
    queue.push({ name: bag.shift()!, rotation: 0 })
  }
  return { ...snap, queue, bag }
}

/** Spawn the next queued piece centered on the top row. */
export function spawnPiece(snap: TetrisSnapshot, rng: Rng = defaultRng): TetrisSnapshot {
  const filled = fillQueue(snap, rng)
  const next = filled.queue[0]
  if (next === undefined) return { ...filled, gameOver: true }
  let current: PieceRef = next
  let curX = Math.floor((filled.cols - pieceWidth(current.name, current.rotation, filled.pieceSet)) / 2)
  let curY = 0
  if (!isValid({ ...filled, current, curX, curY }, curX, curY)) {
    if (isValid({ ...filled, current, curX, curY: -1 }, curX, -1)) curY = -1
    else return { ...filled, current, curX, curY, gameOver: true, queue: filled.queue.slice(1) }
  }
  return {
    ...filled,
    current,
    curX,
    curY,
    queue: filled.queue.slice(1),
    dropTimerMs: 0,
    lockTimerMs: 0,
    onGround: false,
    canHold: true,
  }
}

/** Lock the current piece into the grid, clear lines, score, respawn. */
export function lockPiece(snap: TetrisSnapshot, rng: Rng = defaultRng): TetrisSnapshot {
  if (snap.current === null || snap.gameOver) return snap
  const grid = snap.grid.map(row => [...row])
  const color = colorOf(snap.current.name, snap.pieceSet)
  for (const [cx, cy] of pieceCells(snap.current.name, snap.current.rotation, snap.pieceSet, snap.curX, snap.curY)) {
    if (cy >= 0 && cy < snap.rows && cx >= 0 && cx < snap.cols) grid[cy]![cx] = color
  }
  const kept = grid.filter(row => row.some(cell => cell === null))
  const cleared = snap.rows - kept.length
  while (kept.length < snap.rows) kept.unshift(Array<string | null>(snap.cols).fill(null))
  let next: TetrisSnapshot = { ...snap, grid: kept }
  if (cleared > 0) {
    next = {
      ...next,
      lines: snap.lines + cleared,
      score: snap.score + [0, 100, 300, 500, 800][Math.min(cleared, 4)]! * snap.level,
    }
    next.level = Math.floor(next.lines / 10) + 1
  }
  return spawnPiece(next, rng)
}

/** Move by (dx, dy) when legal. */
export function movePiece(snap: TetrisSnapshot, dx: number, dy: number): TetrisSnapshot {
  if (snap.current === null || snap.paused || snap.gameOver) return snap
  const x = snap.curX + dx
  const y = snap.curY + dy
  if (!isValid(snap, x, y)) return snap
  return {
    ...snap,
    curX: x,
    curY: y,
    ...(snap.onGround && dy !== 0 ? { lockTimerMs: 0 } : {}),
  }
}

/** Rotate with wall kicks. */
export function rotatePiece(snap: TetrisSnapshot, clockwise: boolean): TetrisSnapshot {
  if (snap.current === null || snap.paused || snap.gameOver) return snap
  const count = rotationCount(snap.current.name, snap.pieceSet)
  const old = snap.current.rotation
  const rotation = (old + (clockwise ? 1 : -1) + count) % count
  for (const [kx, ky] of KICKS) {
    if (isValid(snap, snap.curX + kx, snap.curY + ky)) {
      return {
        ...snap,
        current: { ...snap.current, rotation },
        curX: snap.curX + kx,
        curY: snap.curY + ky,
        ...(snap.onGround ? { lockTimerMs: 0 } : {}),
      }
    }
  }
  return snap
}

/** Soft drop by one row (+1 score). */
export function softDrop(snap: TetrisSnapshot): TetrisSnapshot {
  if (snap.current === null || snap.paused || snap.gameOver) return snap
  const moved = movePiece(snap, 0, 1)
  if (moved.curY !== snap.curY) return { ...moved, score: moved.score + 1, dropTimerMs: 0 }
  return snap
}

/** Hard drop: fall to the ghost position, score, lock. */
export function hardDrop(snap: TetrisSnapshot, rng: Rng = defaultRng): TetrisSnapshot {
  if (snap.current === null || snap.paused || snap.gameOver) return snap
  let next = snap
  let distance = 0
  while (true) {
    const moved = movePiece(next, 0, 1)
    if (moved.curY === next.curY) break
    next = moved
    distance++
  }
  next = { ...next, score: next.score + distance * 2 }
  return lockPiece(next, rng)
}

/** The ghost drop row for the current piece. */
export function ghostY(snap: TetrisSnapshot): number {
  let y = snap.curY
  while (isValid(snap, snap.curX, y + 1)) y++
  return y
}

/** Hold the current piece (once per spawn). */
export function holdPiece(snap: TetrisSnapshot, rng: Rng = defaultRng): TetrisSnapshot {
  if (snap.current === null || !snap.canHold || snap.paused || snap.gameOver) return snap
  const current = snap.current
  if (snap.hold === null) {
    // spawnPiece resets canHold for the fresh piece; hold spent once.
    return { ...spawnPiece({ ...snap, hold: current }, rng), canHold: false }
  }
  const held = { ...snap.hold, rotation: 0 }
  let next: TetrisSnapshot = {
    ...snap,
    hold: current,
    current: held,
    curX: Math.floor((snap.cols - pieceWidth(held.name, held.rotation, snap.pieceSet)) / 2),
    curY: 0,
    dropTimerMs: 0,
    lockTimerMs: 0,
    onGround: false,
    canHold: false,
  }
  if (!isValid(next, next.curX, next.curY)) next = { ...next, gameOver: true }
  return next
}

/** Pause or resume (resume resets the drop timer baseline). */
export function setTetrisPaused(snap: TetrisSnapshot, paused: boolean): TetrisSnapshot {
  if (paused === snap.paused) return snap
  return { ...snap, paused }
}

/** Advance the drop/lock timers by dt ms. */
export function updateTetris(snap: TetrisSnapshot, dt: number, rng: Rng = defaultRng): TetrisSnapshot {
  if (snap.gameOver || snap.paused || snap.current === null) return snap
  let next = { ...snap, dropTimerMs: snap.dropTimerMs + dt }
  const speed = fallSpeed(next)
  while (next.dropTimerMs >= speed) {
    next.dropTimerMs -= speed
    const moved = movePiece(next, 0, 1)
    if (moved.curY === next.curY) {
      next = { ...moved, onGround: true }
      break
    }
    next = { ...moved, onGround: false, lockTimerMs: 0 }
  }
  if (!isValid(next, next.curX, next.curY + 1)) {
    next = { ...next, onGround: true, lockTimerMs: next.lockTimerMs + dt }
    if (next.lockTimerMs >= next.lockDelayMs) next = lockPiece(next, rng)
  } else {
    next = { ...next, onGround: false, lockTimerMs: 0 }
  }
  return next
}
