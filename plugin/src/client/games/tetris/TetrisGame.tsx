/**
 * 俄罗斯方块 surface: canvas port of the L2 web version, landscape board by
 * default (20 wide × 10 tall). Carries its own settings modal (background
 * image/music, volume, dim, fall speed, board size, piece set, grid/ghost)
 * which feeds the hub store. Keys: arrows/WASD move, ↑ rotate, Z reverse,
 * Space hard drop, C hold, P pause, R restart, M music, Q back to hub.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameProps } from '../shared.ts'
import { useBgm } from '../../audio.ts'
import { sanitizeDataUrl } from '../../security.ts'
import {
  colorOf, fallSpeed, ghostY, hardDrop, holdPiece, initTetris,
  movePiece, pieceCells, rotatePiece, rotationsOf, setTetrisPaused,
  softDrop, startTetris, updateTetris,
  PIECE_SETS, type PieceSetId, type TetrisSnapshot,
} from './engine.ts'
import css from './TetrisGame.module.css'

const MAX_FILE_BYTES = 4 * 1024 * 1024

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + w, y, x + w, y + h, r)
  context.arcTo(x + w, y + h, x, y + h, r)
  context.arcTo(x, y + h, x, y, r)
  context.arcTo(x, y, x + w, y, r)
  context.closePath()
}

function shade(hex: string, factor: number): string {
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (rgb === null) return hex
  const channel = (value: string): number => {
    const n = parseInt(value, 16)
    return Math.max(0, Math.min(255, Math.floor(n * factor)))
  }
  return `rgb(${channel(rgb[1]!)},${channel(rgb[2]!)},${channel(rgb[3]!)})`
}

interface SettingsDraft {
  bgImage: string | null
  bgm: string | null
  volume: number
  dim: number
  speedMs: number
  cols: number
  rows: number
  pieceSet: PieceSetId
  showGrid: boolean
  showGhost: boolean
  musicEnabled: boolean
}

function readDataUrl(file: File | undefined): Promise<string | null> {
  return new Promise((resolve) => {
    if (file === undefined || file.size === 0 || file.size > MAX_FILE_BYTES) {
      resolve(null)
      return
    }
    const reader = new FileReader()
    reader.onload = () => { resolve(typeof reader.result === 'string' ? reader.result : null) }
    reader.onerror = () => { resolve(null) }
    reader.readAsDataURL(file)
  })
}

export function TetrisGame(props: GameProps) {
  const { useStore, actions, t } = props
  const settings = useStore(s => s.settings.tetris)
  const saved = useStore(s => s.progress.tetris)
  const [snap, setSnap] = useState<TetrisSnapshot>(() => saved ?? initTetris(settings))
  const snapRef = useRef(snap)
  snapRef.current = snap
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [flash, setFlash] = useState(0)
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nextRef = useRef<HTMLCanvasElement>(null)
  const holdRef = useRef<HTMLCanvasElement>(null)
  const bgImageRef = useRef<HTMLImageElement | null>(null)
  const [bgReady, setBgReady] = useState(false)

  const active = snap.started && !snap.paused && !snap.gameOver
  const bgm = useBgm(settings.bgm, active)

  // Playtime: counting starts when the game view opens and stops only on
  // exit (paused/game-over screens included — 只有退出才停).
  useEffect(() => {
    actions.setSessionActive(true)
    return () => {
      queueMicrotask(() => { actions.setSessionActive(false) })
    }
  }, [actions])

  // Persist on settle transitions (pause / game over) — never per-frame:
  // per-frame store writes keep every subscriber re-rendering at 60fps.
  useEffect(() => {
    if (snap.paused || snap.gameOver) actions.saveTetrisProgress(snapRef.current)
  }, [actions, snap.paused, snap.gameOver])
  // Leave-time save, deferred past the commit so the store write cannot
  // re-enter React's render phase (the #185 re-entrancy crash).
  useEffect(() => () => {
    const final = snapRef.current
    queueMicrotask(() => { actions.saveTetrisProgress(final) })
  }, [actions])

  // Background image (sanitized data URL from settings).
  useEffect(() => {
    let cancelled = false
    bgImageRef.current = null
    setBgReady(false)
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
    image.onerror = () => { if (!cancelled) setBgReady(true) }
    image.src = url
    return () => { cancelled = true }
  }, [settings.bgImage])

  // Main loop (rAF, like the original).
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return // non-browser (tests)
    let frame = 0
    let last = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min(50, now - last)
      last = now
      setSnap(prev => {
        if (!prev.started || prev.paused || prev.gameOver) return prev
        const before = prev.lines
        const next = updateTetris(prev, dt)
        if (next.lines > before) setFlash(0.6)
        return next
      })
      setFlash(value => (value > 0 ? Math.max(0, value - dt / 600) : 0))
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(frame) }
  }, [])

  // Keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      const key = event.key
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(key)) event.preventDefault()
      const current = snapRef.current
      if (key === 'Enter') {
        if (!current.started || current.gameOver) setSnap(startTetris({ ...snapRef.current }, undefined))
        return
      }
      if (key === 'r' || key === 'R') {
        setSnap(startTetris({ ...snapRef.current }, undefined))
        return
      }
      if (key === 'q' || key === 'Q') {
        props.onExit()
        return
      }
      if (key === 'm' || key === 'M') { bgm.toggle(); return }
      if (key === 'p' || key === 'P' || key === 'Escape') {
        if (current.started && !current.gameOver) setSnap(prev => setTetrisPaused(prev, !prev.paused))
        return
      }
      if (!current.started || current.paused || current.gameOver) return
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') setSnap(prev => movePiece(prev, -1, 0))
      else if (key === 'ArrowRight' || key === 'd' || key === 'D') setSnap(prev => movePiece(prev, 1, 0))
      else if (key === 'ArrowDown' || key === 's' || key === 'S') setSnap(prev => softDrop(prev))
      else if (key === ' ' || key === 'Spacebar') setSnap(prev => hardDrop(prev))
      else if (key === 'ArrowUp' || key === 'w' || key === 'W') setSnap(prev => rotatePiece(prev, true))
      else if (key === 'z' || key === 'Z') setSnap(prev => rotatePiece(prev, false))
      else if (key === 'c' || key === 'C' || key === 'Shift') setSnap(prev => holdPiece(prev))
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [bgm, props.onExit])

  // Canvas render.
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas === null || context === null || context === undefined || !bgReady) return
    const cell = Math.max(16, Math.min(30, Math.floor(560 / snap.cols)))
    const width = snap.cols * cell
    const height = snap.rows * cell
    canvas.width = width
    canvas.height = height
    context.fillStyle = '#12141f'
    context.fillRect(0, 0, width, height)
    const bg = bgImageRef.current
    if (bg !== null) {
      const ir = bg.width / bg.height
      const cr = width / height
      let dw = width
      let dh = height
      if (ir > cr) dh = width / ir
      else dw = height * ir
      context.drawImage(bg, (width - dw) / 2, (height - dh) / 2, dw, dh)
      context.fillStyle = 'rgba(8,10,16,0.55)'
      context.fillRect(0, 0, width, height)
    }
    const drawBlock = (x: number, y: number, color: string, ghost: boolean): void => {
      if (ghost) {
        context.strokeStyle = color
        context.lineWidth = 2
        context.strokeRect(x + 2, y + 2, cell - 4, cell - 4)
        return
      }
      context.fillStyle = color
      roundRect(context, x + 1, y + 1, cell - 2, cell - 2, 3)
      context.fill()
      context.strokeStyle = shade(color, 1.45)
      context.lineWidth = 1.5
      context.beginPath()
      context.moveTo(x + 2, y + cell - 3)
      context.lineTo(x + 2, y + 2)
      context.lineTo(x + cell - 3, y + 2)
      context.stroke()
      context.strokeStyle = shade(color, 0.5)
      context.beginPath()
      context.moveTo(x + cell - 3, y + 3)
      context.lineTo(x + cell - 3, y + cell - 3)
      context.lineTo(x + 3, y + cell - 3)
      context.stroke()
    }
    for (let r = 0; r < snap.rows; r++) {
      for (let c = 0; c < snap.cols; c++) {
        const color = snap.grid[r]?.[c]
        if (color != null) drawBlock(c * cell, r * cell, color, false)
      }
    }
    if (snap.current !== null && !snap.gameOver) {
      if (settings.showGhost) {
        const gy = ghostY(snap)
        for (const [cx, cy] of pieceCells(snap.current.name, snap.current.rotation, snap.pieceSet, snap.curX, gy)) {
          if (cy >= 0 && cy < snap.rows) drawBlock(cx * cell, cy * cell, colorOf(snap.current.name, snap.pieceSet), true)
        }
      }
      for (const [cx, cy] of pieceCells(snap.current.name, snap.current.rotation, snap.pieceSet, snap.curX, snap.curY)) {
        if (cy >= 0 && cy < snap.rows) drawBlock(cx * cell, cy * cell, colorOf(snap.current.name, snap.pieceSet), false)
      }
    }
    if (settings.showGrid) {
      context.strokeStyle = 'rgba(255,255,255,0.05)'
      context.lineWidth = 1
      for (let c = 0; c <= snap.cols; c++) {
        context.beginPath()
        context.moveTo(c * cell + 0.5, 0)
        context.lineTo(c * cell + 0.5, height)
        context.stroke()
      }
      for (let r = 0; r <= snap.rows; r++) {
        context.beginPath()
        context.moveTo(0, r * cell + 0.5)
        context.lineTo(width, r * cell + 0.5)
        context.stroke()
      }
    }
    context.strokeStyle = 'rgba(255,255,255,0.1)'
    context.lineWidth = 2
    context.strokeRect(1, 1, width - 2, height - 2)
    if (flash > 0) {
      context.fillStyle = `rgba(255,255,255,${0.3 * flash})`
      context.fillRect(0, 0, width, height)
    }
  }, [snap, settings.showGhost, settings.showGrid, settings.bgImage, flash, bgReady])

  // Mini previews (next + hold).
  useEffect(() => {
    const drawMini = (canvas: HTMLCanvasElement | null, piece: TetrisSnapshot['current'] | TetrisSnapshot['queue'][number] | null | undefined): void => {
      const context = canvas?.getContext('2d')
      if (canvas === null || context === null || context === undefined) return
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (piece == null || piece == undefined) return
      const matrix = rotationsOf(piece.name, snap.pieceSet)[piece.rotation] ?? [[1]]
      let minR = matrix.length
      let maxR = -1
      let minC = matrix[0]?.length ?? 0
      let maxC = -1
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < (matrix[r]?.length ?? 0); c++) {
          if (matrix[r]?.[c]) {
            minR = Math.min(minR, r)
            maxR = Math.max(maxR, r)
            minC = Math.min(minC, c)
            maxC = Math.max(maxC, c)
          }
        }
      }
      if (maxR < 0) return
      const cell = 14
      const subW = maxC - minC + 1
      const subH = maxR - minR + 1
      const ox = (canvas.width - subW * cell) / 2
      const oy = (canvas.height - subH * cell) / 2
      const color = colorOf(piece.name, snap.pieceSet)
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          if (matrix[r]?.[c]) {
            context.fillStyle = color
            context.fillRect(ox + (c - minC) * cell + 1, oy + (r - minR) * cell + 1, cell - 2, cell - 2)
            context.strokeStyle = shade(color, 1.4)
            context.strokeRect(ox + (c - minC) * cell + 1.5, oy + (r - minR) * cell + 1.5, cell - 3, cell - 3)
          }
        }
      }
    }
    drawMini(nextRef.current, snap.queue[0])
    drawMini(holdRef.current, snap.hold)
  }, [snap])

  const openSettings = (): void => {
    setDraft({
      bgImage: settings.bgImage,
      bgm: settings.bgm,
      volume: 0.5,
      dim: 0.45,
      speedMs: settings.speedMs,
      cols: settings.cols,
      rows: settings.rows,
      pieceSet: settings.pieceSet,
      showGrid: settings.showGrid,
      showGhost: settings.showGhost,
      musicEnabled: true,
    })
    setSettingsOpen(true)
  }

  const applySettings = (): void => {
    if (draft === null) return
    actions.setTetrisSettings({
      cols: Math.max(6, Math.min(30, draft.cols)),
      rows: Math.max(8, Math.min(40, draft.rows)),
      speedMs: draft.speedMs,
      lockDelayMs: 500,
      pieceSet: draft.pieceSet,
      showGrid: draft.showGrid,
      showGhost: draft.showGhost,
      bgm: draft.bgm,
      bgImage: draft.bgImage,
    })
    setSettingsOpen(false)
    setSnap(startTetris({
      ...snapRef.current,
      cols: Math.max(6, Math.min(30, draft.cols)),
      rows: Math.max(8, Math.min(40, draft.rows)),
      baseSpeedMs: draft.speedMs,
      pieceSet: draft.pieceSet,
    }, undefined))
  }

  return (
    <div className={css.root}>
      <div className={css.gameArea}>
        <canvas ref={canvasRef} className={css.canvas} aria-label="俄罗斯方块" />
        {(!snap.started || snap.gameOver || snap.paused) && (
          <div className={css.stageOverlay}>
            <div className={css.stageTitle}>
              {snap.gameOver ? t('tetris.gameOver') : snap.paused ? t('game.pause') : 'TETRIS'}
            </div>
            <div className={css.stageSub}>
              {snap.gameOver
                ? `${t('tetris.score')} ${snap.score} · R ${t('game.restart')} · Q ${t('game.back')}`
                : snap.paused
                  ? t('tetris.hint3')
                  : t('tetris.start')}
            </div>
            {!snap.started || snap.gameOver
              ? <button type="button" className={css.stageButton} onClick={() => { setSnap(startTetris({ ...snapRef.current }, undefined)) }}>{t('tetris.startButton')}</button>
              : null}
          </div>
        )}
      </div>

      <aside className={css.panel}>
        <div className={css.brand}>
          <span className={css.logo}>TETRIS</span>
          <span className={css.sub}>DSH</span>
        </div>
        <div className={css.box}>
          <div className={css.label}>{t('tetris.next')}</div>
          <canvas ref={nextRef} width={120} height={84} />
        </div>
        <div className={css.box}>
          <div className={css.label}>{t('tetris.hold')}</div>
          <canvas ref={holdRef} width={120} height={84} />
        </div>
        <div className={css.stats}>
          <div className={css.row}><span>{t('tetris.score')}</span><b>{snap.score}</b></div>
          <div className={css.row}><span>{t('tetris.lines')}</span><b>{snap.lines}</b></div>
          <div className={css.row}><span>{t('tetris.level')}</span><b>{snap.level}</b></div>
          <div className={css.row}><span>{t('tetris.speed')}</span><b>{fallSpeed(snap)}</b></div>
          <div className={css.row}><span>{t('hub.time.left')}</span><b>{props.timeLeft}</b></div>
        </div>
        <div className={css.hints}>
          <div>{t('tetris.hint1')}</div>
          <div>{t('tetris.hint2')}</div>
          <div>{t('tetris.hint3')}</div>
          <div>{t('tetris.hint4')}</div>
        </div>
        <div className={css.actions}>
          <button type="button" onClick={openSettings}>{t('tetris.settings')}</button>
          <button type="button" onClick={() => { setSnap(startTetris({ ...snapRef.current }, undefined)) }}>{t('tetris.startButton')}</button>
        </div>
        <button type="button" className={css.musicButton} onClick={() => { bgm.toggle() }}>
          {bgm.muted ? t('game.musicOff') : t('game.musicOn')}
        </button>
      </aside>

      {settingsOpen && draft !== null && (
        <div className={css.modalOverlay}>
          <div className={css.modal}>
            <h2>{t('tetris.settings.title')}</h2>
            <div className={css.field}>
              <label>{t('tetris.settings.bgImage')}</label>
              <div className={css.fileRow}>
                <span className={css.filename}>{draft.bgImage != null ? t('settings.chosen') : t('settings.default')}</span>
                <button type="button" onClick={() => { document.getElementById('tetris-bg-input')?.click() }}>{t('settings.pick')}</button>
                <button type="button" onClick={() => { setDraft({ ...draft, bgImage: null }) }}>{t('settings.clear')}</button>
              </div>
              <input id="tetris-bg-input" type="file" accept="image/*" hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  void readDataUrl(file).then(url => { if (url !== null) setDraft(prev => (prev === null ? prev : { ...prev, bgImage: url })) })
                  event.target.value = ''
                }} />
            </div>
            <div className={css.field}>
              <label>{t('tetris.settings.bgm')}</label>
              <div className={css.fileRow}>
                <span className={css.filename}>{draft.bgm != null ? t('settings.chosen') : t('settings.none')}</span>
                <button type="button" onClick={() => { document.getElementById('tetris-music-input')?.click() }}>{t('settings.pick')}</button>
                <button type="button" onClick={() => { setDraft({ ...draft, bgm: null }) }}>{t('settings.clear')}</button>
              </div>
              <input id="tetris-music-input" type="file" accept="audio/*" hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  void readDataUrl(file).then(url => { if (url !== null) setDraft(prev => (prev === null ? prev : { ...prev, bgm: url })) })
                  event.target.value = ''
                }} />
              <label className={css.slider}>{t('tetris.settings.volume')}
                <input type="range" min={0} max={1} step={0.01} value={draft.volume}
                  onChange={event => { setDraft({ ...draft, volume: Number(event.target.value) }) }} />
              </label>
              <label className={css.slider}>{t('tetris.settings.dim')}
                <input type="range" min={0} max={0.9} step={0.05} value={draft.dim}
                  onChange={event => { setDraft({ ...draft, dim: Number(event.target.value) }) }} />
              </label>
              <label className={css.toggle}>
                <input type="checkbox" checked={draft.musicEnabled}
                  onChange={event => { setDraft({ ...draft, musicEnabled: event.target.checked }) }} />
                {t('tetris.settings.musicEnabled')}
              </label>
            </div>
            <div className={css.field}>
              <label>{t('tetris.settings.fallSpeed')}</label>
              <input type="range" min={80} max={1600} step={20} value={draft.speedMs}
                onChange={event => { setDraft({ ...draft, speedMs: Number(event.target.value) }) }} />
              <span className={css.rangeValue}>{draft.speedMs} ms</span>
            </div>
            <div className={css.field + ' ' + css.grid2}>
              <div>
                <label>{t('tetris.settings.cols')}</label>
                <input type="number" min={6} max={30} value={draft.cols}
                  onChange={event => { setDraft({ ...draft, cols: Number(event.target.value) || 10 }) }} />
              </div>
              <div>
                <label>{t('tetris.settings.rows')}</label>
                <input type="number" min={8} max={40} value={draft.rows}
                  onChange={event => { setDraft({ ...draft, rows: Number(event.target.value) || 10 }) }} />
              </div>
            </div>
            <div className={css.field}>
              <label>{t('tetris.settings.pieceSet')}</label>
              <div className={css.pieceToggle}>
                {(Object.keys(PIECE_SETS) as PieceSetId[]).map(set => (
                  <button key={set} type="button" data-active={draft.pieceSet === set || undefined}
                    onClick={() => { setDraft({ ...draft, pieceSet: set }) }}>
                    {set === 'classic' ? t('tetris.settings.pieceSet.classic')
                      : set === 'extended' ? t('tetris.settings.pieceSet.extended')
                        : t('tetris.settings.pieceSet.single')}
                  </button>
                ))}
              </div>
            </div>
            <div className={css.field + ' ' + css.checkbox}>
              <label>
                <input type="checkbox" checked={draft.showGrid}
                  onChange={event => { setDraft({ ...draft, showGrid: event.target.checked }) }} />
                {t('tetris.settings.grid')}
              </label>
              <label>
                <input type="checkbox" checked={draft.showGhost}
                  onChange={event => { setDraft({ ...draft, showGhost: event.target.checked }) }} />
                {t('tetris.settings.ghost')}
              </label>
            </div>
            <div className={css.modalActions}>
              <button type="button" onClick={applySettings}>{t('tetris.settings.apply')}</button>
              <button type="button" onClick={() => { setSettingsOpen(false) }}>{t('tetris.settings.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
