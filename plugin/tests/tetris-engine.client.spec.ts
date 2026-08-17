/**
 * Tetris engine rules: spawn/queue, movement, rotation with kicks, soft/hard
 * drop, lock + line clear scoring, hold, game over, and the snapshot's
 * JSON-serializability (progress persistence contract).
 */
import { describe, expect, it } from 'vitest'
import {
  colorOf, fallSpeed, ghostY, hardDrop, holdPiece, initTetris, isValid,
  lockPiece, movePiece, pieceCells, rotatePiece, softDrop, spawnPiece, startTetris,
  updateTetris,
} from '../src/client/games/tetris/engine.ts'

function rng(): () => number {
  return () => 0.5
}

const SETTINGS = { cols: 20, rows: 10, speedMs: 800, lockDelayMs: 500, pieceSet: 'classic' as const }

describe('tetris engine', () => {
  it('starts with a preview queue and a spawned current piece on a landscape board', () => {
    const snap = initTetris(SETTINGS, rng())
    expect(snap.cols).toBe(20)
    expect(snap.rows).toBe(10)
    // The L2 spawn contract: the queue holds the next preview pieces after
    // the current one was shifted out.
    expect(snap.queue).toHaveLength(4)
    expect(snap.current).not.toBeNull()
    expect(snap.started).toBe(true)
    expect(isValid(snap, snap.curX, snap.curY)).toBe(true)
  })

  it('moves and clamps at the walls', () => {
    const snap = initTetris(SETTINGS, rng())
    const before = snap.curX
    const right = movePiece(snap, 1, 0)
    expect(right.curX).toBe(before + 1)
    let far = snap
    for (let i = 0; i < 40; i++) far = movePiece(far, 1, 0)
    expect(far.curX).toBeLessThanOrEqual(snap.cols - 1)
    let lefty = snap
    for (let i = 0; i < 40; i++) lefty = movePiece(lefty, -1, 0)
    expect(lefty.curX).toBeGreaterThanOrEqual(0)
  })

  it('rotates (with kicks) and never corrupts the state', () => {
    const snap = initTetris(SETTINGS, rng())
    const rotated = rotatePiece(snap, true)
    expect(rotated.current?.rotation).not.toBe(snap.current?.rotation)
    expect(isValid(rotated, rotated.curX, rotated.curY)).toBe(true)
    // Three more turns close the full 360° cycle.
    const back = rotatePiece(rotatePiece(rotatePiece(rotated, true), true), true)
    expect(back.current?.rotation).toBe(snap.current?.rotation)
  })

  it('soft drop scores 1 per row; hard drop locks and scores 2 per row', () => {
    const snap = initTetris(SETTINGS, rng())
    const soft = softDrop(snap)
    expect(soft.score).toBe(1)
    const hard = hardDrop(snap, rng())
    expect(hard.score).toBeGreaterThanOrEqual(2)
    expect(hard.current).not.toBeNull() // locked and respawned
    expect(hard.queue).toHaveLength(4)
  })

  it('clears a full row with scoring and keeps the board rectangular', () => {
    const snap = initTetris(SETTINGS, rng())
    const grid = snap.grid.map(row => [...row])
    for (let c = 0; c < snap.cols; c++) grid[snap.rows - 1]![c] = '#123456'
    const filled: typeof snap = { ...snap, grid }
    const locked = lockPiece(filled, rng())
    expect(locked.lines).toBe(1)
    expect(locked.score).toBe(100)
    expect(locked.grid).toHaveLength(snap.rows)
    expect(locked.grid[snap.rows - 1]?.every(cell => cell === null)).toBe(true)
  })

  it('hold swaps the current piece once per spawn', () => {
    let snap = initTetris(SETTINGS, rng())
    const currentName = snap.current?.name
    snap = holdPiece(snap, rng())
    expect(snap.hold?.name).toBe(currentName)
    expect(snap.current).not.toBeNull()
    expect(snap.canHold).toBe(false)
    const again = holdPiece(snap, rng())
    expect(again.current?.name).toBe(snap.current?.name) // unchanged: canHold spent
  })

  it('ghost drop lands on the floor of stacked cells', () => {
    const snap = initTetris(SETTINGS, rng())
    const gy = ghostY(snap)
    expect(gy).toBeGreaterThanOrEqual(snap.curY)
    expect(isValid(snap, snap.curX, gy)).toBe(true)
    expect(isValid(snap, snap.curX, gy + 1)).toBe(false)
  })

  it('falls over time, locks on the ground after the lock delay, and goes game over at a full top', () => {
    let snap = initTetris(SETTINGS, rng())
    // Drop until grounded.
    for (let i = 0; i < 200 && !snap.onGround; i++) snap = updateTetris(snap, 100, rng())
    expect(snap.onGround).toBe(true)
    const afterDelay = updateTetris(snap, 600, rng())
    expect(afterDelay.current?.name).not.toBe(snap.current?.name) // locked + respawned
    // A completely filled board makes the next spawn impossible → game over.
    const full = initTetris(SETTINGS, rng())
    const blocked = {
      ...full,
      current: null,
      grid: full.grid.map(row => row.map(() => '#999999')),
    }
    expect(spawnPiece(blocked, rng()).gameOver).toBe(true)
  })

  it('fall speed scales with level (the L2 formula)', () => {
    const snap = { ...initTetris(SETTINGS, rng()), level: 5 }
    expect(fallSpeed(snap)).toBe(Math.max(60, Math.floor(800 * Math.pow(0.85, 4))))
  })

  it('the snapshot round-trips through JSON (progress persistence contract)', () => {
    let snap = initTetris(SETTINGS, rng())
    snap = movePiece(snap, 1, 0)
    snap = hardDrop(snap, rng())
    snap = holdPiece(snap, rng())
    const revived = JSON.parse(JSON.stringify(snap)) as typeof snap
    expect(revived.grid).toEqual(snap.grid)
    expect(revived.current).toEqual(snap.current)
    expect(revived.queue).toEqual(snap.queue)
    expect(revived.score).toBe(snap.score)
    // Revived state remains playable.
    expect(isValid(revived, revived.curX, revived.curY)).toBe(true)
  })

  it('piece definitions and colors resolve', () => {
    expect(pieceCells('O', 0, 'classic', 5, 5)).toEqual([[5, 5], [6, 5], [5, 6], [6, 6]])
    expect(colorOf('I', 'classic')).toBe('#1daed8')
    expect(colorOf('U', 'extended')).toBe('#7bd5c4')
  })

  it('restart resets score/lines and respawns', () => {
    const snap = initTetris(SETTINGS, rng())
    const restarted = startTetris({ ...snap, score: 500, lines: 3, gameOver: true }, rng())
    expect(restarted.score).toBe(0)
    expect(restarted.lines).toBe(0)
    expect(restarted.gameOver).toBe(false)
    expect(restarted.current).not.toBeNull()
  })
})
