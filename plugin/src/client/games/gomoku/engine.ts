/**
 * 技能五子棋 engine: pure, deterministic game logic (injectable RNG) shared
 * by the React surface and the unit tests. Board is rows×cols of 0/1/2
 * (1 = black, 2 = white); turns are role-based (user/ai) so the 倒反天罡
 * color swap stays unambiguous: it swaps which color each role owns while
 * the stones on the board never change.
 */

/** 0 = empty, 1 = black, 2 = white. */
export type Stone = 0 | 1 | 2

/** The two sides. */
export type Role = 'user' | 'ai'

/** The six skills. */
export type SkillId = 'dianxue' | 'daofan' | 'gaitou' | 'leiting' | 'heyiwei' | 'touxi'

/** AI difficulty. */
export type AIStrength = 'weak' | 'medium' | 'strong'

/** One board cell. */
export interface Cell { r: number; c: number }

/**
 * 雷霆大脚 target: one full board line (row, column, main diagonal ↘, or
 * anti diagonal ↙). `index` is the row/column number, or the diagonal number
 * (r - c for ↘, r + c for ↙).
 */
export interface LineTarget { kind: 'row' | 'col' | 'diag' | 'anti'; index: number }

/** Union of skill targets (cell for 改头换面/偷袭, line for 雷霆大脚). */
export type SkillTarget = Cell | LineTarget

export type GomokuStatus = 'setup' | 'playing' | 'over'

/** The full serializable game state — what gets persisted as progress. */
export interface GomokuSnapshot {
  rows: number
  cols: number
  board: Stone[][]
  /** The color currently owned by the user (1 or 2); the ai owns the other. */
  userColor: Stone
  /** Who moves next. */
  turn: Role
  status: GomokuStatus
  winner: Role | 'draw' | null
  /** The five winning cells (for highlighting), when the game is over by five. */
  winLine: Cell[] | null
  skillUsesLeft: { user: number; ai: number }
  /**
   * Role that used a skill on its immediately-previous turn; the OTHER role
   * is then locked out of skills for exactly one turn (cleared when that
   * locked turn completes).
   */
  skillLock: Role | null
  /** The side to move already used its one skill this turn (blocks a second skill during a 点穴 extra move). */
  usedSkillThisTurn: boolean
  /** 点穴: the side to move gets one extra placement after this one. */
  extraMove: boolean
  /** 何意味: the next turn is auto-played at a random empty cell (no skills, no choice). */
  autoRandom: boolean
  lastMove: Cell | null
  aiStrength: AIStrength
  moveCount: number
}

export interface GomokuSettingsLike {
  rows: number
  cols: number
  aiStrength: AIStrength
}

/** Skills each side may use per game (the requirement pins 2). */
export const SKILL_LIMIT = 2

/**
 * The AI's guiding prompt. The engine is a heuristic player (no model call),
 * so this persona is baked into its decision rules — it always blocks
 * immediate losses, converts threats, and spends its skills aggressively to
 * win rather than survive.
 */
export const AI_PERSONA = '你是一位高超的棋手，你不想被对手打败，你要竭尽所能打败对手，利用好技能，利用好规则。'

/** Random source: Math.random by default; tests inject a deterministic one. */
export type Rng = () => number

const defaultRng: Rng = () => Math.random()

/** The other side's color. */
export function otherColor(color: Stone): Stone {
  return color === 1 ? 2 : 1
}

/** The other role. */
export function otherRole(role: Role): Role {
  return role === 'user' ? 'ai' : 'user'
}

/** Color currently owned by a role. */
export function roleColor(snap: GomokuSnapshot, role: Role): Stone {
  return role === 'user' ? snap.userColor : otherColor(snap.userColor)
}

/** Role currently owning a color. */
export function roleOfColor(snap: GomokuSnapshot, color: Stone): Role {
  return color === snap.userColor ? 'user' : 'ai'
}

export function inBounds(snap: { rows: number; cols: number }, r: number, c: number): boolean {
  return r >= 0 && r < snap.rows && c >= 0 && c < snap.cols
}

