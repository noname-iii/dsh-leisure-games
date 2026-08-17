/**
 * Shared game-component props: the hub store's selector hook + actions (all
 * three games persist progress through them), the locale translator, the
 * exit-back-to-hub callback, and a formatted remaining-playtime label.
 */
import type { SnapshotSelectorHook, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { LeisureActions, LeisureState } from '../hub-store.ts'

export interface GameProps {
  useStore: SnapshotSelectorHook<LeisureState>
  actions: LeisureActions
  t: TranslateNS<'leisure'>
  /** Leave the game back to the hub home (the hub stops timing and saves). */
  onExit: () => void
  /** Pre-formatted remaining playtime label ("--:--" when unlimited). */
  timeLeft: string
}
