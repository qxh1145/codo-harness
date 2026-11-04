/** Sidebar entry and main panel for team chat. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { TeamChatIcon, TeamChatPage } from './TeamChatPage.tsx'

const PANEL_ID = 'team-chat' as MainPanelId

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Register the main panel and its sidebar entry.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, TeamChatPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 5,
    label: () => 'Team chat',
  }, TeamChatIcon))
}