export function emptyBoard(rows: number, cols: number): Stone[][] {
  return Array.from({ length: rows }, () => Array<Stone>(cols).fill(0))
}

/** Fresh pre-game state; the user still has to pick a color. */
export function freshGomoku(settings: GomokuSettingsLike): GomokuSnapshot {
  return {
    rows: settings.rows,
    cols: settings.cols,
    board: emptyBoard(settings.rows, settings.cols),
    userColor: 1,
    turn: 'user',
    status: 'setup',
    winner: null,
    winLine: null,
    skillUsesLeft: { user: SKILL_LIMIT, ai: SKILL_LIMIT },
    skillLock: null,
    usedSkillThisTurn: false,
    extraMove: false,
    autoRandom: false,
    lastMove: null,
    aiStrength: settings.aiStrength,
    moveCount: 0,
  }
}

/**
 * The user picks a color; black moves first. If the user picks white, the AI
 * (black) opens the game.
 */
export function chooseColor(snap: GomokuSnapshot, userColor: Stone): GomokuSnapshot {
  if (snap.status !== 'setup' || userColor !== 1 && userColor !== 2) return snap
  const next: GomokuSnapshot = { ...snap, userColor, status: 'playing' }
  // Black opens.
  next.turn = roleOfColor(next, 1)
  return next
}

/** Whether the role to move may use a skill right now. */
export function canUseSkill(snap: GomokuSnapshot): boolean {
  if (snap.status !== 'playing' || snap.autoRandom) return false
  if (snap.usedSkillThisTurn) return false
  if (snap.skillLock === snap.turn) return false
  return snap.skillUsesLeft[snap.turn] > 0
}

/**
 * Check whether the stone at (r,c) completes a run of five or more for
 * `color`; returns the five cells of the first such run, else null.
 */
export function checkWinAt(board: Stone[][], r: number, c: number, color: Stone): Cell[] | null {
  if (board[r]?.[c] !== color) return null
  const rows = board.length
  const cols = board[0]?.length ?? 0
  const dirs: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (const [dr, dc] of dirs) {
    const cells: Cell[] = [{ r, c }]
    for (const sign of [1, -1]) {
      let rr = r + dr * sign
      let cc = c + dc * sign
      while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr]?.[cc] === color) {
        cells.push({ r: rr, c: cc })
        rr += dr * sign
        cc += dc * sign
      }
    }
    if (cells.length >= 5) return cells
  }
  return null
}

/** All empty cells (for 何意味 random placement and draw checks). */
export function emptyCells(board: Stone[][]): Cell[] {
  const out: Cell[] = []
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < (board[r]?.length ?? 0); c++) {
      if (board[r]?.[c] === 0) out.push({ r, c })
    }
  }
  return out
}

/** Set the terminal state after a win for `color`. */
function finish(snap: GomokuSnapshot, winLine: Cell[] | null, winner: Role | 'draw' | null): GomokuSnapshot {
  return {
    ...snap,
    status: 'over',
    winner,
    winLine,
    extraMove: false,
    autoRandom: false,
    skillLock: null,
    usedSkillThisTurn: false,
  }
}

/** Cells of one full line (used by 雷霆大脚). */
export function lineCells(snap: { rows: number; cols: number }, target: LineTarget): Cell[] {
  const out: Cell[] = []
  if (target.kind === 'row') {
    for (let c = 0; c < snap.cols; c++) out.push({ r: target.index, c })
  } else if (target.kind === 'col') {
    for (let r = 0; r < snap.rows; r++) out.push({ r, c: target.index })
  } else if (target.kind === 'diag') {
    // ↘: r - c === index
    for (let r = 0; r < snap.rows; r++) {
      const c = r - target.index
      if (c >= 0 && c < snap.cols) out.push({ r, c })
    }
  } else {
    // ↙: r + c === index
    for (let r = 0; r < snap.rows; r++) {
      const c = target.index - r
      if (c >= 0 && c < snap.cols) out.push({ r, c })
    }
  }
  return out
}

