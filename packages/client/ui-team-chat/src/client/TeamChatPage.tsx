/** Main-panel page showing the team chat served at /team. */
import { IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

const FRAME_STYLE = { border: 0, display: 'block', height: '100%', width: '100%' } as const

/**
 * Embed team chat. It keeps its own sign-in, so the owner uses a team account here too.
 * @returns the full-panel frame.
 */
export function TeamChatPage() {
  return <iframe src="/team" style={FRAME_STYLE} title="Team chat" />
}

/**
 * Render the chat glyph at the size the sidebar asks for.
 * @param props - the sidebar's icon share.
 * @returns decorative chat icon.
 */
export function TeamChatIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconNewChatOutlineRegular size={size} />
}
