/**
 * 贪吃蛇 surface: canvas rendering over the pure engine. Controls are arrows
 * or WASD (a turn never reverses the snake); the snake keeps moving up until
 * steered. P pauses, Enter restarts after death, Escape returns to the hub.
 * Progress (body, foods, obstacles, score) persists on exit and on death.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameProps } from '../shared.ts'
import { useBgm } from '../../audio.ts'
import { sanitizeDataUrl } from '../../security.ts'
import {
  DIR_VECTORS, initSnake, queueTurn, setPaused, stepSnake,
  type Direction, type SnakeSnapshot,
} from './engine.ts'
import css from './SnakeGame.module.css'

const CELL = 26

/** Fit a background image into the canvas like `background-size: cover`. */
function drawBackground(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number): void {
  const ir = image.width / image.height
  const cr = width / height
  let dw = width
  let dh = height
  if (ir > cr) dh = width / ir
  else dw = height * ir
  context.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh)
}

const KEY_DIRS: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
}

export function SnakeGame(props: GameProps) {
  const { useStore, actions, t } = props
  const settings = useStore(s => s.settings.snake)
  const saved = useStore(s => s.progress.snake)
  const [snap, setSnap] = useState<SnakeSnapshot>(() => saved ?? initSnake(settings))
  const snapRef = useRef(snap)
  snapRef.current = snap
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bgImageRef = useRef<HTMLImageElement | null>(null)
  const [bgReady, setBgReady] = useState(false)

  const running = snap.status === 'running'
  const bgm = useBgm(settings.bgm, running)

  // Playtime: counting starts when the game view opens and stops only on
  // exit (pausing or dying does NOT stop the clock — 只有退出才停).
  useEffect(() => {
    actions.setSessionActive(true)
    return () => {
      queueMicrotask(() => { actions.setSessionActive(false) })
    }
  }, [actions])

  // Save progress whenever the game settles, and once on leave (deferred
  // past the commit to avoid re-entrant store writes during unmount).
  useEffect(() => {
    if (snap.status === 'over' || snap.status === 'paused') actions.saveSnakeProgress(snap)
  }, [actions, snap.status])
  useEffect(() => () => {
    const final = snapRef.current
    queueMicrotask(() => { actions.saveSnakeProgress(final) })
  }, [actions])

  // Background image (sanitized data URL from settings).
  useEffect(() => {
    let cancelled = false
    setBgReady(false)
    bgImageRef.current = null
    const url = sanitizeDataUrl(settings.bgImage, 'image')
    if (url === null) {
      setBgReady(true)
      return
    }
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      bgImageRef.current = image
      setBgReady(true)
    }
    image.onerror = () => {
      if (!cancelled) setBgReady(true)
    }
    image.src = url
    return () => { cancelled = true }
  }, [settings.bgImage])

  // Step interval.
  useEffect(() => {
    if (snap.status !== 'running') return
    const id = window.setInterval(() => { setSnap(prev => stepSnake(prev)) }, settings.speedMs)
    return () => { window.clearInterval(id) }
  }, [snap.status, settings.speedMs])

  // Keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const key = event.key
      if (key === 'Escape') {
        event.preventDefault()
        props.onExit()
        return
      }
      if (key === 'Enter') {
        const current = snapRef.current
        if (current.status === 'over') setSnap(initSnake(settings))
        return
      }
      if (key === 'p' || key === 'P' || key === ' ') {
        event.preventDefault()
        setSnap(prev => (prev.status === 'running' || prev.status === 'paused') ? setPaused(prev, prev.status !== 'paused') : prev)
        return
      }
      const dir = KEY_DIRS[key]
      if (dir === undefined) return
      event.preventDefault()
      setSnap(prev => queueTurn(prev, dir))
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [props.onExit, settings])

  // Render.
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas === null || context === null || context === undefined || !bgReady) return
    const width = snap.cols * CELL
    const height = snap.rows * CELL
    canvas.width = width
    canvas.height = height
    context.fillStyle = '#101320'
    context.fillRect(0, 0, width, height)
    const bg = bgImageRef.current
    if (bg !== null) {
      drawBackground(context, bg, width, height)
      context.fillStyle = 'rgba(8, 10, 18, 0.55)'
      context.fillRect(0, 0, width, height)
    }
    // Grid.
    context.strokeStyle = 'rgba(255,255,255,0.06)'
    context.lineWidth = 1
    for (let c = 0; c <= snap.cols; c++) {
      context.beginPath()
      context.moveTo(c * CELL + 0.5, 0)
      context.lineTo(c * CELL + 0.5, height)
      context.stroke()
    }
    for (let r = 0; r <= snap.rows; r++) {
      context.beginPath()
      context.moveTo(0, r * CELL + 0.5)
      context.lineTo(width, r * CELL + 0.5)
      context.stroke()
    }
    const cell = (x: number, y: number): void => {
      context.beginPath()
      context.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL * 0.3, 0, Math.PI * 2)
      context.fill()
    }
    // Foods.
    context.fillStyle = '#ef5350'
    for (const food of snap.foods) cell(food.c, food.r)
    context.fillStyle = 'rgba(255,255,255,0.25)'
    for (const food of snap.foods) {
      context.beginPath()
      context.arc(food.c * CELL + CELL / 2, food.r * CELL + CELL / 2 - CELL * 0.1, CELL * 0.08, 0, Math.PI * 2)
      context.fill()
    }
    // Obstacles.
    for (const obstacle of snap.obstacles) {
      context.fillStyle = '#4a4f63'
      context.fillRect(obstacle.c * CELL + 2, obstacle.r * CELL + 2, CELL - 4, CELL - 4)
      context.strokeStyle = '#2b2e3d'
      context.strokeRect(obstacle.c * CELL + 2.5, obstacle.r * CELL + 2.5, CELL - 5, CELL - 5)
    }
    // Snake body (head brighter).
    snap.body.forEach((part, index) => {
      const isHead = index === 0
      context.fillStyle = isHead ? '#7ee08a' : '#3fa558'
      const inset = 2
      const radius = 6
      const x = part.c * CELL + inset
      const y = part.r * CELL + inset
      const size = CELL - inset * 2
      context.beginPath()
      context.moveTo(x + radius, y)
      context.arcTo(x + size, y, x + size, y + size, radius)
      context.arcTo(x + size, y + size, x, y + size, radius)
      context.arcTo(x, y + size, x, y, radius)
      context.arcTo(x, y, x + size, y, radius)
      context.closePath()
      context.fill()
    })
    // Eyes on the head.
    const head = snap.body[0]
    if (head !== undefined) {
      const vector = DIR_VECTORS[snap.direction]
      const cx = head.c * CELL + CELL / 2
      const cy = head.r * CELL + CELL / 2
      context.fillStyle = '#0d2414'
      for (const side of [-1, 1]) {
        context.beginPath()
        context.arc(cx + vector.c * 5 + (vector.r !== 0 ? side * 4.5 : 0), cy + vector.r * 5 + (vector.c !== 0 ? side * 4.5 : 0), 2.2, 0, Math.PI * 2)
        context.fill()
      }
    }
    context.strokeStyle = 'rgba(255,255,255,0.14)'
    context.lineWidth = 2
    context.strokeRect(1, 1, width - 2, height - 2)
  }, [snap, bgReady])

  return (
    <div className={css.root}>
      <div className={css.boardArea}>
        <canvas ref={canvasRef} className={css.canvas} aria-label="贪吃蛇" />
        {(snap.status === 'paused' || snap.status === 'over') && (
          <div className={css.overlay}>
            <div className={css.overlayTitle}>
              {snap.status === 'paused' ? t('game.pause') : t('snake.over.title')}
            </div>
            {snap.status === 'over' && (
              <div className={css.overlaySub}>
                {snap.overReason === 'obstacle' ? t('snake.over.obstacle')
                  : snap.overReason === 'self' ? t('snake.over.self')
                    : snap.overReason === 'full' ? t('snake.over.full') : ''}
              </div>
            )}
            <div className={css.overlayHint}>{snap.status === 'over' ? t('snake.over.restart') : t('snake.hint')}</div>
          </div>
        )}
      </div>
      <div className={css.sidebar}>
        <div className={css.stat}>
          <span>{t('snake.score')}</span>
          <b>{snap.score}</b>
        </div>
        <div className={css.stat}>
          <span>{t('snake.length')}</span>
          <b>{snap.body.length}</b>
        </div>
        <div className={css.stat}>
          <span>{t('hub.time.left')}</span>
          <b>{props.timeLeft}</b>
        </div>        <div className={css.hintText}>{t('snake.hint')}</div>
        <button type="button" className={css.miniButton} onClick={() => { bgm.toggle() }}>
          {bgm.muted ? t('game.musicOff') : t('game.musicOn')}
        </button>
        <button type="button" className={css.miniButton}
          onClick={() => { setSnap(prev => (prev.status === 'running' || prev.status === 'paused') ? setPaused(prev, prev.status !== 'paused') : prev) }}>
          {snap.status === 'paused' ? t('game.resume') : t('game.pause')}
        </button>
        <button type="button" className={css.miniButton} onClick={() => { setSnap(initSnake(settings)) }}>
          {t('game.restart')}
        </button>
      </div>
    </div>
  )
}
