/**
 * Snake engine rules: initial geometry, continuous upward movement, arrow/WASD
 * turns (no reversal), edge wrap-around, growth on food, food respawn,
 * obstacle/self death, and pause.
 */
import { describe, expect, it } from 'vitest'
import {
  initSnake, isReverse, queueTurn, setPaused, stepSnake, wrap,
} from '../src/client/games/snake/engine.ts'

/** Deterministic RNG cycling through a fixed sequence. */
function rng(...values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)] ?? 0
}

const SETTINGS = { rows: 20, cols: 10, foodCount: 5, obstacleCount: 5, initialLength: 3 }

describe('snake engine', () => {
  it('starts centered with the configured length, moving up, with 5 foods and 5 obstacles', () => {
    const snap = initSnake(SETTINGS, rng(0))
    expect(snap.body).toHaveLength(3)
    expect(snap.direction).toBe('up')
    expect(snap.foods).toHaveLength(5)
    expect(snap.obstacles).toHaveLength(5)
    expect(snap.body[0]).toEqual({ r: 10, c: 5 }) // head at the vertical center, column center
    expect(snap.body[1]).toEqual({ r: 11, c: 5 })
    expect(snap.body[2]).toEqual({ r: 12, c: 5 })
    // Foods/obstacles never overlap the body or each other.
    const taken = new Set(snap.body.map(p => `${p.r}:${p.c}`))
    for (const food of snap.foods) {
      expect(taken.has(`${food.r}:${food.c}`)).toBe(false)
      taken.add(`${food.r}:${food.c}`)
    }
    for (const obstacle of snap.obstacles) {
      expect(taken.has(`${obstacle.r}:${obstacle.c}`)).toBe(false)
      taken.add(`${obstacle.r}:${obstacle.c}`)
    }
  })

  it('keeps moving up one cell per step when no input arrives', () => {
    const snap = initSnake(SETTINGS, rng(0))
    const first = stepSnake(snap, rng(0))
    expect(first.body[0]).toEqual({ r: 9, c: 5 })
    expect(first.body[1]).toEqual({ r: 10, c: 5 })
    const second = stepSnake(first, rng(0))
    expect(second.body[0]).toEqual({ r: 8, c: 5 })
  })

  it('wraps through every edge to the opposite side of the same row/column', () => {
    // Top edge: place the head just under row 0 and travel up.
    let snap = initSnake(SETTINGS, rng(0))
    snap = { ...snap, body: [{ r: 0, c: 5 }, { r: 1, c: 5 }, { r: 2, c: 5 }] }
    expect(stepSnake(snap, rng(0)).body[0]).toEqual({ r: 19, c: 5 })
    // Bottom edge.
    snap = { ...snap, body: [{ r: 19, c: 5 }, { r: 18, c: 5 }, { r: 17, c: 5 }], direction: 'down' }
    const bottomStep = stepSnake(snap, rng(0))
    expect(bottomStep.body[0]).toEqual({ r: 0, c: 5 })
    // Left edge.
    snap = { ...snap, body: [{ r: 5, c: 0 }, { r: 5, c: 1 }, { r: 5, c: 2 }], direction: 'left' }
    expect(stepSnake(snap, rng(0)).body[0]).toEqual({ r: 5, c: 9 })
    // Right edge.
    snap = { ...snap, body: [{ r: 5, c: 9 }, { r: 5, c: 8 }, { r: 5, c: 7 }], direction: 'right' }
    expect(stepSnake(snap, rng(0)).body[0]).toEqual({ r: 5, c: 0 })
  })

  it('turns on arrows/wasd and never reverses', () => {
    const fresh = initSnake(SETTINGS, rng(0)) // moving up
    const left = queueTurn(fresh, 'left')
    expect(left.pendingTurn).toBe('left')
    expect(stepSnake(left, rng(0)).body[0]).toEqual({ r: 10, c: 4 })
    expect(stepSnake(left, rng(0)).direction).toBe('left')
    // Reversing the queued direction is ignored (the queued turn stays).
    expect(queueTurn(left, 'right').pendingTurn).toBe('left')
    // Reversing the travel direction is ignored (nothing queued).
    expect(queueTurn({ ...fresh, direction: 'left' }, 'right').pendingTurn).toBeNull()
  })

  it('grows by one and scores when eating, and respawns a food', () => {
    const snap = initSnake(SETTINGS, rng(0.5, 0.25))
    // Place a food directly in front of the head.
    const head = snap.body[0]!
    const foods = [{ r: head.r - 1, c: head.c }, ...snap.foods.slice(1)]
    const withFood = { ...snap, foods }
    const next = stepSnake(withFood, rng(0.1))
    expect(next.body).toHaveLength(4)
    expect(next.score).toBe(10)
    expect(next.foods).toHaveLength(5) // respawned to keep the count
    expect(next.foods.some(food => food.r === head.r - 1 && food.c === head.c)).toBe(false)
  })

  it('dies on an obstacle', () => {
    const snap = initSnake(SETTINGS, rng(0))
    const head = snap.body[0]!
    const withObstacle = { ...snap, obstacles: [{ r: head.r - 1, c: head.c }, ...snap.obstacles.slice(1)] }
    const next = stepSnake(withObstacle, rng(0))
    expect(next.status).toBe('over')
    expect(next.overReason).toBe('obstacle')
  })

  it('dies biting its own body', () => {
    const snap = initSnake(SETTINGS, rng(0))
    // Head at (10,5), moving down, with the body directly below — the step
    // enters its own body.
    const direct = {
      ...snap,
      direction: 'down' as const,
      body: [{ r: 10, c: 5 }, { r: 11, c: 5 }, { r: 12, c: 5 }],
      foods: snap.foods.filter(food => !(food.r === 11 && food.c === 5)),
    }
    const died = stepSnake(direct, rng(0))
    expect(died.status).toBe('over')
    expect(died.overReason).toBe('self')
  })

  it('can move into the tail cell that just vacated (no false death)', () => {
    const snap = {
      ...initSnake(SETTINGS, rng(0)),
      direction: 'down' as const,
      body: [{ r: 5, c: 5 }, { r: 4, c: 5 }, { r: 3, c: 5 }],
    }
    const next = stepSnake(snap, rng(0))
    expect(next.status).toBe('running')
    expect(next.body).toHaveLength(3)
  })

  it('pauses and resumes', () => {
    const snap = initSnake(SETTINGS, rng(0))
    const paused = setPaused(snap, true)
    expect(paused.status).toBe('paused')
    expect(stepSnake(paused, rng(0))).toBe(paused) // paused: stepping is a no-op
    const resumed = setPaused(paused, false)
    expect(resumed.status).toBe('running')
  })

  it('wrap is pure modulo', () => {
    expect(wrap(-1, 20)).toBe(19)
    expect(wrap(20, 20)).toBe(0)
    expect(wrap(5, 20)).toBe(5)
    expect(isReverse('up', 'down')).toBe(true)
    expect(isReverse('left', 'right')).toBe(true)
    expect(isReverse('up', 'left')).toBe(false)
  })
})