/** Every line on the board (rows, columns, both diagonal families) that holds at least one stone. */
export function candidateLines(snap: GomokuSnapshot): LineTarget[] {
  const out: LineTarget[] = []
  const has = (cells: Cell[]): boolean => cells.some(cell => snap.board[cell.r]?.[cell.c] !== 0)
  for (let r = 0; r < snap.rows; r++) {
    const cells = lineCells(snap, { kind: 'row', index: r })
    if (has(cells)) out.push({ kind: 'row', index: r })
  }
  for (let c = 0; c < snap.cols; c++) {
    const cells = lineCells(snap, { kind: 'col', index: c })
    if (has(cells)) out.push({ kind: 'col', index: c })
  }
  for (let index = -(snap.cols - 1); index <= snap.rows - 1; index++) {
    const cells = lineCells(snap, { kind: 'diag', index })
    if (cells.length >= 1 && has(cells)) out.push({ kind: 'diag', index })
  }
  for (let index = 0; index <= snap.rows + snap.cols - 2; index++) {
    const cells = lineCells(snap, { kind: 'anti', index })
    if (cells.length >= 1 && has(cells)) out.push({ kind: 'anti', index })
  }
  return out
}

/** Human label for a line target ("第3行" / "第4列" / "对角线↘" / "对角线↙"). */
export function lineLabel(target: LineTarget): string {
  const n = target.index + 1
  if (target.kind === 'row') return `第${n}行`
  if (target.kind === 'col') return `第${n}列`
  if (target.kind === 'diag') return `对角线↘#${n}`
  return `对角线↙#${n}`
}

/**
 * Apply one skill effect for the side to move. Returns the updated snapshot;
 * the caller still places a stone afterwards (except 何意味, which only
 * arms the opponent's auto-random turn — the placement is still normal).
 */
export function applySkill(snap: GomokuSnapshot, skill: SkillId, target: SkillTarget | null): GomokuSnapshot {
  if (!canUseSkill(snap)) return snap
  const mover = snap.turn
  const moverColor = roleColor(snap, mover)
  const opponent = otherRole(mover)
  let next: GomokuSnapshot = {
    ...snap,
    board: snap.board.map(row => [...row]),
    winLine: null,
    skillUsesLeft: { ...snap.skillUsesLeft, [mover]: snap.skillUsesLeft[mover] - 1 },
    skillLock: opponent,
    usedSkillThisTurn: true,
  }
  if (skill === 'dianxue') {
    next.extraMove = true
  } else if (skill === 'daofan') {
    // Swap which color each role owns; board stones never change.
    next.userColor = otherColor(snap.userColor)
  } else if (skill === 'gaitou') {
    const cell = target as Cell
    if (cell !== null && inBounds(next, cell.r, cell.c) && next.board[cell.r]?.[cell.c] === roleColor(next, opponent)) {
      next.board[cell.r]![cell.c] = moverColor
      // A conversion can complete a five for the mover.
      const win = checkWinAt(next.board, cell.r, cell.c, moverColor)
      if (win !== null) return finish(next, win, mover)
    }
  } else if (skill === 'leiting') {
    const line = target as LineTarget
    if (line !== null) {
      for (const cell of lineCells(next, line)) next.board[cell.r]![cell.c] = 0
    }
  } else if (skill === 'heyiwei') {
    next.autoRandom = true
  } else if (skill === 'touxi') {
    const cell = target as Cell
    if (cell !== null && inBounds(next, cell.r, cell.c) && next.board[cell.r]?.[cell.c] === roleColor(next, opponent)) {
      next.board[cell.r]![cell.c] = 0
    }
  }
  return next
}

/**
 * Place one stone for the side to move. Handles the win check, the 点穴
 * extra move, the normal turn flip, the skill-lock consumption, and the
 * 何意味 auto-random opponent turn (which resolves immediately).
 */
