/**
 * 技能五子棋 surface: board rendering, color pick, skill panel with targeting,
 * and the AI-turn driver. All rules live in the engine (engine.ts); this
 * component only feeds user intent in and renders snapshots out.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { GameProps } from '../shared.ts'
import { useBgm } from '../../audio.ts'
import { sanitizeDataUrl } from '../../security.ts'
import {
  aiTurnReport, applySkill, autoRandomTurn, canUseSkill, candidateLines, chooseColor,
  freshGomoku, lineCells, lineLabel, placeMove, roleColor,
  type GomokuSnapshot, type LineTarget, type SkillId, type SkillTarget,
} from './engine.ts'
import { SKILL_DESC_KEYS, SKILL_LABEL_KEYS } from './skills.ts'
import css from './GomokuGame.module.css'

const SKILL_IDS: readonly SkillId[] = ['dianxue', 'daofan', 'gaitou', 'leiting', 'heyiwei', 'touxi']

/** Skills needing a target cell (a clicked opponent stone). */
const CELL_TARGET_SKILLS: readonly SkillId[] = ['gaitou', 'touxi']

interface SkillNote { skill: SkillId; by: 'user' | 'ai' }

export function GomokuGame(props: GameProps) {
  const { useStore, actions, t } = props
  const settings = useStore(s => s.settings.gomoku)
  const saved = useStore(s => s.progress.gomoku)
  const [snap, setSnap] = useState<GomokuSnapshot>(() => saved ?? freshGomoku(settings))
  const snapRef = useRef(snap)
  snapRef.current = snap
  /** Skill chosen but still needing a target (cell or line). */
  const [pendingSkill, setPendingSkill] = useState<SkillId | null>(null)
  const [skillNote, setSkillNote] = useState<SkillNote | null>(null)

  const playing = snap.status === 'playing'
  const userTurn = playing && snap.turn === 'user' && !snap.autoRandom
  const bgm = useBgm(settings.bgm, playing)
  // Sanitized background: only self-contained base64 image data URLs reach CSS.
  const bgImage = sanitizeDataUrl(settings.bgImage, 'image')

  // Playtime: counting starts when the game view opens and stops only on
  // exit (setup/game-over screens included — 只有退出才停).
  useEffect(() => {
    actions.setSessionActive(true)
    return () => {
      queueMicrotask(() => { actions.setSessionActive(false) })
    }
  }, [actions])

  // Persist progress on every move (moves are rare — no per-frame churn),
  // plus a deferred leave-time save.
  useEffect(() => { actions.saveGomokuProgress(snap) }, [actions, snap])
  useEffect(() => () => {
    const final = snapRef.current
    queueMicrotask(() => { actions.saveGomokuProgress(final) })
  }, [actions])

  // AI / auto-random turn driver.
  useEffect(() => {
    if (!playing) return
    if (snap.autoRandom) {
      const id = window.setTimeout(() => { setSnap(prev => autoRandomTurn(prev)) }, 450)
      return () => { window.clearTimeout(id) }
    }
    if (snap.turn === 'ai') {
      const id = window.setTimeout(() => {
        setSnap(prev => {
          const report = aiTurnReport(prev)
          if (report.skill !== null) setSkillNote({ skill: report.skill, by: 'ai' })
          return report.snap
        })
      }, 550)
      return () => { window.clearTimeout(id) }
    }
  }, [playing, snap.autoRandom, snap.turn, snap.moveCount])

  // ── user actions ────────────────────────────────────────────────────────

  const activateSkill = (skill: SkillId): void => {
    if (!canUseSkill(snapRef.current)) return
    if (skill === 'dianxue' || skill === 'daofan' || skill === 'heyiwei') {
      const next = applySkill(snapRef.current, skill, null)
      setSnap(next)
      setSkillNote({ skill, by: 'user' })
    } else {
      setPendingSkill(skill)
    }
  }

  const applyTargeted = (target: SkillTarget): void => {
    const skill = pendingSkill
    if (skill === null) return
    const next = applySkill(snapRef.current, skill, target)
    setSnap(next)
    setPendingSkill(null)
    setSkillNote({ skill, by: 'user' })
  }

  const clickCell = (r: number, c: number): void => {
    const current = snapRef.current
    if (current.status !== 'playing') return
    if (pendingSkill !== null && CELL_TARGET_SKILLS.includes(pendingSkill)) {
      const opponentColor = roleColor(current, current.turn === 'user' ? 'ai' : 'user')
      if (current.board[r]?.[c] === opponentColor) applyTargeted({ r, c })
      return
    }
    if (current.turn !== 'user' || current.autoRandom) return
    if (current.board[r]?.[c] !== 0) return
    setSnap(placeMove(current, { r, c }))
  }

  const pickLine = (line: LineTarget): void => { applyTargeted(line) }

  const restart = (): void => {
    setSnap(freshGomoku(settings))
    setPendingSkill(null)
    setSkillNote(null)
  }

  const pickColor = (color: 1 | 2): void => {
    const next = chooseColor(snapRef.current, color)
    setSnap(next)
    // If the user chose white, the AI (black) opens — the driver effect handles it.
  }

  const locked = snap.skillLock === 'user'
  const userColor = snap.userColor
  const aiColor = userColor === 1 ? 2 : 1
  const lines = useMemo(() => (pendingSkill === 'leiting' ? candidateLines(snap) : []), [pendingSkill, snap])
  // Star points (天元/星位) on classic square boards: quarter positions + center.
  const starCells = useMemo(() => {
    const n = snap.rows
    if (snap.rows !== snap.cols || n < 13) return []
    const q = Math.floor((n - 1) / 4)
    const mid = Math.floor((n - 1) / 2)
    return [{ r: q, c: q }, { r: q, c: n - 1 - q }, { r: n - 1 - q, c: q }, { r: n - 1 - q, c: n - 1 - q }, { r: mid, c: mid }]
  }, [snap.rows, snap.cols])

  const boardStyle = {
    '--rows': snap.rows,
    '--cols': snap.cols,
    backgroundImage: bgImage != null ? `url(${bgImage})` : undefined,
  } as CSSProperties

  return (
    <div className={css.root}>
      {snap.status === 'setup' && (        <div className={css.pickOverlay}>
          <div className={css.pickCard}>
            <h3>{t('gomoku.pick.title')}</h3>
            <div className={css.pickButtons}>
              <button type="button" className={css.pickBlack} onClick={() => { pickColor(1) }}>
                ● {t('gomoku.pick.black')}
              </button>
              <button type="button" className={css.pickWhite} onClick={() => { pickColor(2) }}>
                ○ {t('gomoku.pick.white')}
              </button>
            </div>
          </div>
        </div>
      )}

      {snap.status === 'over' && (
        <div className={css.overOverlay}>
          <div className={css.overCard}>
            <div className={css.overTitle}>
              {snap.winner === 'user' ? t('gomoku.win.you') : snap.winner === 'ai' ? t('gomoku.win.ai') : t('gomoku.draw')}
            </div>
            <button type="button" onClick={restart}>{t('gomoku.again')}</button>
          </div>
        </div>
      )}

      {pendingSkill === 'leiting' && (
        <div className={css.lineModal}>
          <div className={css.lineCard}>
            <h4>{t('gomoku.target.line')}</h4>
            <div className={css.lineList}>
              {lines.map(line => {
                const count = lineCells(snap, line).filter(cell => snap.board[cell.r]?.[cell.c] !== 0).length
                return (
                  <button key={`${line.kind}:${line.index}`} type="button" onClick={() => { pickLine(line) }}>
                    {lineLabel(line)}（{count} 子）
                  </button>
                )
              })}
            </div>
            <button type="button" className={css.cancelButton} onClick={() => { setPendingSkill(null) }}>
              {t('gomoku.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className={css.layout}>
        <div className={css.boardArea}>
          {pendingSkill !== null && CELL_TARGET_SKILLS.includes(pendingSkill) && (
            <div className={css.targetHint}>{t('gomoku.target.cell')}</div>
          )}
          <div className={css.boardOuter} style={boardStyle}>
            <div className={css.boardFrame}>
              {starCells.map(star => (
                <span
                  key={`star:${star.r}:${star.c}`}
                  className={css.star}
                  style={{
                    left: `calc(${(star.c + 0.5) / snap.cols * 100}%)`,
                    top: `calc(${(star.r + 0.5) / snap.rows * 100}%)`,
                  }}
                />
              ))}
              {snap.board.flatMap((row, r) => row.map((stone, c) => {
                const isWin = snap.winLine?.some(cell => cell.r === r && cell.c === c) ?? false
                const isLast = snap.lastMove?.r === r && snap.lastMove?.c === c
                const clickable = snap.status === 'playing'
                return (
                  <button
                    key={`${r}:${c}`}
                    type="button"
                    className={css.cell}
                    data-win={isWin || undefined}
                    data-last={isLast || undefined}
                    disabled={!clickable}
                    onClick={() => { clickCell(r, c) }}
                  >
                    {stone !== 0 && (
                      <span className={css.stone} data-color={stone === 1 ? 'black' : 'white'} />
                    )}
                  </button>
                )
              }))}
            </div>
          </div>
        </div>

        <div className={css.sidebar}>
          <div className={css.statusCard}>
            {snap.status === 'playing' && (
              <div className={css.statusLine}>
                {snap.autoRandom
                  ? <span className={css.autoText}>{t('gomoku.turn.auto')}</span>
                  : userTurn
                    ? <span className={css.yourTurn}>{snap.extraMove ? t('gomoku.extra') : t('gomoku.turn.you')}</span>
                    : <span className={css.aiTurn}>{t('gomoku.turn.ai')}</span>}
              </div>
            )}
            <div className={css.roles}>
              <span className={css.role}>
                <span className={css.roleDot} data-color={userColor === 1 ? 'black' : 'white'} />
                {t('gomoku.you')}
              </span>
              <span className={css.role}>
                <span className={css.roleDot} data-color={aiColor === 1 ? 'black' : 'white'} />
                {t('gomoku.ai')}（{settings.aiStrength === 'weak' ? t('settings.strength.weak')
                  : settings.aiStrength === 'medium' ? t('settings.strength.medium') : t('settings.strength.strong')}）
              </span>
            </div>
            <div className={css.timeLine}>{t('hub.time.left')}：{props.timeLeft}</div>
            <div className={css.ruleLine}>{t('gomoku.rule')}</div>
            <div className={css.personaLine}>{t('gomoku.ai.persona')}</div>
            {skillNote !== null && (
              <div className={css.skillNote}>
                {skillNote.by === 'user'
                  ? t('gomoku.you.skill.used', { skill: t(SKILL_LABEL_KEYS[skillNote.skill]) })
                  : t('gomoku.ai.skill.used', { skill: t(SKILL_LABEL_KEYS[skillNote.skill]) })}
              </div>
            )}
          </div>

          <div className={css.skillPanel}>
            <div className={css.skillHeader}>
              {t('gomoku.skills')}
              <span className={css.skillLeft}>
                {t('gomoku.skills.left', { n: snap.skillUsesLeft.user })}
              </span>
            </div>
            {locked && snap.status === 'playing' && (
              <div className={css.lockedHint}>{t('gomoku.skills.locked')}</div>
            )}
            <div className={css.skillList}>
              {SKILL_IDS.map(skill => {
                const usable = userTurn && canUseSkill(snap) && snap.skillUsesLeft.user > 0
                return (
                  <button
                    key={skill}
                    type="button"
                    className={css.skillButton}
                    data-active={pendingSkill === skill || undefined}
                    disabled={!usable || pendingSkill !== null}
                    onClick={() => { activateSkill(skill) }}
                  >
                    <span className={css.skillName}>{t(SKILL_LABEL_KEYS[skill])}</span>
                    <span className={css.skillDesc}>{t(SKILL_DESC_KEYS[skill])}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className={css.sideButtons}>
            <button type="button" className={css.miniButton} onClick={() => { bgm.toggle() }}>
              {bgm.muted ? t('game.musicOff') : t('game.musicOn')}
            </button>
            <button type="button" className={css.miniButton} onClick={restart}>{t('game.restart')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
