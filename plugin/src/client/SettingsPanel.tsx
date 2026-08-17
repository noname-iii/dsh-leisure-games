/**
 * Settings panel: playtime limit switch + minutes, snake tunables (map size,
 * speed, food/obstacle counts, initial length, BGM and background uploads),
 * gomoku tunables (board size, AI strength, BGM and background uploads), and
 * the panel exit. All values persist through the shared hub store.
 */
import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { LeisureState } from './hub-store.ts'
import type { LeisureActions } from './hub-store.ts'
import { DEFAULT_ACCENT, DEFAULT_ENTRY_TEXT, clampInt } from './hub-store.ts'
import css from './SettingsPanel.module.css'

/** Read a local file as a data URL; null when nothing usable was picked. */
function readDataUrl(file: File | undefined, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (file === undefined || file.size === 0) {
      resolve(null)
      return
    }
    if (file.size > maxBytes) {
      resolve(null)
      return
    }
    const reader = new FileReader()
    reader.onload = () => { resolve(typeof reader.result === 'string' ? reader.result : null) }
    reader.onerror = () => { resolve(null) }
    reader.readAsDataURL(file)
  })
}

/** Upload row: label, current state, pick + clear. */
function UploadRow(props: {
  label: string
  state: string | null
  accept: string
  onPick: (dataUrl: string | null) => void
  onClear: () => void
  t: TranslateNS<'leisure'>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    void readDataUrl(file, 4 * 1024 * 1024).then(dataUrl => { if (dataUrl !== null) props.onPick(dataUrl) })
    event.target.value = ''
  }
  const picked = props.state != null && props.state !== ''
  return (
    <div className={css.uploadRow}>
      <div className={css.uploadLabel}>
        <span>{props.label}</span>
        <span className={css.uploadState}>{picked ? props.t('settings.chosen') : props.t('settings.none')}</span>
      </div>
      <div className={css.uploadButtons}>
        <button type="button" onClick={() => { inputRef.current?.click() }}>{props.t('settings.pick')}</button>
        {picked && <button type="button" onClick={props.onClear}>{props.t('settings.clear')}</button>}
      </div>
      <input ref={inputRef} type="file" accept={props.accept} hidden onChange={onChange} />
    </div>
  )
}

/** A numeric input row with clamping. */
function NumberRow(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className={css.numberRow}>
      <span className={css.numberLabel}>{props.label}</span>
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={Number.isFinite(props.value) ? props.value : props.min}
        onChange={(event) => {
          const parsed = Number(event.target.value)
          if (Number.isFinite(parsed)) props.onChange(clampInt(parsed, props.min, props.max))
        }}
      />
    </label>
  )
}

