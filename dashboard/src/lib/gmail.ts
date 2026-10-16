import type { GmailConnectionStatus } from '@autoreach/shared';

/** Why nothing can be sent right now, if Gmail isn't usable. Checked again on the server before sending. */
export function gmailProblem(g: GmailConnectionStatus | undefined): { message: string; action: string | null } | null {
  if (!g) return null;
  if (!g.configured) return { message: "Gmail sending isn't set up on this server yet, so this email can't be sent. Save it as a draft for now.", action: null };
  if (!g.connected) return { message: 'Connect your Gmail account to send. Your draft is saved when you leave.', action: 'Connect Gmail' };
  if (g.status === 'needs_reauth' || g.status === 'revoked') return { message: 'Gmail access expired or was revoked. Reconnect to send.', action: 'Reconnect Gmail' };
  if (!g.can_send) return { message: "AutoReach doesn't have permission to send from your Gmail. Reconnect and allow sending.", action: 'Reconnect Gmail' };
  return null;
}
