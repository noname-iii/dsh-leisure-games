/**
 * 经典扫雷 engine rules: defaults, first-click safety, flood reveal, flag
 * toggling, loss (all mines revealed), win (all safe cells revealed), chord,
 * and JSON round-trip persistence. Layouts use a seeded LCG so mine
 * placements spread deterministically (a constant RNG clusters them and
 * degenerates into instant wins).
 */
import { describe, expect, it } from 'vitest'
import {
  adjacentMines, chordCell, flagCell, freshMinesweeper, inBounds, neighborsOf,
  revealCell,
} from '../src/client/games/minesweeper/engine.ts'

/** Deterministic seeded LCG → uniform-ish [0,1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const SETTINGS = { rows: 20, cols: 30, mines: 17 }

/** The first mine cell of a started snapshot. */
function firstMine(snap: ReturnType<typeof freshMinesweeper>): { r: number; c: number } {
  for (let r = 0; r < snap.rows; r++) {
    for (let c = 0; c < snap.cols; c++) {
      if (snap.board[r]![c]!.mine) return { r, c }
    }
  }
  return { r: 0, c: 0 }
}

describe('minesweeper engine', () => {
  it('defaults to a 20×30 board with 17 mines and a square shape', () => {
    const snap = freshMinesweeper(SETTINGS)
    expect(snap.rows).toBe(20)
    expect(snap.cols).toBe(30)
    expect(snap.mines).toBe(17)
    expect(snap.board).toHaveLength(20)
    expect(snap.board[0]).toHaveLength(30)
    expect(snap.status).toBe('playing')
    expect(snap.started).toBe(false)
  })

  it('the first reveal is always safe and places exactly 17 mines elsewhere', () => {
    const snap = freshMinesweeper(SETTINGS)
    const next = revealCell(snap, { r: 5, c: 7 }, lcg(42))
    expect(next.status).toBe('playing')
    expect(next.board[5]?.[7]?.mine).toBe(false)
    expect(next.board[5]?.[7]?.revealed).toBe(true)
    const mines = next.board.flat().filter(cell => cell.mine)
    expect(mines).toHaveLength(17)
    // Neighbors of the first click are excluded from mine placement too.
    for (const n of neighborsOf(next, { r: 5, c: 7 })) {
      expect(next.board[n.r]?.[n.c]?.mine).toBe(false)
    }
  })

  it('flood reveals the zero component and its numbered rim', () => {
    // One mine on 8×8: the zero flood opens the whole safe area except rim
    // cells that are boxed in by numbered cells (classic behavior).
    const snap = freshMinesweeper({ rows: 8, cols: 8, mines: 1 })
    const next = revealCell(snap, { r: 4, c: 4 }, lcg(7))
    expect(next.status).toBe('playing')
    expect(next.revealedCount).toBe(62)
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = next.board[r]![c]!
        if (cell.revealed) expect(cell.mine).toBe(false)
      }
    }
  })

  it('flags toggle only on unrevealed cells', () => {
    const snap = freshMinesweeper(SETTINGS)
    const flagged = flagCell(snap, { r: 3, c: 3 })
    expect(flagged.board[3]?.[3]?.flagged).toBe(true)
    const unflagged = flagCell(flagged, { r: 3, c: 3 })
    expect(unflagged.board[3]?.[3]?.flagged).toBe(false)
    // Revealed cells cannot be flagged.
    const revealed = revealCell(snap, { r: 0, c: 0 }, lcg(1))
    const noFlag = flagCell(revealed, { r: 0, c: 0 })
    expect(noFlag.board[0]?.[0]?.flagged).toBe(false)
  })

  it('revealing a mine loses and shows every mine', () => {
    const snap = freshMinesweeper({ rows: 20, cols: 30, mines: 17 })
    const started = revealCell(snap, { r: 0, c: 0 }, lcg(3))
    expect(started.status).toBe('playing')
    const mine = firstMine(started)
    const lost = revealCell(started, mine, lcg(3))
    expect(lost.status).toBe('lost')
    expect(lost.board.flat().filter(cell => cell.mine && cell.revealed)).toHaveLength(17)
  })

  it('revealing every safe cell wins', () => {
    const snap = freshMinesweeper({ rows: 5, cols: 5, mines: 1 })
    const started = revealCell(snap, { r: 0, c: 0 }, lcg(9))
    // Reveal every non-mine cell (some may already be open).
    let next = started
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (!next.board[r]![c]!.mine && !next.board[r]![c]!.revealed) {
          next = revealCell(next, { r, c }, lcg(9))
        }
      }
    }
    expect(next.status).toBe('won')
  })

  it('chord reveals neighbors only when the flag count matches the number', () => {
    // Hand-built 5×5 board: one mine at (1,1), a revealed "1" at (2,2).
    const snap = freshMinesweeper({ rows: 5, cols: 5, mines: 1 })
    const board = snap.board.map(row => row.map(cell => ({ ...cell })))
    board[1]![1] = { mine: true, revealed: false, flagged: false }
    board[2]![2] = { mine: false, revealed: true, flagged: false }
    const hand = { ...snap, board, started: true, revealedCount: 1 }
    expect(adjacentMines(hand, 2, 2)).toBe(1)
    // A chord with zero flags on the "1" is a no-op.
    const noop = chordCell(hand, { r: 2, c: 2 }, lcg(11))
    expect(noop.revealedCount).toBe(1)
    // Flag the adjacent mine, then chord — the neighbors open (a zero
    // neighbor may cascade into a flood, so assert the mine stays hidden and
    // the count grows).
    const flagged = flagCell(hand, { r: 1, c: 1 })
    const chorded = chordCell(flagged, { r: 2, c: 2 }, lcg(11))
    expect(chorded.revealedCount).toBeGreaterThan(1)
    expect(chorded.board[1]?.[1]?.revealed).toBe(false) // the flagged mine stays hidden
    expect(chorded.status).toBe('playing')
  })

  it('ignores out-of-bounds and settled-state actions', () => {
    const snap = freshMinesweeper(SETTINGS)
    expect(inBounds(snap, 0, 0)).toBe(true)
    expect(inBounds(snap, -1, 0)).toBe(false)
    expect(inBounds(snap, 20, 0)).toBe(false)
    expect(inBounds(snap, 0, 30)).toBe(false)
    expect(revealCell(snap, { r: 99, c: 99 }, lcg(5))).toBe(snap)
    // Reveal a mine → lost; further actions are no-ops.
    const started = revealCell(snap, { r: 0, c: 0 }, lcg(5))
    const lost = revealCell(started, firstMine(started), lcg(5))
    expect(lost.status).toBe('lost')
    expect(revealCell(lost, { r: 1, c: 1 }, lcg(5))).toBe(lost)
    expect(flagCell(lost, { r: 1, c: 1 })).toBe(lost)
  })

  it('the snapshot round-trips through JSON (progress persistence contract)', () => {
    const snap = freshMinesweeper(SETTINGS)
    const played = revealCell(flagCell(snap, { r: 2, c: 2 }), { r: 9, c: 9 }, lcg(13))
    const revived = JSON.parse(JSON.stringify(played)) as typeof played
    expect(revived).toEqual(played)
    expect(revived.board[2]?.[2]?.flagged).toBe(true)
    expect(revived.board[9]?.[9]?.revealed).toBe(true)
  })
})