export function SettingsPanel(props: {
  useStore: SnapshotSelectorHook<LeisureState>
  actions: LeisureActions
  t: TranslateNS<'leisure'>
  onExit: () => void
}) {
  const { useStore, actions, t, onExit } = props
  const limitEnabled = useStore(s => s.limitEnabled)
  const limitMinutes = useStore(s => s.limitMinutes)
  const snake = useStore(s => s.settings.snake)
  const gomoku = useStore(s => s.settings.gomoku)
  const minesweeper = useStore(s => s.settings.minesweeper)
  const accent = useStore(s => s.settings.appearance.accent)
  const entryText = useStore(s => s.settings.appearance.entryText)
  const [saved, setSaved] = useState(false)

  const save = (): void => {
    setSaved(true)
    window.setTimeout(() => { setSaved(false) }, 1600)
  }

  return (
    <div className={css.root}>
      <div className={css.header}>
        <h2 className={css.title}>{t('settings.title')}</h2>
        <button type="button" className={css.exitButton} onClick={onExit}>{t('hub.close')}</button>
      </div>

      <div className={css.sections}>
        <section className={css.section}>
          <h3>{t('settings.timeLimit')}</h3>
          <div className={css.toggleRow}>
            <button
              type="button"
              className={css.toggle}
              data-on={limitEnabled || undefined}
              onClick={() => { actions.setLimitEnabled(!limitEnabled); save() }}
            >
              {limitEnabled ? t('settings.timeLimit.on') : t('settings.timeLimit.off')}
            </button>
            {limitEnabled && (
              <NumberRow
                label={t('settings.minutes')}
                value={limitMinutes}
                min={1}
                max={600}
                onChange={(value) => { actions.setLimitMinutes(value); save() }}
              />
            )}
          </div>
          <p className={css.hint}>{t('settings.timeLimit.hint')}</p>
        </section>

        <section className={css.section}>
          <h3>{t('settings.appearance.section')}</h3>
          <label className={css.colorRow}>
            <input
              type="color"
              value={accent}
              onChange={(event) => { actions.setAccent(event.target.value); save() }}
            />
            <span className={css.colorLabel}>{t('settings.appearance.accent')}</span>
            <span className={css.colorValue}>{accent}</span>
            <button
              type="button"
              className={css.colorReset}
              onClick={() => { actions.setAccent(DEFAULT_ACCENT); save() }}
            >
              {t('settings.appearance.reset')}
            </button>
          </label>
          <label className={css.colorRow}>
            <input
              type="color"
              value={entryText}
              onChange={(event) => { actions.setEntryText(event.target.value); save() }}
            />
            <span className={css.colorLabel}>{t('settings.appearance.entryText')}</span>
            <span className={css.colorValue}>{entryText}</span>
            <button
              type="button"
              className={css.colorReset}
              onClick={() => { actions.setEntryText(DEFAULT_ENTRY_TEXT); save() }}
            >
              {t('settings.appearance.reset')}
            </button>
          </label>
        </section>

        <section className={css.section}>
          <h3>{t('settings.snake.section')}</h3>
          <div className={css.grid}>
            <NumberRow label={t('settings.snake.rows')} value={snake.rows} min={8} max={60}
              onChange={value => { actions.setSnakeSettings({ rows: value }); save() }} />
            <NumberRow label={t('settings.snake.cols')} value={snake.cols} min={8} max={60}
              onChange={value => { actions.setSnakeSettings({ cols: value }); save() }} />
            <NumberRow label={t('settings.snake.speed')} value={snake.speedMs} min={60} max={1200} step={10}
              onChange={value => { actions.setSnakeSettings({ speedMs: value }); save() }} />
            <NumberRow label={t('settings.snake.food')} value={snake.foodCount} min={0} max={20}
              onChange={value => { actions.setSnakeSettings({ foodCount: value }); save() }} />
            <NumberRow label={t('settings.snake.obstacle')} value={snake.obstacleCount} min={0} max={30}
              onChange={value => { actions.setSnakeSettings({ obstacleCount: value }); save() }} />
            <NumberRow label={t('settings.snake.length')} value={snake.initialLength} min={2} max={20}
              onChange={value => { actions.setSnakeSettings({ initialLength: value }); save() }} />
          </div>
          <UploadRow
            label={t('settings.bgm')}
            state={snake.bgm}
            accept="audio/*"
            onPick={dataUrl => { actions.setSnakeSettings({ bgm: dataUrl }); save() }}
            onClear={() => { actions.setSnakeSettings({ bgm: null }); save() }}
            t={t}
          />
          <UploadRow
            label={t('settings.bgImage')}
            state={snake.bgImage}
            accept="image/*"
            onPick={dataUrl => { actions.setSnakeSettings({ bgImage: dataUrl }); save() }}
            onClear={() => { actions.setSnakeSettings({ bgImage: null }); save() }}
            t={t}
          />
        </section>

        <section className={css.section}>
          <h3>{t('settings.gomoku.section')}</h3>
          <div className={css.grid}>
            <NumberRow label={t('settings.gomoku.rows')} value={gomoku.rows} min={9} max={25}
              onChange={value => { actions.setGomokuSettings({ rows: value }); save() }} />
            <NumberRow label={t('settings.gomoku.cols')} value={gomoku.cols} min={9} max={25}
              onChange={value => { actions.setGomokuSettings({ cols: value }); save() }} />
          </div>
          <div className={css.strengthRow}>
            <span className={css.numberLabel}>{t('settings.gomoku.strength')}</span>
            <div className={css.strengthButtons}>
              {(['weak', 'medium', 'strong'] as const).map(strength => (
                <button
                  key={strength}
                  type="button"
                  data-active={gomoku.aiStrength === strength || undefined}
                  onClick={() => { actions.setGomokuSettings({ aiStrength: strength }); save() }}
                >
                  {strength === 'weak' ? t('settings.strength.weak')
                    : strength === 'medium' ? t('settings.strength.medium')
                      : t('settings.strength.strong')}
                </button>
              ))}
            </div>
          </div>
          <UploadRow
            label={t('settings.bgm')}
            state={gomoku.bgm}
            accept="audio/*"
            onPick={dataUrl => { actions.setGomokuSettings({ bgm: dataUrl }); save() }}
            onClear={() => { actions.setGomokuSettings({ bgm: null }); save() }}
            t={t}
          />
          <UploadRow
            label={t('settings.bgImage')}
            state={gomoku.bgImage}
            accept="image/*"
            onPick={dataUrl => { actions.setGomokuSettings({ bgImage: dataUrl }); save() }}
            onClear={() => { actions.setGomokuSettings({ bgImage: null }); save() }}
            t={t}
          />
        </section>

        <section className={css.section}>
          <h3>{t('settings.minesweeper.section')}</h3>
          <div className={css.grid}>
            <NumberRow label={t('settings.minesweeper.rows')} value={minesweeper.rows} min={5} max={40}
              onChange={value => { actions.setMinesweeperSettings({ rows: value }); save() }} />
            <NumberRow label={t('settings.minesweeper.cols')} value={minesweeper.cols} min={5} max={60}
              onChange={value => { actions.setMinesweeperSettings({ cols: value }); save() }} />
            <NumberRow label={t('settings.minesweeper.mines')} value={minesweeper.mines} min={1} max={500}
              onChange={value => { actions.setMinesweeperSettings({ mines: value }); save() }} />
          </div>
          <UploadRow
            label={t('settings.bgm')}
            state={minesweeper.bgm}
            accept="audio/*"
            onPick={dataUrl => { actions.setMinesweeperSettings({ bgm: dataUrl }); save() }}
            onClear={() => { actions.setMinesweeperSettings({ bgm: null }); save() }}
            t={t}
          />
          <UploadRow
            label={t('settings.bgImage')}
            state={minesweeper.bgImage}
            accept="image/*"
            onPick={dataUrl => { actions.setMinesweeperSettings({ bgImage: dataUrl }); save() }}
            onClear={() => { actions.setMinesweeperSettings({ bgImage: null }); save() }}
            t={t}
          />
        </section>

        {saved && <div className={css.saved}>{t('settings.save')} ✓</div>}

        <section className={css.section}>
          <button type="button" className={css.exitButtonBig} onClick={onExit}>{t('hub.close')}</button>
        </section>
      </div>
    </div>
  )
}
