/**
 * 贪吃蛇 engine: pure, deterministic step logic (injectable RNG) shared by
 * the React surface and unit tests. The board is rows×cols; the snake starts
 * in the middle with its initial length, moving UP continuously. Arrows/WASD
 * turn the head; a turn may never reverse the snake. Crossing any edge wraps
 * the head to the opposite side of the same column/row. Eating food grows the
 * snake by one (a fresh food respawns); hitting an obstacle or the snake's own
 * body ends the game.
 */

export interface Cell { r: number; c: number }

export type Direction = 'up' | 'down' | 'left' | 'right'

export type SnakeStatus = 'running' | 'paused' | 'over'

export type SnakeOverReason = 'obstacle' | 'self' | 'full' | null

/** Serialized game state — what gets persisted as progress. */
export interface SnakeSnapshot {
  rows: number
  cols: number
  /** Body cells, head first. */
  body: Cell[]
  /** Current travel direction. */
  direction: Direction
  /** Queued direction change, applied on the next step (never a reversal). */
  pendingTurn: Direction | null
  foods: Cell[]
  obstacles: Cell[]
  score: number
  steps: number
  status: SnakeStatus
  overReason: SnakeOverReason
}

export interface SnakeSettingsLike {
  rows: number
  cols: number
  foodCount: number
  obstacleCount: number
  initialLength: number
}

export type Rng = () => number

const defaultRng: Rng = () => Math.random()

export const DIR_VECTORS: Record<Direction, Cell> = {
  up: { r: -1, c: 0 },
  down: { r: 1, c: 0 },
  left: { r: 0, c: -1 },
  right: { r: 0, c: 1 },
}

/** Whether `dir` is the exact opposite of `other`. */
export function isReverse(dir: Direction, other: Direction): boolean {
  return DIR_VECTORS[dir].r + DIR_VECTORS[other].r === 0
    && DIR_VECTORS[dir].c + DIR_VECTORS[other].c === 0
}

export function cellKey(cell: Cell): string {
  return `${cell.r}:${cell.c}`
}

/** Wrap a coordinate to the opposite edge of the same column/row. */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size
}

/** All cells not occupied by body/foods/obstacles. */
export function freeCells(snap: { rows: number; cols: number; body: Cell[]; foods: Cell[]; obstacles: Cell[] }): Cell[] {
  const taken = new Set<string>()
  for (const cell of [...snap.body, ...snap.foods, ...snap.obstacles]) taken.add(cellKey(cell))
  const out: Cell[] = []
  for (let r = 0; r < snap.rows; r++) {
    for (let c = 0; c < snap.cols; c++) {
      if (!taken.has(cellKey({ r, c }))) out.push({ r, c })
    }
  }
  return out
}

/** Draw `count` distinct random cells from the free pool. */
function drawCells(
  snap: { rows: number; cols: number; body: Cell[]; foods: Cell[]; obstacles: Cell[] },
  count: number,
  rng: Rng,
): Cell[] {
  const pool = freeCells(snap)
  const out: Cell[] = []
  for (let i = 0; i < count && pool.length > 0; i++) {
    const at = Math.floor(rng() * pool.length)
    out.push(pool[at] ?? pool[0]!)
    pool.splice(at, 1)
  }
  return out
}

/**
 * Fresh game: a centered snake of `initialLength` cells moving up, with
 * `foodCount` foods and `obstacleCount` obstacles scattered randomly.
 */
export function initSnake(settings: SnakeSettingsLike, rng: Rng = defaultRng): SnakeSnapshot {
  const rows = settings.rows
  const cols = settings.cols
  const length = Math.max(2, Math.min(settings.initialLength, rows * cols - settings.foodCount - settings.obstacleCount))
  const centerC = Math.floor(cols / 2)
  const startR = Math.floor(rows / 2)
  const body: Cell[] = []
  for (let i = 0; i < length; i++) {
    const r = startR + i // head at startR, tail below — moving UP means the tail trails below
    body.push({ r: wrap(r, rows), c: centerC })
  }
  const base = { rows, cols, body, foods: [] as Cell[], obstacles: [] as Cell[] }
  const obstacles = drawCells(base, Math.max(0, settings.obstacleCount), rng)
  const foods = drawCells({ ...base, obstacles }, Math.max(0, settings.foodCount), rng)
  return {
    rows, cols,
    body,
    direction: 'up',
    pendingTurn: null,
    foods,
    obstacles,
    score: 0,
    steps: 0,
    status: 'running',
    overReason: null,
  }
}

/** Queue a turn; the opposite of the current travel direction is ignored. */
export function queueTurn(snap: SnakeSnapshot, dir: Direction): SnakeSnapshot {
  const reference = snap.pendingTurn ?? snap.direction
  if (dir === reference || isReverse(dir, reference)) return snap
  return { ...snap, pendingTurn: dir }
}

/** Pause or resume. */
export function setPaused(snap: SnakeSnapshot, paused: boolean): SnakeSnapshot {
  if (paused && snap.status === 'running') return { ...snap, status: 'paused' }
  if (!paused && snap.status === 'paused') return { ...snap, status: 'running' }
  return snap
}

/**
 * One time step: apply the queued turn, advance the head (wrapping through
 * edges), then eat / grow / die. Returns the updated snapshot.
 */
export function stepSnake(snap: SnakeSnapshot, rng: Rng = defaultRng): SnakeSnapshot {
  if (snap.status !== 'running') return snap
  const direction = snap.pendingTurn ?? snap.direction
  const head = snap.body[0]
  if (head === undefined) return snap
  const vector = DIR_VECTORS[direction]
  const nextHead = { r: wrap(head.r + vector.r, snap.rows), c: wrap(head.c + vector.c, snap.cols) }
  const eating = snap.foods.some(food => food.r === nextHead.r && food.c === nextHead.c)
  // The tail vacates its cell on a non-eating step, so that cell is safe.
  const bodyToCheck = eating ? snap.body : snap.body.slice(0, -1)
  if (snap.obstacles.some(o => o.r === nextHead.r && o.c === nextHead.c)) {
    return { ...snap, status: 'over', overReason: 'obstacle', pendingTurn: null }
  }
  if (bodyToCheck.some(part => part.r === nextHead.r && part.c === nextHead.c)) {
    return { ...snap, status: 'over', overReason: 'self', pendingTurn: null }
  }
  let body = [nextHead, ...snap.body]
  let foods = snap.foods
  let score = snap.score
  if (eating) {
    foods = snap.foods.filter(food => !(food.r === nextHead.r && food.c === nextHead.c))
    score += 10
    const free = freeCells({ rows: snap.rows, cols: snap.cols, body, foods, obstacles: snap.obstacles })
    if (free.length > 0) {
      const at = Math.floor(rng() * free.length)
      foods = [...foods, free[at] ?? free[0]!]
    }
  } else {
    body = body.slice(0, -1)
  }
  if (freeCells({ rows: snap.rows, cols: snap.cols, body, foods, obstacles: snap.obstacles }).length === 0
    && !eating) {
    // Every remaining cell is snake body — a full clear (practically unreachable with 5 foods).
    return { ...snap, body, foods, score, steps: snap.steps + 1, status: 'over', overReason: 'full', pendingTurn: null }
  }
  return {
    ...snap,
    body,
    foods,
    score,
    steps: snap.steps + 1,
    direction,
    pendingTurn: null,
  }
}