export function placeMove(snap: GomokuSnapshot, cell: Cell, rng: Rng = defaultRng): GomokuSnapshot {
  if (snap.status !== 'playing') return snap
  if (!inBounds(snap, cell.r, cell.c) || snap.board[cell.r]?.[cell.c] !== 0) return snap
  const mover = snap.turn
  const color = roleColor(snap, mover)
  const board = snap.board.map(row => [...row])
  board[cell.r]![cell.c] = color
  let next: GomokuSnapshot = {
    ...snap,
    board,
    lastMove: cell,
    moveCount: snap.moveCount + 1,
  }
  const win = checkWinAt(board, cell.r, cell.c, color)
  if (win !== null) return finish(next, win, mover)
  if (next.extraMove) {
    // 点穴: the mover places once more; same side keeps the turn.
    next.extraMove = false
    return next
  }
  // Ordinary turn flip.
  const finishedSide = mover
  next.turn = otherRole(mover)
  next.usedSkillThisTurn = false
  if (next.skillLock === finishedSide) next.skillLock = null
  if (next.autoRandom) {
    next.autoRandom = false
    next = autoRandomTurn(next, rng)
  } else if (emptyCells(next.board).length === 0) {
    return finish(next, null, 'draw')
  }
  return next
}

/**
 * The 何意味 auto turn: place a stone at a random empty cell for the side
 * to move, then flip the turn back (no skill, no choice for that side).
 */
export function autoRandomTurn(snap: GomokuSnapshot, rng: Rng = defaultRng): GomokuSnapshot {
  if (snap.status !== 'playing') return snap
  const mover = snap.turn
  const color = roleColor(snap, mover)
  const empties = emptyCells(snap.board)
  if (empties.length === 0) return finish(snap, null, 'draw')
  const cell = empties[Math.floor(rng() * empties.length)] ?? { r: 0, c: 0 }
  const board = snap.board.map(row => [...row])
  board[cell.r]![cell.c] = color
  let next: GomokuSnapshot = {
    ...snap,
    board,
    lastMove: cell,
    moveCount: snap.moveCount + 1,
    autoRandom: false,
    extraMove: false,
  }
  const win = checkWinAt(board, cell.r, cell.c, color)
  if (win !== null) return finish(next, win, mover)
  const finishedSide = mover
  next.turn = otherRole(mover)
  next.usedSkillThisTurn = false
  if (next.skillLock === finishedSide) next.skillLock = null
  if (emptyCells(next.board).length === 0) return finish(next, null, 'draw')
  return next
}

// ── line / pattern scoring (shared by the AI levels) ───────────────────────

/** The four directions along which five-in-a-row counts. */
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 0], [1, 1], [1, -1]]

/** Consecutive run of `color` through (r,c) plus how many ends are open. */
function runAt(board: Stone[][], r: number, c: number, color: Stone): { run: number; open: number } {
  const rows = board.length
  const cols = board[0]?.length ?? 0
  let best = { run: 1, open: 0 }
  for (const [dr, dc] of DIRS) {
    let run = 1
    let open = 0
    for (const sign of [1, -1]) {
      let rr = r + dr * sign
      let cc = c + dc * sign
      while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr]?.[cc] === color) {
        run++
        rr += dr * sign
        cc += dc * sign
      }
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr]?.[cc] === 0) open++
    }
    if (run > best.run || (run === best.run && open > best.open)) best = { run, open }
  }
  return best
}

/** Pattern value of a run of `color` through a candidate cell. */
function runValue(run: number, open: number): number {
  if (run >= 5) return 1_000_000
  if (run === 4) return open === 2 ? 60_000 : open === 1 ? 6_000 : 0
  if (run === 3) return open === 2 ? 4_000 : open === 1 ? 800 : 60
  if (run === 2) return open === 2 ? 300 : open === 1 ? 80 : 10
  return open === 2 ? 30 : 10
}

