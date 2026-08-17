/**
 * 经典扫雷 surface: square-cell grid over the pure engine. Left click
 * reveals, right click flags (classic rules: first reveal is safe, zeros
 * flood, wrong mine = loss, all non-mine cells revealed = win). Progress
 * persists on exit; the playtime clock runs while the view is open.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameProps } from '../shared.ts'
import { useBgm } from '../../audio.ts'
import { DEFAULT_STATE } from '../../hub-store.ts'
import { sanitizeDataUrl } from '../../security.ts'
import {
  adjacentMines, chordCell, flagCell, freshMinesweeper, revealCell,
  type MinesweeperSnapshot,
} from './engine.ts'
import css from './MinesweeperGame.module.css'

const NUMBER_COLORS = ['', '#4a78ff', '#3f9e5a', '#e2544a', '#7a4ad6', '#9c6a2e', '#2a9c94', '#20242c', '#7a8290']

export function MinesweeperGame(props: GameProps) {
  const { useStore, actions, t } = props
  // Defensive fallback: a pre-minesweeper persisted state (before the
  // migration runs) must never crash the game open.
  const settings = useStore(s => s.settings.minesweeper ?? DEFAULT_STATE.settings.minesweeper)
  const saved = useStore(s => s.progress.minesweeper)
  const [snap, setSnap] = useState<MinesweeperSnapshot>(() => saved ?? freshMinesweeper(settings))
  const snapRef = useRef(snap)
  snapRef.current = snap
  const bgm = useBgm(settings.bgm, snap.status === 'playing')
  // Sanitized background: only self-contained base64 image data URLs reach CSS.
  const bgImage = sanitizeDataUrl(settings.bgImage, 'image')

  // Playtime: counting starts when the game view opens and stops only on exit.
  useEffect(() => {
    actions.setSessionActive(true)
    return () => {
      queueMicrotask(() => { actions.setSessionActive(false) })
    }
  }, [actions])

  // Persist every move (clicks are rare) plus a deferred leave-time save.
  useEffect(() => { actions.saveMinesweeperProgress(snap) }, [actions, snap])
  useEffect(() => () => {
    const final = snapRef.current
    queueMicrotask(() => { actions.saveMinesweeperProgress(final) })
  }, [actions])

  const reveal = (r: number, c: number): void => { setSnap(prev => revealCell(prev, { r, c })) }
  const flag = (r: number, c: number): void => { setSnap(prev => flagCell(prev, { r, c })) }
  const chord = (r: number, c: number): void => { setSnap(prev => chordCell(prev, { r, c })) }
  const restart = (): void => { setSnap(freshMinesweeper(settings)) }

  const flagCount = snap.board.flat().filter(cell => cell.flagged).length
  const remaining = Math.max(0, snap.mines - flagCount)
  const unrevealedMines = snap.status === 'lost'
    ? snap.board.flat().filter(cell => cell.mine && !cell.revealed).length
    : 0

  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.counter} data-kind="mines">
          <span className={css.counterIcon}>💣</span>
          <b>{remaining}</b>
        </div>
        <div className={css.status} data-status={snap.status}>
          {snap.status === 'won' ? t('minesweeper.won')
            : snap.status === 'lost' ? t('minesweeper.lost')
              : t('minesweeper.playing')}
        </div>
        <div className={css.counter} data-kind="flags">
          <span className={css.counterIcon}>⚑</span>
          <b>{flagCount}</b>
        </div>
        <div className={css.headerButtons}>
          <button type="button" className={css.miniButton} onClick={restart}>{t('game.restart')}</button>
          <button type="button" className={css.miniButton} onClick={() => { bgm.toggle() }}>
            {bgm.muted ? t('game.musicOff') : t('game.musicOn')}
          </button>
        </div>
      </div>

      <div className={css.boardArea}>
        <div
          className={css.board}
          style={{
            '--rows': snap.rows,
            '--cols': snap.cols,
            backgroundImage: bgImage != null
              ? `linear-gradient(rgba(13,16,28,0.78), rgba(13,16,28,0.78)), url(${bgImage})`
              : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } as React.CSSProperties}
        >
          {snap.board.flatMap((row, r) => row.map((cell, c) => {
            const number = cell.revealed && !cell.mine ? adjacentMines(snap, r, c) : 0
            const color = NUMBER_COLORS[number] ?? '#20242c'
            return (
              <button
                key={`${r}:${c}`}
                type="button"
                className={css.cell}
                data-revealed={cell.revealed || undefined}
                data-flagged={cell.flagged || undefined}
                data-mine={cell.revealed && cell.mine || undefined}
                data-boom={cell.revealed && cell.mine && snap.status === 'lost' || undefined}
                data-number={number > 0 ? number : undefined}
                style={number > 0 ? { color } : undefined}
                disabled={snap.status !== 'playing' || cell.revealed}
                onClick={() => {
                  if (cell.flagged) return
                  reveal(r, c)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (cell.revealed) chord(r, c)
                  else flag(r, c)
                }}
              >
                {cell.revealed && cell.mine ? '💣' : ''}
                {cell.revealed && !cell.mine && number > 0 ? String(number) : ''}
                {!cell.revealed && cell.flagged ? '⚑' : ''}
              </button>
            )
          }))}
        </div>
      </div>

      <div className={css.footer}>
        {t('minesweeper.hint')}
        {snap.status === 'won' && <span className={css.wonText}>{t('minesweeper.won')}</span>}
        {snap.status === 'lost' && (
          <span className={css.lostText}>{t('minesweeper.lostText', { n: unrevealedMines })}</span>
        )}
        <span className={css.timeText}>{t('hub.time.left')}：{props.timeLeft}</span>
      </div>
    </div>
  )
}
