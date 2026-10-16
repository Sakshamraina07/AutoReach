/** Build-time settings (see extension/.env.example). Nothing here is secret. */
const trim = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');

export const config = {
  apiUrl: trim(import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3001',
  dashboardUrl: trim(import.meta.env.VITE_DASHBOARD_URL as string | undefined) || 'http://localhost:5173',
  supabaseUrl: trim(import.meta.env.VITE_SUPABASE_URL as string | undefined),
  supabaseAnonKey: ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '').trim(),
  devLogin: import.meta.env.VITE_DEV_LOGIN === 'true',
};

export const supabaseConfigured = !!config.supabaseUrl && !!config.supabaseAnonKey;

export function dashboardLink(path = '/'): string {
  return `${config.dashboardUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Dashboard composer URL for the same starting point (fallback when the side panel can't open). */
export function dashboardComposeLink(p: { recruiterId?: string; draftId?: string; followUpId?: string; opportunityId?: string }): string {
  const q = new URLSearchParams();
  if (p.draftId) q.set('draft', p.draftId);
  else if (p.followUpId) q.set('followup', p.followUpId);
  else {
    if (p.recruiterId) q.set('recruiter', p.recruiterId);
    if (p.opportunityId) q.set('opportunity', p.opportunityId);
  }
  const qs = q.toString();
  return dashboardLink(`/outreach/new${qs ? `?${qs}` : ''}`);
}