/** Jump pattern bonus (X.XX / XX.X windows), a modest open-three surrogate. */
function jumpValue(board: Stone[][], r: number, c: number, color: Stone): number {
  const rows = board.length
  const cols = board[0]?.length ?? 0
  let value = 0
  for (const [dr, dc] of DIRS) {
    for (const sign of [1, -1]) {
      const a = { r: r + dr * sign, c: c + dc * sign }
      const b = { r: r + dr * 2 * sign, c: c + dc * 2 * sign }
      const c2 = { r: r + dr * 3 * sign, c: c + dc * 3 * sign }
      const good = (p: Cell): boolean => p.r >= 0 && p.r < rows && p.c >= 0 && p.c < cols
      // color at (a), gap at (b), color at (c2) → broken three through the gap
      if (good(a) && good(b) && good(c2)
        && board[a.r]?.[a.c] === color && board[b.r]?.[b.c] === 0 && board[c2.r]?.[c2.c] === color) {
        value += 900
      }
    }
  }
  return value
}

/** Candidate move value for `color` at an empty cell (attack-shaped score). */
export function moveValue(board: Stone[][], cell: Cell, color: Stone): number {
  const { run, open } = runAt(board, cell.r, cell.c, color)
  return runValue(run, open) + jumpValue(board, cell.r, cell.c, color)
}

/** Whole-board advantage of `color` over the opponent (windowed line sum, saturated). */
export function boardAdvantage(board: Stone[][], color: Stone): number {
  const rows = board.length
  const cols = board[0]?.length ?? 0
  const opp = otherColor(color)
  let total = 0
  const lines: Cell[][] = []
  for (let r = 0; r < rows; r++) {
    const line: Cell[] = []
    for (let c = 0; c < cols; c++) line.push({ r, c })
    lines.push(line)
  }
  for (let c = 0; c < cols; c++) {
    const line: Cell[] = []
    for (let r = 0; r < rows; r++) line.push({ r, c })
    lines.push(line)
  }
  // ↘ diagonals: constant r - c.
  for (let k = -(cols - 1); k <= rows - 1; k++) {
    const line: Cell[] = []
    for (let r = 0; r < rows; r++) {
      const c = r - k
      if (c >= 0 && c < cols) line.push({ r, c })
    }
    if (line.length >= 5) lines.push(line)
  }
  // ↗ diagonals: constant r + c.
  for (let k = 0; k <= rows + cols - 2; k++) {
    const line: Cell[] = []
    for (let r = 0; r < rows; r++) {
      const c = k - r
      if (c >= 0 && c < cols) line.push({ r, c })
    }
    if (line.length >= 5) lines.push(line)
  }
  for (const line of lines) {
    if (line.length < 5) continue
    for (let i = 0; i + 4 < line.length; i++) {
      const windowCells = line.slice(i, i + 5)
      for (const cand of [color, opp]) {
        let stones = 0
        let blocked = false
        for (const cell of windowCells) {
          const v = board[cell.r]?.[cell.c] ?? 0
          if (v === cand) stones++
          else if (v !== 0) { blocked = true; break }
        }
        if (blocked) continue
        if (stones === 5) total += cand === color ? 1_000_000 : -1_200_000
        else if (stones === 4) total += cand === color ? 50_000 : -80_000
        else if (stones === 3) total += cand === color ? 1_500 : -2_000
        else if (stones === 2) total += cand === color ? 150 : -180
        else if (stones === 1) total += cand === color ? 10 : -10
      }
    }
  }
  return total
}

/** Empty cells adjacent (Chebyshev ≤ 2) to an existing stone; fallback: board center. */
export function candidateCells(board: Stone[][]): Cell[] {
  const rows = board.length
  const cols = board[0]?.length ?? 0
  const near = new Set<number>()
  const key = (r: number, c: number): number => r * cols + c
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r]?.[c] === 0) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr]?.[cc] === 0) near.add(key(rr, cc))
        }
      }
    }
  }
  if (near.size > 0) {
    return [...near].map(k => ({ r: Math.floor(k / cols), c: k % cols }))
  }
  return [{ r: Math.floor(rows / 2), c: Math.floor(cols / 2) }]
}

/** The empty cell completing an immediate five for `color`, else null. */
export function findImmediateWin(board: Stone[][], color: Stone): Cell | null {
  for (const cell of candidateCells(board)) {
    if (moveValue(board, cell, color) >= 1_000_000) return cell
  }
  return null
}

/**
 * The line holding the opponent's immediate four-threat through `cell`
 * (stones of the threatened color plus the empty completing cell), or null.
 */
