import { canonicalTimezone, OPEN_TRACKING_CAVEAT, TEMPLATE_VARIABLES, type Resume, type Template, type TemplateType, type UserSettings } from '@autoreach/shared';
import { clsx } from 'clsx';
import { CheckCircle2, Download, ExternalLink, FileText, RefreshCw, Star, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cleanProfile, ExtractFromResumeDialog, ProfileEditor, profileToForm, type ProfileForm } from '../components/ProfileEditor';
import { Badge, Button, Confirm, Dialog, ErrorState, Field, PageHeader, SectionTitle, Spinner, TagInput, Toggle, useToast } from '../components/ui';
import { api, download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { browserTimezone, fmtBytes, fmtResumeSize, fmtDate, fmtDateTime, plural } from '../lib/format';
import { startGmailConnect } from '../lib/gmail';
import { useInvalidate, useMe, useResumes, useTemplates } from '../lib/queries';
import { useQueryClient } from '@tanstack/react-query';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'resumes', label: 'Résumés' },
  { id: 'gmail', label: 'Gmail' },
  { id: 'sending', label: 'Sending' },
  { id: 'followups', label: 'Follow-ups' },
  { id: 'tracking', label: 'Open tracking' },
  { id: 'templates', label: 'Templates' },
  { id: 'ai', label: 'AI drafting' },
  { id: 'privacy', label: 'Data and privacy' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('section');
  const section: SectionId = SECTIONS.some((s) => s.id === raw) ? (raw as SectionId) : 'profile';
  const toast = useToast();
  const invalidate = useInvalidate();

  // Returning from Google's consent screen.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || params.get('gmail') !== 'connected') return;
    handled.current = true;
    toast.success('Gmail connected');
    void invalidate();
    const next = new URLSearchParams(params);
    next.delete('gmail');
    setParams(next, { replace: true });
  }, [params, setParams, toast, invalidate]);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:flex-col">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setParams({ section: s.id }, { replace: true })}
              aria-current={section === s.id ? 'page' : undefined}
              className={clsx('whitespace-nowrap rounded px-2.5 py-1.5 text-left text-sm', section === s.id ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink')}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl">
          {section === 'profile' && <ProfileSection />}
          {section === 'resumes' && <ResumesSection />}
          {section === 'gmail' && <GmailSection />}
          {section === 'sending' && <SendingSection />}
          {section === 'followups' && <FollowUpsSection />}
          {section === 'tracking' && <TrackingSection />}
          {section === 'templates' && <TemplatesSection />}
          {section === 'ai' && <AiSection />}
          {section === 'privacy' && <PrivacySection />}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel mb-6">
      <SectionTitle actions={actions}>{title}</SectionTitle>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

/** Edit a subset of settings locally, then save the changed keys in one PATCH. */
function useSettingsForm<K extends keyof UserSettings>(keys: readonly K[]) {
  const me = useMe();
  const invalidate = useInvalidate();
  const toast = useToast();
  // `edits` holds only what the user changed; everything else shows the server value.
  const [edits, setEdits] = useState<Partial<Pick<UserSettings, K>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const server = me.data?.settings;
  const draft = server ? ({ ...(Object.fromEntries(keys.map((k) => [k, server[k]])) as Pick<UserSettings, K>), ...edits } as Pick<UserSettings, K>) : null;

  const dirty = !!(server && draft && keys.some((k) => draft[k] !== server[k]));

  async function save(extra?: Partial<UserSettings>, msg = 'Settings saved') {
    if (!server || !draft) return;
    const body: Partial<UserSettings> = { ...extra };
    for (const k of keys) if (draft[k] !== server[k]) (body as Record<string, unknown>)[k] = draft[k];
    if (!Object.keys(body).length) return;
    setSaving(true);
    setError(null);
    try {
      await api('/api/settings', { method: 'PATCH', body });
      await invalidate(['settings']);
      setEdits({}); // fresh server values now apply
      toast.success(msg);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  const set = <X extends K>(k: X, v: UserSettings[X]) => setEdits((e) => ({ ...e, [k]: v }));
  return { me, draft, set, save, saving, error, dirty, reset: () => setEdits({}) };
}

function SaveBar({ dirty, saving, onSave, onReset, error }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void; error: unknown }) {
  return (
    <div className="mt-4 space-y-3">
      {error ? <ErrorState error={error} /> : null}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!dirty} loading={saving} onClick={onSave}>
          Save changes
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={onReset}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}

function NumberInput({ id, value, onChange, min, max, suffix }: { id: string; value: number; onChange: (n: number) => void; min: number; max: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input id={id} type="number" min={min} max={max} className="field w-24" value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))} />
      {suffix && <span className="text-sm text-muted">{suffix}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

function ProfileSection() {
  const me = useMe();
  const invalidate = useInvalidate();
  const toast = useToast();
  // null = unedited → show the saved profile.
  const [edited, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [extracting, setExtracting] = useState(false);
  const saved = useMemo(() => (me.data ? profileToForm(me.data.profile, me.data.user.email) : null), [me.data]);
  const form = edited ?? saved;

  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data || !form) return <Spinner />;
  const c = me.data.completeness;

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api('/api/profile', { method: 'PUT', body: cleanProfile(form) });
      await invalidate(['profile']);
      setForm(null);
      toast.success('Profile saved');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Panel title="Profile completeness">
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 rounded-full bg-raised" role="progressbar" aria-valuenow={c.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness">
            <div className="h-1.5 rounded-full bg-accent" style={{ width: `${c.percent}%` }} />
          </div>
          <span className="num text-sm">{c.percent}%</span>
        </div>
        <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
          {c.items.map((i) => (
            <li key={i.key} className={i.done ? 'text-muted' : 'text-ink'}>
              <CheckCircle2 className={clsx('mr-1 inline h-3.5 w-3.5', i.done ? 'text-replied' : 'text-faint')} aria-hidden />
              {i.label}
              <span className="sr-only">{i.done ? ' (done)' : ' (missing)'}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title="Your details"
        actions={
          <Button size="sm" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => setExtracting(true)}>
            Fill from résumé
          </Button>
        }
      >
        <p className="mb-5 text-xs text-muted">Drafts use only what's written here and in your jobs. If something isn't in your profile, AutoReach won't claim it.</p>
        <ProfileEditor value={form} onChange={setForm} />
        <SaveBar dirty={edited !== null} saving={saving} onSave={save} onReset={() => setForm(null)} error={error} />
      </Panel>
      {extracting && <ExtractFromResumeDialog current={form} onApply={setForm} onClose={() => setExtracting(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Résumés                                                             */
/* ------------------------------------------------------------------ */

export function ResumeUpload({ onUploaded, compact }: { onUploaded?: (r: Resume) => void; compact?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [makeDefault, setMakeDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidate();
  const toast = useToast();
  const tooBig = !!file && file.size > 10 * 1024 * 1024;
  const notPdf = !!file && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf';

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (label.trim()) form.append('label', label.trim());
      if (tags.length) form.append('role_tags', tags.join(','));
      form.append('make_default', String(makeDefault));
      const r = await api<Resume>('/api/resumes', { method: 'POST', form });
      await invalidate(['resumes']);
      toast.success(`Uploaded “${r.label}”`);
      setFile(null);
      setLabel('');
      setTags([]);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded?.(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="resume-file">
          PDF file, up to 10 MB
        </label>
        <input
          ref={inputRef}
          id="resume-file"
          type="file"
          accept="application/pdf,.pdf"
          className="block w-full text-sm text-muted file:mr-3 file:rounded file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-sm file:text-ink"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {tooBig && <p className="mt-1 text-xs text-danger">This file is {fmtBytes(file!.size)}. Gmail and AutoReach accept résumés up to 10 MB.</p>}
        {notPdf && <p className="mt-1 text-xs text-danger">Only PDF résumés can be attached.</p>}
      </div>
      {!compact && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Label" htmlFor="resume-label" hint="E.g. “Frontend résumé”. Defaults to the file name.">
            <input id="resume-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Best for roles (optional)" htmlFor="resume-tags">
            <TagInput id="resume-tags" value={tags} onChange={setTags} placeholder="frontend, react" />
          </Field>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> Use as my default résumé
      </label>
      {error ? <ErrorState error={error} /> : null}
      <Button variant="primary" icon={<Upload className="h-4 w-4" />} loading={busy} disabled={!file || tooBig || notPdf} onClick={upload}>
        Upload résumé
      </Button>
    </div>
  );
}

async function openResume(id: string) {
  const res = await api<Response>(`/api/resumes/${id}/file`, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ResumesSection() {
  const resumes = useResumes();
  const me = useMe();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [editing, setEditing] = useState<Resume | null>(null);
  const [deleting, setDeleting] = useState<Resume | null>(null);
  const s = useSettingsForm(['require_resume_attachment', 'attachment_filename'] as const);

  async function makeDefault(r: Resume) {
    try {
      await api(`/api/resumes/${r.id}`, { method: 'PATCH', body: { is_default: true } });
      await invalidate(['resumes'], ['settings']);
      toast.success(`“${r.label}” is now your default résumé`);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
      <Panel title="Your résumés">
        {resumes.isError ? (
          <ErrorState error={resumes.error} onRetry={() => resumes.refetch()} />
        ) : !resumes.data ? (
          <Spinner />
        ) : resumes.data.length === 0 ? (
          <p className="text-sm text-muted">No résumé uploaded yet. Upload one below so it can be attached to your emails.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {resumes.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <FileText className="h-4 w-4 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm text-ink">{r.label}</span>
                    {r.is_default && <Badge tone="accent">default</Badge>}
                    {r.legacy && <Badge title="Uploaded with AutoReach v1">v1</Badge>}
                    {!r.has_text && <Badge tone="warning" title="No text could be read from this PDF (it may be a scanned image). It can still be attached.">no readable text</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted">
                    {r.file_name}, {fmtResumeSize(r)}, uploaded {fmtDate(r.created_at)}
                    {r.role_tags.length ? `. Best for ${r.role_tags.join(', ')}` : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => openResume(r.id).catch((e) => toast.error(e))}>
                    View
                  </Button>
                  {!r.is_default && (
                    <Button size="sm" variant="ghost" icon={<Star className="h-3.5 w-3.5" />} onClick={() => makeDefault(r)}>
                      Make default
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${r.label}`} onClick={() => setDeleting(r)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Upload a résumé">
        <ResumeUpload />
      </Panel>
      {s.draft && (
        <Panel title="Attachments">
          <Toggle
            label="Require a résumé on every first email"
            description="When on, an email without a verified résumé attachment is blocked instead of being sent without one."
            checked={s.draft.require_resume_attachment}
            onChange={(v) => s.set('require_resume_attachment', v)}
          />
          <Field label="Attachment file name" htmlFor="att-name" hint={`What the recruiter sees, e.g. “${me.data?.profile?.full_name?.replace(/\s+/g, '_') || 'Your_Name'}_Resume”. Leave empty to use each file's own name. “.pdf” is added for you.`}>
            <input id="att-name" className="field max-w-sm" value={s.draft.attachment_filename ?? ''} onChange={(e) => s.set('attachment_filename', e.target.value || null)} maxLength={100} />
          </Field>
          <SaveBar dirty={s.dirty} saving={s.saving} onSave={() => s.save()} onReset={s.reset} error={s.error} />
        </Panel>
      )}
      {editing && <EditResumeDialog r={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <Confirm
          danger
          title={`Delete “${deleting.label}”?`}
          confirmLabel="Delete résumé"
          body={<p>The file is removed from storage. Emails already sent keep a record of which résumé was attached, but scheduled emails using it will be blocked until you pick another.</p>}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`/api/resumes/${deleting.id}`, { method: 'DELETE' });
            await invalidate(['resumes'], ['settings']);
            toast.success('Résumé deleted');
          }}
        />
      )}
    </>
  );
}

function EditResumeDialog({ r, onClose }: { r: Resume; onClose: () => void }) {
  const [label, setLabel] = useState(r.label);
  const [tags, setTags] = useState(r.role_tags);
  const invalidate = useInvalidate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog
      title="Edit résumé"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!label.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(`/api/resumes/${r.id}`, { method: 'PATCH', body: { label: label.trim(), role_tags: tags } });
                await invalidate(['resumes']);
                toast.success('Résumé updated');
                onClose();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Label" htmlFor="er-label">
          <input id="er-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Best for roles" htmlFor="er-tags">
          <TagInput id="er-tags" value={tags} onChange={setTags} />
        </Field>
        {error ? <ErrorState error={error} /> : null}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Gmail                                                               */
/* ------------------------------------------------------------------ */

function GmailSection() {
  const me = useMe();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const s = useSettingsForm(['reply_scan_new_threads'] as const);
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  const g = me.data?.gmail;
  if (!g) return <Spinner />;

  async function connect() {
    setBusy('connect');
    try {
      await startGmailConnect();
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  }

  async function sync() {
    setBusy('sync');
    try {
      const r = await api<{ status: string; reason?: string; processed: number; replies: number; mode?: string }>('/api/integrations/gmail/sync', { method: 'POST' });
      await invalidate();
      if (r.status === 'ok') toast.success(r.replies ? `Found ${plural(r.replies, 'new reply', 'new replies')}` : `Checked Gmail. ${r.processed ? `${plural(r.processed, 'message')} processed, no new replies.` : 'Nothing new.'}`);
      else toast.info(`Reply check skipped: ${r.reason?.replace(/_/g, ' ').toLowerCase() ?? 'not available'}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Panel title="Gmail connection">
        {!g.configured ? (
          <p className="text-sm text-muted">Gmail sending isn't configured on this server yet. The server administrator needs to add Google OAuth credentials (see docs/GMAIL_OAUTH.md).</p>
        ) : !g.connected ? (
          <div className="space-y-3 text-sm">
            <p>Connect the Gmail account you want recruiters to see. Emails go out from your own address and appear in your Sent folder.</p>
            <Button variant="primary" loading={busy === 'connect'} onClick={connect}>
              Connect Gmail
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ink">{g.account_email}</span>
              {g.status === 'active' ? <Badge tone="success">connected</Badge> : g.status === 'needs_reauth' ? <Badge tone="danger">needs reconnecting</Badge> : <Badge tone="warning">{g.status?.replace(/_/g, ' ') ?? 'unknown'}</Badge>}
            </div>
            {g.status === 'needs_reauth' && (
              <p className="rounded border border-danger/40 bg-danger/5 p-3">Google rejected AutoReach's access, usually because it was revoked or the password changed. Nothing can be sent until you reconnect.</p>
            )}
            {g.status === 'legacy_import_pending' && <p className="rounded border border-warn/40 bg-warn/5 p-3">Your v1 Gmail connection was carried over. Reconnect once to grant reply detection.</p>}
            <dl className="grid grid-cols-[150px_1fr] gap-y-1.5">
              <dt className="text-muted">Can send</dt>
              <dd>{g.can_send ? 'Yes' : 'No. Reconnect and allow sending.'}</dd>
              <dt className="text-muted">Can detect replies</dt>
              <dd>{!g.reply_detection_enabled ? 'Turned off on this server. Mark replies on each email.' : g.can_detect_replies ? 'Yes' : 'No. Reconnect and allow reading message headers.'}</dd>
              <dt className="text-muted">Last reply check</dt>
              <dd>{g.last_sync_at ? fmtDateTime(g.last_sync_at) : 'Not yet'}</dd>
              {g.sync_error && (
                <>
                  <dt className="text-muted">Last problem</dt>
                  <dd className="text-warn">{g.sync_error}</dd>
                </>
              )}
            </dl>
            <div className="flex flex-wrap gap-2">
              {g.status !== 'active' && (
                <Button variant="primary" loading={busy === 'connect'} onClick={connect}>
                  Reconnect Gmail
                </Button>
              )}
              {g.reply_detection_enabled && (
                <Button icon={<RefreshCw className="h-4 w-4" />} loading={busy === 'sync'} disabled={!g.can_detect_replies} onClick={sync}>
                  Check for replies now
                </Button>
              )}
              <Button variant="ghost" onClick={() => setDisconnecting(true)}>
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="What AutoReach can access">
        <ul className="space-y-2 text-sm text-muted">
          <li>
            <span className="text-ink">Send email on your behalf</span> (gmail.send). Used only when you press Send, or for queued emails and follow-ups you approved.
          </li>
          {g.reply_detection_enabled ? (
            <li>
              <span className="text-ink">Read message headers, not bodies</span> (gmail.metadata). Used to notice replies, bounces and out-of-office messages in threads you started from AutoReach. AutoReach cannot read the content of your emails.
            </li>
          ) : (
            <li>
              <span className="text-ink">No access to your messages.</span> This server doesn't ask for header access, so replies aren't detected automatically; mark them on each email.
            </li>
          )}
          <li>
            <span className="text-ink">Your email address</span> (openid, email). Used to show which account is connected.
          </li>
        </ul>
        <p className="mt-3 text-xs text-faint">Access tokens are encrypted at rest. Disconnecting revokes access at Google too. You can also remove access any time at myaccount.google.com/permissions.</p>
      </Panel>
      {s.draft && g.reply_detection_enabled && (
        <Panel title="Reply detection">
          <Toggle
            label="Also notice replies that start a new thread"
            description="Sometimes a recruiter replies in a fresh email instead of answering yours. When on, AutoReach checks the sender of new incoming emails against recruiters you've already emailed. Headers only; off by default."
            checked={s.draft.reply_scan_new_threads}
            onChange={(v) => s.set('reply_scan_new_threads', v)}
          />
          <SaveBar dirty={s.dirty} saving={s.saving} onSave={() => s.save()} onReset={s.reset} error={s.error} />
        </Panel>
      )}
      {disconnecting && (
        <Confirm
          title="Disconnect Gmail?"
          confirmLabel="Disconnect"
          danger
          body={<p>AutoReach's access is revoked at Google. Queued emails won't send and replies won't be detected until you connect again. Your outreach history stays.</p>}
          onClose={() => setDisconnecting(false)}
          onConfirm={async () => {
            await api('/api/integrations/gmail', { method: 'DELETE' });
            await invalidate();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

function timezones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    // Browsers list some zones under old names; show the current ones, once each.
    return [...new Set(list.map(canonicalTimezone))].sort();
  } catch {
    return [];
  }
}

export function TimezoneSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const zones = useMemo(() => {
    const list = timezones();
    return list.includes(value) ? list : [value, ...list];
  }, [value]);
  if (zones.length <= 1) return <input id={id} className="field max-w-xs" value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <select id={id} className="field max-w-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

function SendingSection() {
  const s = useSettingsForm(['sending_paused', 'daily_send_limit', 'send_spacing_min_seconds', 'send_spacing_max_seconds', 'timezone'] as const);
  if (!s.draft) return s.me.isError ? <ErrorState error={s.me.error} /> : <Spinner />;
  const d = s.draft;
  const spacingError = d.send_spacing_min_seconds > d.send_spacing_max_seconds ? 'The minimum gap must not be longer than the maximum.' : null;
  const tz = browserTimezone();
  return (
    <Panel title="Sending">
      <Toggle
        label="Pause all sending"
        description="Stops every queued, scheduled and auto-sent email until you resume. Pressing Send on a single email is also blocked while paused."
        checked={d.sending_paused}
        onChange={(v) => s.set('sending_paused', v)}
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Daily sending limit" htmlFor="limit" hint={`Counts every email Gmail accepted today (${s.me.data?.sent_today ?? 0} so far). Gmail's own limit for personal accounts is far higher; a low limit keeps outreach personal and protects your account's reputation.`}>
          <NumberInput id="limit" value={d.daily_send_limit} min={1} max={200} onChange={(n) => s.set('daily_send_limit', n)} suffix="emails per day" />
        </Field>
        <Field label="Your time zone" htmlFor="tz" hint={tz !== d.timezone ? `Your browser reports ${tz}.` : 'Used for the daily limit, business days and scheduled sends.'}>
          <TimezoneSelect id="tz" value={d.timezone} onChange={(v) => s.set('timezone', v)} />
        </Field>
        <Field label="Gap between queued emails" htmlFor="gap-min" error={spacingError} className="sm:col-span-2" hint="Queued emails go out one at a time with a random gap in this range. Emails you send individually go immediately.">
          <div className="flex flex-wrap items-center gap-2">
            <NumberInput id="gap-min" value={d.send_spacing_min_seconds} min={15} max={600} onChange={(n) => s.set('send_spacing_min_seconds', n)} />
            <span className="text-sm text-muted">to</span>
            <NumberInput id="gap-max" value={d.send_spacing_max_seconds} min={15} max={1800} onChange={(n) => s.set('send_spacing_max_seconds', n)} suffix="seconds" />
          </div>
        </Field>
      </div>
      <SaveBar dirty={s.dirty && !spacingError} saving={s.saving} onSave={() => s.save()} onReset={s.reset} error={s.error} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Follow-ups                                                          */
/* ------------------------------------------------------------------ */

function FollowUpsSection() {
  const s = useSettingsForm(['followup_delay_business_days', 'max_followups', 'followup_autosend_enabled', 'followup_autosend_daily_cap'] as const);
  const templates = useTemplates();
  if (!s.draft) return s.me.isError ? <ErrorState error={s.me.error} /> : <Spinner />;
  const d = s.draft;
  const hasFollowupTemplate = templates.data?.some((t) => t.type === 'followup_1' && t.body.trim());
  return (
    <Panel title="Follow-ups">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Remind me after" htmlFor="fu-delay" hint="Weekends are skipped. Most recruiters answer within a week if they're going to.">
          <NumberInput id="fu-delay" value={d.followup_delay_business_days} min={1} max={30} onChange={(n) => s.set('followup_delay_business_days', n)} suffix="business days" />
        </Field>
        <Field label="Follow-ups per recruiter" htmlFor="fu-max" hint="After this many follow-ups without a reply, no more reminders are created. 0 turns reminders off.">
          <NumberInput id="fu-max" value={d.max_followups} min={0} max={3} onChange={(n) => s.set('max_followups', n)} suffix="at most" />
        </Field>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <Toggle
          label="Send follow-ups automatically"
          description={
            <>
              Off by default. When on, a due follow-up is sent without asking you, using your own follow-up template (never AI-written text). It's skipped if the recruiter replied, bounced, is marked do-not-contact, if any template variable can't be filled, or if sending is paused. New reminders created after you turn this on are eligible; you can turn auto-send off for any single reminder.
              {!hasFollowupTemplate && <span className="mt-1 block text-warn">Save a follow-up template first (Templates section). Without one, nothing is auto-sent.</span>}
            </>
          }
          checked={d.followup_autosend_enabled}
          onChange={(v) => s.set('followup_autosend_enabled', v)}
        />
        {d.followup_autosend_enabled && (
          <Field label="Auto-send at most" htmlFor="fu-cap" className="mt-2">
            <NumberInput id="fu-cap" value={d.followup_autosend_daily_cap} min={1} max={10} onChange={(n) => s.set('followup_autosend_daily_cap', n)} suffix="follow-ups per day" />
          </Field>
        )}
      </div>
      <SaveBar dirty={s.dirty} saving={s.saving} onSave={() => s.save()} onReset={s.reset} error={s.error} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Tracking                                                            */
/* ------------------------------------------------------------------ */

function TrackingSection() {
  const s = useSettingsForm(['tracking_enabled', 'tracking_retention_days'] as const);
  const invalidate = useInvalidate();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  if (!s.draft) return s.me.isError ? <ErrorState error={s.me.error} /> : <Spinner />;
  const available = s.me.data?.tracking.configured ?? false;
  return (
    <>
      <Panel title="Open tracking">
        <div className="mb-3 space-y-2 text-sm text-muted">
          <p>When on, AutoReach adds a tiny invisible image to each email you send. When the recipient's mail app loads images, AutoReach records an “open detected” signal.</p>
          <p>{OPEN_TRACKING_CAVEAT}</p>
          <p>Recipients aren't told about the image. Some people consider that intrusive, which is why it's off by default. You can turn it off for any single email in the composer.</p>
        </div>
        {!available && <p className="mb-3 rounded border border-line bg-raised p-3 text-sm text-muted">Open tracking isn't available on this server because it doesn't have a public address recipients' mail apps can reach (API_PUBLIC_URL).</p>}
        <Toggle label="Track opens on new emails" checked={s.draft.tracking_enabled} disabled={!available && !s.draft.tracking_enabled} onChange={(v) => s.set('tracking_enabled', v)} />
        <Field label="Keep open signals for" htmlFor="ret" className="mt-2" hint="Older signals are deleted automatically.">
          <NumberInput id="ret" value={s.draft.tracking_retention_days} min={7} max={730} onChange={(n) => s.set('tracking_retention_days', n)} suffix="days" />
        </Field>
        <SaveBar dirty={s.dirty} saving={s.saving} onSave={() => s.save()} onReset={s.reset} error={s.error} />
      </Panel>
      <Panel title="Delete tracking data">
        <p className="mb-3 text-sm text-muted">Removes every open signal recorded so far. Sent and reply status are not affected.</p>
        <Button variant="danger" onClick={() => setDeleting(true)}>
          Delete all open signals
        </Button>
      </Panel>
      {deleting && (
        <Confirm
          danger
          title="Delete all open signals?"
          confirmLabel="Delete"
          body={<p>This can't be undone.</p>}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            const r = await api<{ events_deleted?: number }>('/api/tracking/delete-all', { method: 'POST' });
            await invalidate();
            toast.success(typeof r?.events_deleted === 'number' ? `Deleted ${plural(r.events_deleted, 'signal')}` : 'Open signals deleted');
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

const TEMPLATE_INFO: Record<TemplateType, { title: string; hint: string }> = {
  initial: { title: 'First email', hint: 'Used by “Use my template” in the composer, and as the fallback when AI drafting is unavailable.' },
  followup_1: { title: 'First follow-up', hint: 'Sent in the same thread as your first email. Required for automatic follow-ups.' },
  followup_2: { title: 'Second follow-up', hint: 'Optional. If empty, the first follow-up template is reused.' },
};

function TemplatesSection() {
  const templates = useTemplates();
  if (templates.isError) return <ErrorState error={templates.error} onRetry={() => templates.refetch()} />;
  if (!templates.data) return <Spinner />;
  return (
    <>
      {templates.data.map((t) => (
        <TemplateEditor key={t.type} t={t} />
      ))}
      <Panel title="Variables you can use">
        <p className="mb-2 text-xs text-muted">Write them in curly braces. If a variable has no value for a recipient, the composer flags it before you send.</p>
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[140px_1fr]">
          {TEMPLATE_VARIABLES.map((v) => (
            <div key={v.key} className="contents">
              <dt>
                <code className="text-accent">{`{${v.key}}`}</code>
              </dt>
              <dd className="text-muted">{v.description}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </>
  );
}

function TemplateEditor({ t }: { t: Template }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const dirty = subject !== t.subject || body !== t.body;
  const info = TEMPLATE_INFO[t.type];
  return (
    <Panel title={info.title}>
      <p className="mb-3 text-xs text-muted">{info.hint}</p>
      <div className="space-y-3">
        {t.type === 'initial' ? (
          <Field label="Subject" htmlFor={`tpl-s-${t.type}`}>
            <input id={`tpl-s-${t.type}`} className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Application for {role} at {company}" />
          </Field>
        ) : (
          <p className="text-xs text-faint">Follow-ups reply in the same thread, so they reuse the original subject.</p>
        )}
        <Field label="Body" htmlFor={`tpl-b-${t.type}`}>
          <textarea id={`tpl-b-${t.type}`} rows={t.type === 'initial' ? 10 : 6} className="field font-[inherit]" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {error ? <ErrorState error={error} /> : null}
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!dirty}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await api(`/api/templates/${t.type}`, { method: 'PUT', body: { subject, body } });
                await qc.invalidateQueries({ queryKey: ['templates'] });
                toast.success(`${info.title} template saved`);
              } catch (e) {
                setError(e);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save template
          </Button>
          {t.updated_at && <span className="text-2xs text-faint">Last saved {fmtDateTime(t.updated_at)}</span>}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

function AiSection() {
  const me = useMe();
  if (!me.data) return <Spinner />;
  const ai = me.data.ai;
  return (
    <Panel title="AI drafting">
      {ai.configured ? (
        <div className="space-y-2 text-sm">
          <p>
            Drafts are written by <span className="text-ink">{ai.provider}</span>
            {ai.model ? (
              <>
                {' '}
                using <code className="text-xs">{ai.model}</code>
              </>
            ) : null}
            , configured on the AutoReach server. Your API key never reaches the browser or extension.
          </p>
          <p className="text-muted">
            When you press Generate, AutoReach sends the provider your profile facts, the recruiter's name, title and company, and the job details you saved. Drafts are checked against those facts; anything unsupported is flagged before you can send. Nothing is sent without your approval.
          </p>
        </div>
      ) : (
        <div className="space-y-2 text-sm text-muted">
          <p>No AI provider is configured on this server, so the composer drafts from your templates and profile instead. Everything else works the same.</p>
          <p>To enable AI drafting, the server administrator sets AI_PROVIDER and an API key (see docs/AI_PROVIDERS.md). Anthropic, OpenAI, Gemini, Groq and OpenAI-compatible endpoints are supported.</p>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

function PrivacySection() {
  const toast = useToast();
  const { signOut } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <Panel title="Export your data">
        <p className="mb-3 text-sm text-muted">Download everything AutoReach stores about you as JSON: profile, recruiters, jobs, emails, follow-ups, open signals and activity. Résumé files are downloaded separately from the Résumés section. Gmail tokens are never exported.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<Download className="h-4 w-4" />}
            loading={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await download('/api/account/export', 'autoreach-export.json');
              } catch (e) {
                toast.error(e);
              } finally {
                setExporting(false);
              }
            }}
          >
            Export all data
          </Button>
          <Button icon={<Download className="h-4 w-4" />} onClick={() => download('/api/recruiters/export', 'recruiters.csv').catch((e) => toast.error(e))}>
            Export recruiters as CSV
          </Button>
        </div>
      </Panel>
      <Panel title="Delete your account">
        <p className="mb-3 text-sm text-muted">Revokes Gmail access, deletes your résumé files and permanently removes every record AutoReach holds for you. Emails you already sent stay in your Gmail.</p>
        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
          Delete account
        </Button>
      </Panel>
      {deleteOpen && <DeleteAccountDialog onClose={() => setDeleteOpen(false)} onDeleted={() => void signOut()} />}
    </>
  );
}

function DeleteAccountDialog({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const phrase = 'DELETE MY ACCOUNT';
  return (
    <Dialog
      title="Delete your AutoReach account?"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={text !== phrase}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api('/api/account', { method: 'DELETE', body: { confirm: phrase } });
                onDeleted();
              } catch (e) {
                setError(e);
                setBusy(false);
              }
            }}
          >
            Delete permanently
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">This can't be undone. Consider exporting your data first.</p>
        <Field label={`Type ${phrase} to confirm`} htmlFor="del-confirm">
          <input id="del-confirm" className="field" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {error ? <ErrorState error={error} /> : null}
      </div>
    </Dialog>
  );
}
