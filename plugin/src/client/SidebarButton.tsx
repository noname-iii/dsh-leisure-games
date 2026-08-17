/**
 * The sidebar entry: a "DSH-Leisure-Games" button between the New Session
 * control and the workspace browser. Wide mode shows the label; the collapsed
 * rail shows the gamepad glyph. Clicking toggles the full-screen hub panel.
 */
import type { CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { leisureHub } from './hub-store.ts'
import css from './SidebarButton.module.css'

export type LeisureSidebarButtonProps =
  PropsRuntime<'sidebar.action'>
  & PropsStore<typeof leisureHub>
  & PropsLocale<'leisure'>

function GamepadGlyph(props: { size?: number }) {
  const size = props.size ?? 16
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 6.2C2 4.7 3.2 3.5 4.7 3.5h6.6C12.8 3.5 14 4.7 14 6.2v1.4c0 .9-.6 1.7-1.5 2l-.3.1c-.5.2-.9.6-1 1.1l-.1.4c-.2.7-.8 1.2-1.5 1.2h-3c-.7 0-1.3-.5-1.5-1.2l-.1-.4c-.1-.5-.5-.9-1-1.1l-.3-.1c-.9-.3-1.5-1.1-1.5-2V6.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="4.6" cy="6.4" r="0.8" fill="currentColor" />
      <circle cx="7.4" cy="6.4" r="0.8" fill="currentColor" />
      <circle cx="5.4" cy="8.6" r="0.8" fill="currentColor" />
      <path d="M9.6 6.9h1.9M10.55 5.95v1.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

export function LeisureSidebarButton(props: LeisureSidebarButtonProps) {
  const { wide, useStore, actions, t } = props
  const open = useStore(s => s.open)
  const accent = useStore(s => s.settings.appearance.accent)
  const entryText = useStore(s => s.settings.appearance.entryText)
  const toggle = (): void => {
    if (open) actions.close()
    else actions.open()
  }
  return (
    <button
      type="button"
      className={css.button}
      style={{ '--leisure-accent': accent, '--leisure-entry-text': entryText } as CSSProperties}
      data-wide={wide || undefined}
      data-open={open || undefined}
      aria-label={t('sidebar.label')}
      title={t('sidebar.label')}
      onClick={toggle}
    >
      <GamepadGlyph size={wide ? 15 : 18} />
      {wide && <span className={css.label}>{t('sidebar.label')}</span>}
    </button>
  )
}