function threatLineThrough(board: Stone[][], cell: Cell, color: Stone): LineTarget | null {
  const rows = board.length
  const cols = board[0]?.length ?? 0
  const dirs: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (const [dr, dc] of dirs) {
    const stones: Cell[] = []
    for (const sign of [1, -1]) {
      let rr = cell.r + dr * sign
      let cc = cell.c + dc * sign
      while (rr >= 0 && rr < rows && cc >= 0 && cc < cols && board[rr]?.[cc] === color) {
        stones.push({ r: rr, c: cc })
        rr += dr * sign
        cc += dc * sign
      }
    }
    if (stones.length >= 4) {
      // The four (or more) stones plus `cell` are collinear — rebuild the line identity.
      const one = stones[0] ?? cell
      if (dr === 0) return { kind: 'row', index: one.r }
      if (dc === 0) return { kind: 'col', index: one.c }
      if (dr === dc) return { kind: 'diag', index: one.r - one.c }
      return { kind: 'anti', index: one.r + one.c }
    }
  }
  return null
}

// ── AI ─────────────────────────────────────────────────────────────────────

/** Pick the AI's move by difficulty. Returns the new snapshot. */
export function aiTurn(snap: GomokuSnapshot, rng: Rng = defaultRng): GomokuSnapshot {
  return aiTurnReport(snap, rng).snap
}

/** Like {@link aiTurn}, but also reports which skill the AI used (if any). */
export function aiTurnReport(snap: GomokuSnapshot, rng: Rng = defaultRng): { snap: GomokuSnapshot; skill: SkillId | null } {
  if (snap.status !== 'playing' || snap.turn !== 'ai') return { snap, skill: null }
  if (snap.autoRandom) return { snap: autoRandomTurn(snap, rng), skill: null }
  let next = snap
  const decided = decideAiSkill(next, rng)
  if (decided !== null) {
    next = applySkill(next, decided.skill, decided.target)
    if (next.status === 'over') return { snap: next, skill: decided.skill }
  }
  next = placeMove(next, chooseAiCell(next, rng), rng)
  // 点穴 grants the AI its extra placement (placeMove keeps the turn), and
  // 何意味's auto-random exchange hands the turn back to the AI.
  if (next.status === 'playing' && next.turn === 'ai') {
    next = placeMove(next, chooseAiCell(next, rng), rng)
  }
  return { snap: next, skill: decided?.skill ?? null }
}

/** Decide whether (and which) skill the AI uses on its turn. */
export function decideAiSkill(snap: GomokuSnapshot, rng: Rng = defaultRng): { skill: SkillId; target: SkillTarget | null } | null {
  if (!canUseSkill(snap)) return null
  const aiColor = roleColor(snap, 'ai')
  const userColor = roleColor(snap, 'user')
  const board = snap.board
  // Winning outright is always better than spending a skill.
  if (findImmediateWin(board, aiColor) !== null) return null
  // Defensive: the user threatens an immediate five → break it with a skill.
  const userWin = findImmediateWin(board, userColor)
  if (userWin !== null) {
    const line = threatLineThrough(board, userWin, userColor)
    if (line !== null) {
      const cells = lineCells(snap, line).filter(cell => board[cell.r]?.[cell.c] === userColor)
      if (cells.length > 0) {
        const target = cells[Math.floor(rng() * cells.length)] ?? cells[0] ?? userWin
        // Prefer removing the key stone; clearing the whole line is the
        // heavyweight option, converting it the middle ground.
        const pick: SkillId = rng() < 0.45 ? 'touxi' : rng() < 0.5 ? 'gaitou' : 'leiting'
        return { skill: pick, target: pick === 'leiting' ? line : target }
      }
    }
    return null // fall back to blocking by placement
  }
  // Opportunistic skills, gated by difficulty. The persona (a skilled player
  // who hates losing and uses every rule to win) maps to aggressive skill
  // spending: stronger opponents convert advantages into threats more often.
  const strength = snap.aiStrength
  const p = rng()
  if (p < (strength === 'strong' ? 0.25 : strength === 'medium' ? 0.1 : 0.03) && snap.moveCount <= 6) {
    return { skill: 'daofan', target: null }
  }
  const advantage = boardAdvantage(board, userColor) - boardAdvantage(board, aiColor)
  if (advantage > 30_000) {
    const chance = strength === 'strong' ? 0.7 : strength === 'medium' ? 0.4 : 0.15
    if (p < chance) return { skill: 'heyiwei', target: null }
  }
  // AI has an open three worth doubling with an extra move (点穴 → double threat).
  const aiWin = findImmediateWin(board, aiColor)
  const hasThree = candidateCells(board).some(cell => moveValue(board, cell, aiColor) >= 4_000)
  if (hasThree && aiWin === null) {
    const chance = strength === 'strong' ? 0.5 : strength === 'medium' ? 0.25 : 0.1
    if (p < chance) return { skill: 'dianxue', target: null }
  }
  return null
}

