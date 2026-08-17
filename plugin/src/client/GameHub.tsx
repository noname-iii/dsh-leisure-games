/**
 * The full-screen leisure hub panel (registered into `shell.overlay`): top
 * bar with the back/exit controls and the playtime chip, four game tabs on
 * the home view, the settings page, the playtime-limit rest banner, and the
 * agent-notification stack pinned top-left. Owns the 1s playtime ticker and
 * the "click notification → back to the AI Agent" navigation.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime, PropsStore, SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { LeisureState } from './hub-store.ts'
import { LIMIT_RESET_COOLDOWN_MS, leisureHub } from './hub-store.ts'
import { AgentNotifications } from './Notifications.tsx'
import { SettingsPanel } from './SettingsPanel.tsx'
import { SnakeGame } from './games/snake/SnakeGame.tsx'
import { GomokuGame } from './games/gomoku/GomokuGame.tsx'
import { TetrisGame } from './games/tetris/TetrisGame.tsx'
import { MinesweeperGame } from './games/minesweeper/MinesweeperGame.tsx'
import css from './GameHub.module.css'

export type GameHubProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<typeof leisureHub>
  & PropsLocale<'leisure'>
  & { sessions: ISessions }

/** mm:ss formatter. */
export function formatDuration(totalMs: number): string {
  const clamped = Math.max(0, Math.floor(totalMs / 1000))
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function GameHub(props: GameHubProps) {
  const { useStore, actions, t, useSessions, sessions } = props
  const open = useStore(s => s.open)
  const view = useStore(s => s.view)
  const limitEnabled = useStore(s => s.limitEnabled)
  const limitMinutes = useStore(s => s.limitMinutes)
  const playedMs = useStore(s => s.playedMs)
  const sessionStartedAt = useStore(s => s.sessionStartedAt)
  const limitReachedAt = useStore(s => s.limitReachedAt)
  const accent = useStore(s => s.settings.appearance.accent)
  const entryText = useStore(s => s.settings.appearance.entryText)
  const [now, setNow] = useState(() => Date.now())

  // The 1s playtime ticker runs only while the panel is open.
  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => {
      const stamp = Date.now()
      actions.tick(stamp)
      setNow(stamp)
    }, 1000)
    return () => { window.clearInterval(id) }
  }, [open, actions])

  if (!open) return null

  const blocked = limitReachedAt !== null && now - limitReachedAt < LIMIT_RESET_COOLDOWN_MS
  const restLeftMs = limitReachedAt === null ? 0 : Math.max(0, LIMIT_RESET_COOLDOWN_MS - (now - limitReachedAt))
  const limitMs = limitMinutes * 60_000
  const livePlayed = playedMs + (sessionStartedAt === null ? 0 : now - sessionStartedAt)
  const timeLeftMs = limitEnabled ? Math.max(0, limitMs - livePlayed) : Number.POSITIVE_INFINITY
  const timeLeft = limitEnabled && Number.isFinite(timeLeftMs) ? formatDuration(timeLeftMs) : t('hub.time.unlimited')

  const onExit = (): void => {
    // One atomic transition (stop clock + go home) — deferred one microtask so
    // it can never land inside a commit/notify phase.
    queueMicrotask(() => { actions.exitToHome() })
  }

  const navigateToAgent = (sessionId: SessionId): void => {
    actions.close()
    sessions.open(sessionId)
  }

  const gameProps = { useStore, actions, t, onExit, timeLeft }

  return (
    <div className={css.root} style={{ '--leisure-accent': accent, '--leisure-entry-text': entryText } as CSSProperties}>
      <header className={css.topBar}>
        <div className={css.topLeft}>
          {(view === 'tetris' || view === 'snake' || view === 'gomoku' || view === 'minesweeper' || view === 'settings') && (
            <button type="button" className={css.backButton} onClick={onExit}>
              ← {t('game.back')}
            </button>
          )}
          <span className={css.title}>{t('hub.title')}</span>
        </div>
        <div className={css.topRight}>
          {limitEnabled && (
            <span className={css.timeChip} data-low={livePlayed >= limitMs * 0.8 || undefined}>
              {t('hub.time.left')} {timeLeft}
            </span>
          )}
          {!limitEnabled && <span className={css.timeChip}>{t('hub.time.unlimited')}</span>}
          <button type="button" className={css.closeButton} onClick={() => { actions.close() }}>
            {t('hub.close')}
          </button>
        </div>
      </header>

      <div className={css.body}>
        {view === 'home' && (
          <div className={css.home}>
            <h1 className={css.homeTitle}>{t('hub.title')}</h1>
            {blocked && (
              <div className={css.restBanner}>
                <div className={css.restTitle}>{t('hub.rest.blocked')}</div>
                <div className={css.restCountdown}>
                  {t('hub.rest.countdown', {
                    minutes: Math.floor(restLeftMs / 60_000),
                    seconds: Math.floor((restLeftMs % 60_000) / 1000),
                  })}
                </div>
              </div>
            )}
            {!blocked && limitEnabled && (
              <div className={css.playtimeLine}>
                {t('hub.time.used')} {formatDuration(playedMs)} / {formatDuration(limitMs)} · {t('hub.time.left')} {timeLeft}
              </div>
            )}
            <div className={css.tabs}>
              <button type="button" className={css.tab} disabled={blocked} onClick={() => { actions.setView('tetris') }}>
                <span className={css.tabTitle}>{t('hub.tab.tetris')}</span>
                <span className={css.tabDesc}>{t('hub.tab.tetris.desc')}</span>
                <span className={css.tabStart}>{t('hub.start')}</span>
              </button>
              <button type="button" className={css.tab} disabled={blocked} onClick={() => { actions.setView('snake') }}>
                <span className={css.tabTitle}>{t('hub.tab.snake')}</span>
                <span className={css.tabDesc}>{t('hub.tab.snake.desc')}</span>
                <span className={css.tabStart}>{t('hub.start')}</span>
              </button>
              <button type="button" className={css.tab} disabled={blocked} onClick={() => { actions.setView('gomoku') }}>
                <span className={css.tabTitle}>{t('hub.tab.gomoku')}</span>
                <span className={css.tabDesc}>{t('hub.tab.gomoku.desc')}</span>
                <span className={css.tabStart}>{t('hub.start')}</span>
              </button>
              <button type="button" className={css.tab} disabled={blocked} onClick={() => { actions.setView('minesweeper') }}>
                <span className={css.tabTitle}>{t('hub.tab.minesweeper')}</span>
                <span className={css.tabDesc}>{t('hub.tab.minesweeper.desc')}</span>
                <span className={css.tabStart}>{t('hub.start')}</span>
              </button>
            </div>
            <div className={css.homeFooter}>
              <button type="button" className={css.settingsButton} onClick={() => { actions.setView('settings') }}>
                ⚙ {t('hub.settings')}
              </button>
              <button type="button" className={css.exitHomeButton} onClick={() => { actions.close() }}>
                {t('hub.close')}
              </button>
            </div>
          </div>
        )}

        {view === 'settings' && (
          <SettingsPanel
            useStore={useStore as SnapshotSelectorHook<LeisureState>}
            actions={actions}
            t={t as TranslateNS<'leisure'>}
            onExit={() => { actions.close() }}
          />
        )}

        {view === 'tetris' && <TetrisGame {...gameProps} />}
        {view === 'snake' && <SnakeGame {...gameProps} />}
        {view === 'gomoku' && <GomokuGame {...gameProps} />}
        {view === 'minesweeper' && <MinesweeperGame {...gameProps} />}

        <AgentNotifications useSessions={useSessions} sessions={sessions} t={t} onNavigate={navigateToAgent} />
      </div>
    </div>
  )
}
