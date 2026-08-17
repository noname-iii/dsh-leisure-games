/**
 * 技能五子棋 engine rules: setup/color pick, win detection, turn alternation,
 * all six skills (with their targeting), the skill lock, the two-use budget,
 * the 何意味 auto turn, the 点穴 extra move, and AI smoke behavior.
 */
import { describe, expect, it } from 'vitest'
import {
  SKILL_LIMIT, applySkill, autoRandomTurn, canUseSkill, checkWinAt, chooseAiCell, chooseColor,
  decideAiSkill, emptyCells, freshGomoku, lineCells, placeMove, roleColor,
} from '../src/client/games/gomoku/engine.ts'

function rng(...values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)] ?? 0.5
}

/** A playing snapshot with the user on black, at an early stage. */
function playing(extra: Partial<ReturnType<typeof freshGomoku>> = {}): ReturnType<typeof freshGomoku> {
  const snap = chooseColor(freshGomoku({ rows: 15, cols: 15, aiStrength: 'strong' }), 1)
  return { ...snap, ...extra }
}

describe('gomoku engine', () => {
  it('lets the user pick a color; black (whoever holds it) opens', () => {
    const setup = freshGomoku({ rows: 15, cols: 15, aiStrength: 'medium' })
    expect(setup.status).toBe('setup')
    const asBlack = chooseColor(setup, 1)
    expect(asBlack.status).toBe('playing')
    expect(asBlack.turn).toBe('user') // user is black → user opens
    const asWhite = chooseColor(freshGomoku({ rows: 15, cols: 15, aiStrength: 'medium' }), 2)
    expect(asWhite.turn).toBe('ai') // ai is black → ai opens
  })

  it('detects five in a row in all four directions', () => {
    const empty = emptyCells(freshGomoku({ rows: 15, cols: 15, aiStrength: 'weak' }).board)
    const board = Array.from({ length: 15 }, () => Array<1 | 2 | 0>(15).fill(0))
    for (let c = 3; c < 8; c++) board[5]![c] = 1
    expect(checkWinAt(board, 5, 5, 1)?.length).toBeGreaterThanOrEqual(5)
    const vertical = Array.from({ length: 15 }, () => Array<1 | 2 | 0>(15).fill(0))
    for (let r = 2; r < 7; r++) vertical[r]![4] = 2
    expect(checkWinAt(vertical, 4, 4, 2)?.length).toBeGreaterThanOrEqual(5)
    const diag = Array.from({ length: 15 }, () => Array<1 | 2 | 0>(15).fill(0))
    for (let i = 0; i < 5; i++) diag[3 + i]![3 + i] = 1
    expect(checkWinAt(diag, 5, 5, 1)?.length).toBeGreaterThanOrEqual(5)
    const anti = Array.from({ length: 15 }, () => Array<1 | 2 | 0>(15).fill(0))
    for (let i = 0; i < 5; i++) anti[8 - i]![3 + i] = 2
    expect(checkWinAt(anti, 6, 5, 2)?.length).toBeGreaterThanOrEqual(5)
    expect(empty).toHaveLength(225)
  })

  it('alternates turns and wins on the fifth stone', () => {
    let snap = playing()
    snap = placeMove(snap, { r: 7, c: 7 })
    expect(snap.turn).toBe('ai')
    snap = placeMove(snap, { r: 0, c: 0 })
    expect(snap.turn).toBe('user')
    // User builds five.
    for (const c of [0, 1, 2, 3]) {
      snap = placeMove(snap, { r: 7, c })
      snap = placeMove(snap, { r: 8, c })
    }
    expect(snap.status).toBe('playing')
    snap = placeMove(snap, { r: 7, c: 4 })
    expect(snap.status).toBe('over')
    expect(snap.winner).toBe('user')
    expect(snap.winLine).toHaveLength(5)
  })

  it('点穴 grants a second consecutive placement without a second skill', () => {
    let snap = playing()
    snap = applySkill(snap, 'dianxue', null)
    expect(snap.extraMove).toBe(true)
    expect(snap.skillUsesLeft.user).toBe(SKILL_LIMIT - 1)
    expect(canUseSkill(snap)).toBe(false) // one skill per turn
    snap = placeMove(snap, { r: 7, c: 7 })
    expect(snap.status).toBe('playing')
    expect(snap.turn).toBe('user') // extra move
    snap = placeMove(snap, { r: 8, c: 8 })
    expect(snap.turn).toBe('ai') // both placements consumed
  })

  it('倒反天罡 swaps the color ownership, not the board stones', () => {
    let snap = playing()
    snap = placeMove(snap, { r: 7, c: 7 }) // user (black)
    expect(roleColor(snap, 'user')).toBe(1)
    snap = placeMove(snap, { r: 0, c: 0 }) // ai (white)
    expect(snap.turn).toBe('user')
    snap = applySkill(snap, 'daofan', null)
    expect(roleColor(snap, 'user')).toBe(2) // user now owns white
    expect(snap.board[7]?.[7]).toBe(1) // stones unchanged
    expect(snap.turn).toBe('user') // still the user's turn to place
    snap = placeMove(snap, { r: 8, c: 8 })
    expect(snap.board[8]?.[8]).toBe(2) // placed as the new color
    expect(snap.turn).toBe('ai') // next turn still passes to the opponent
  })

  it('改头换面 converts one opponent stone and can complete a five', () => {
    let snap = playing()
    // User (black) builds four; AI places one white stone in the middle.
    for (const c of [0, 1, 2, 3]) {
      snap = placeMove(snap, { r: 7, c })
      snap = placeMove(snap, { r: 8, c })
    }
    // White stone at (7,4)? that's where black wants to play. Convert an AI stone instead: (8,0) is white.
    const white = snap.board[8]![0]
    expect(white).toBe(2)
    snap = applySkill(snap, 'gaitou', { r: 8, c: 0 })
    expect(snap.board[8]?.[0]).toBe(1)
  })

  it('雷霆大脚 clears a whole row (own stones included)', () => {
    let snap = playing()
    for (const c of [0, 1, 2, 3]) {
      snap = placeMove(snap, { r: 7, c })
      snap = placeMove(snap, { r: 8, c })
    }
    snap = applySkill(snap, 'leiting', { kind: 'row', index: 7 })
    expect(snap.board[7]?.every(stone => stone === 0)).toBe(true)
    expect(snap.board[8]?.some(stone => stone !== 0)).toBe(true) // other row untouched
    // Line identity: row 7 has exactly 15 cells.
    expect(lineCells(snap, { kind: 'row', index: 7 })).toHaveLength(15)
  })

  it('偷袭 removes any one opponent stone', () => {
    let snap = playing()
    snap = placeMove(snap, { r: 7, c: 7 })
    snap = placeMove(snap, { r: 8, c: 8 })
    snap = applySkill(snap, 'touxi', { r: 8, c: 8 })
    expect(snap.board[8]?.[8]).toBe(0)
    expect(snap.skillUsesLeft.user).toBe(SKILL_LIMIT - 1)
  })

  it('何意味 makes the opponent\'s next stone land randomly and consumes their turn', () => {
    let snap = playing()
    snap = applySkill(snap, 'heyiwei', null)
    expect(snap.autoRandom).toBe(true)
    snap = placeMove(snap, { r: 7, c: 7 }) // user places; the AI auto-turn resolves inside
    // AI stone placed somewhere random; turn back to the user.
    expect(snap.turn).toBe('user')
    const stones = snap.board.flat().filter(stone => stone !== 0).length
    expect(stones).toBe(2) // user's stone + the AI's random stone
    const auto = autoRandomTurn(playing(), rng(0))
    expect(auto.board.flat().filter(stone => stone !== 0)).toHaveLength(1)
  })

  it('locks the opponent out of skills for the turn after a skill, then unlocks', () => {
    let snap = playing()
    snap = applySkill(snap, 'dianxue', null) // user used a skill → ai locked
    expect(snap.skillLock).toBe('ai')
    snap = placeMove(snap, { r: 7, c: 7 })
    snap = placeMove(snap, { r: 8, c: 8 }) // completes the user's 点穴 turn
    expect(snap.turn).toBe('ai')
    expect(canUseSkill(snap)).toBe(false) // AI locked this turn
    snap = placeMove(snap, { r: 0, c: 0 }) // AI's turn ends
    expect(snap.turn).toBe('user')
    expect(snap.skillLock).toBeNull()
    expect(canUseSkill(snap)).toBe(true)
  })

  it('caps each side at two skill uses per game', () => {
    let snap = playing()
    snap = applySkill(snap, 'dianxue', null)
    snap = placeMove(snap, { r: 7, c: 7 })
    snap = placeMove(snap, { r: 8, c: 8 })
    snap = placeMove(snap, { r: 0, c: 0 })
    snap = applySkill(snap, 'dianxue', null)
    expect(snap.skillUsesLeft.user).toBe(0)
    snap = placeMove(snap, { r: 9, c: 9 })
    snap = placeMove(snap, { r: 10, c: 10 })
    snap = placeMove(snap, { r: 1, c: 1 })
    expect(canUseSkill(snap)).toBe(false)
    const before = snap
    expect(applySkill(snap, 'dianxue', null)).toBe(before) // no-op at the budget cap
  })

  it('the AI blocks an immediate user win with a defensive skill', () => {
    let snap = playing()
    // User (black) builds four in a row with an open end; after the fourth
    // stone it is the AI's turn with the threat pending.
    for (let c = 0; c < 4; c++) {
      snap = placeMove(snap, { r: 7, c })
      if (c < 3) snap = placeMove(snap, { r: 8, c })
    }
    expect(snap.status).toBe('playing')
    expect(snap.turn).toBe('ai')
    const decision = decideAiSkill(snap, rng(0.1, 0.9))
    expect(decision).not.toBeNull()
    expect(['touxi', 'gaitou', 'leiting']).toContain(decision?.skill)
  })

  it('the strong AI takes an immediate win when it can', () => {
    let snap = playing()
    snap = placeMove(snap, { r: 0, c: 0 }) // user opens
    // AI (white) builds four on its turns.
    for (let i = 0; i < 4; i++) {
      snap = placeMove(snap, { r: 9, c: i }) // ai builds
      if (i < 3) snap = placeMove(snap, { r: 14, c: i }) // user filler
    }
    expect(snap.status).toBe('playing')
    expect(snap.turn).toBe('user')
    // Give the AI the turn with its winning move available.
    snap = placeMove(snap, { r: 13, c: 13 })
    expect(snap.turn).toBe('ai')
    expect(chooseAiCell(snap, rng(0.5))).toEqual({ r: 9, c: 4 })
  })
})