/**
 * One-ply move score for `color` at an empty cell: attack potential plus a
 * defense term (how good the cell would be for the opponent).
 */
function onePlyValue(board: Stone[][], cell: Cell, color: Stone): number {
  const attack = moveValue(board, cell, color)
  const defense = moveValue(board, cell, otherColor(color))
  if (attack >= 1_000_000) return 10_000_000
  if (defense >= 1_000_000) return 9_000_000 // immediate block
  return attack + defense * 0.9
}

/** Ranked candidate cells for `color` by one-ply value. */
function rankedCells(board: Stone[][], color: Stone, limit: number): Cell[] {
  return candidateCells(board)
    .map(cell => ({ cell, value: onePlyValue(board, cell, color) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map(ranked => ranked.cell)
}

/** Choose the AI's placement cell by difficulty. */
export function chooseAiCell(snap: GomokuSnapshot, rng: Rng = defaultRng): Cell {
  const aiColor = roleColor(snap, 'ai')
  const userColor = roleColor(snap, 'user')
  const board = snap.board
  const empties = emptyCells(board)
  if (empties.length === 0) return { r: Math.floor(snap.rows / 2), c: Math.floor(snap.cols / 2) }
  // Immediate win.
  const win = findImmediateWin(board, aiColor)
  if (win !== null) return win
  // Immediate block.
  const block = findImmediateWin(board, userColor)
  if (block !== null) return block
  if (snap.aiStrength === 'weak') {
    if (rng() < 0.35) {
      // Pure randomness with occasional awareness.
      return empties[Math.floor(rng() * empties.length)] ?? empties[0]!
    }
    const top = rankedCells(board, aiColor, 6)
    return top[Math.floor(rng() * top.length)] ?? top[0] ?? empties[0]!
  }
  if (snap.aiStrength === 'medium') {
    const top = rankedCells(board, aiColor, 3)
    // Small noise so medium is not fully deterministic.
    return top[Math.floor(rng() * top.length)] ?? top[0] ?? empties[0]!
  }
  // Strong: depth-2 — my best move minus the opponent's best reply.
  const candidates = rankedCells(board, aiColor, 10)
  let best: Cell | null = null
  let bestScore = -Infinity
  for (const cell of candidates) {
    const after = board.map(row => [...row])
    after[cell.r]![cell.c] = aiColor
    if (checkWinAt(after, cell.r, cell.c, aiColor) !== null) return cell
    // Opponent's best one-ply reply against the candidate.
    const replyCells = rankedCells(after, userColor, 4)
    let worst = Infinity
    for (const reply of replyCells) {
      const replyAfter = after.map(row => [...row])
      replyAfter[reply.r]![reply.c] = userColor
      const gain = boardAdvantage(replyAfter, userColor) - boardAdvantage(after, userColor)
      if (gain < worst) worst = gain
    }
    const myGain = boardAdvantage(after, aiColor) - boardAdvantage(board, aiColor)
    const score = myGain - worst
    if (score > bestScore) {
      bestScore = score
      best = cell
    }
  }
  return best ?? candidates[0] ?? empties[0]!
}
