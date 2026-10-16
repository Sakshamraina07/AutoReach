import { gmailSendBlocker, type GmailConnectionStatus } from '@autoreach/shared';
import { api } from './api';

/** Why nothing can be sent right now, with the dashboard's link text. Checked again on the server before sending. */
export function gmailProblem(g: GmailConnectionStatus | undefined): { message: string; action: string | null } | null {
  const b = gmailSendBlocker(g);
  if (!b) return null;
  return { message: b.action === 'connect' ? `${b.message} Your draft is saved when you leave.` : b.message, action: b.action === 'connect' ? 'Connect Gmail' : b.action === 'reconnect' ? 'Reconnect Gmail' : null };
}

/** Sends the browser to Google's consent screen; Google returns to /gmail/callback via the API. */
export async function startGmailConnect(returnTo: 'dashboard' | 'onboarding' = 'dashboard'): Promise<void> {
  const { url } = await api<{ url: string }>('/api/integrations/gmail/authorize', { method: 'POST', body: { return_to: returnTo } });
  window.location.assign(url);
}
