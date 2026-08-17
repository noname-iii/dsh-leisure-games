/**
 * Leisure games plugin, browser half: registers the sidebar button
 * (`sidebar.action`, declared by ui-sidebar between New Session and the
 * workspace browser) and the full-screen panel (`shell.overlay`, declared by
 * ui-layout). Both entries share one persisted hub store — settings, playtime
 * accounting, and all game progress survive exiting, closing, and reloading.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-layout's SlotMap merge (the 'shell.overlay' entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.action' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { leisureHub } from './hub-store.ts'
import { LeisureSidebarButton } from './SidebarButton.tsx'
import { GameHub } from './GameHub.tsx'
import { en, zh, type LeisureKey } from './locales.ts'

export { leisureHub, DEFAULT_STATE, LIMIT_RESET_COOLDOWN_MS, clampInt } from './hub-store.ts'
export type {
  LeisureState, LeisureActions, HubTab, HubView, SnakeSettings, GomokuSettings, TetrisSettings,
  MinesweeperSettings, GameProgress,
} from './hub-store.ts'
export type { LeisureKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The leisure-games panel copy. */
    leisure: LeisureKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'leisure'

/** Required services: slots (registration), locale (copy), sessions (agent notifications). */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Client plugin body: dictionaries, the sidebar button, and the overlay panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-leisure-games: dictionaries')

  ctx.slots.inject('sidebar.action', () => ctx.slots.register({
    name: 'sidebar.action',
    id: 'leisure-games',
    locale: NS,
    store: leisureHub,
  }, LeisureSidebarButton))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'leisure-games',
    locale: NS,
    store: leisureHub,
    inject: () => ({ sessions: ctx.sessions }),
  }, GameHub))
}
