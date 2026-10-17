import {
  OUTREACH_STATUS_LABELS,
  OUTREACH_STATUSES,
  RECRUITER_SOURCE_LABELS,
  RECRUITER_SOURCES,
  type OutreachStatus,
  type RecruiterDetail,
  type RecruiterSummary,
} from '@autoreach/shared';
import { Download, Mail, Plus, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AddRecruiterDialog, RecruiterFields, toPayload, type RecruiterFormValues } from '../components/RecruiterForm';
import { StatusTrack } from '../components/StatusTrack';
import { Badge, Button, Confirm, Dialog, Drawer, EmptyState, ErrorState, PageHeader, Pagination, Spinner, useToast, type Tone } from '../components/ui';
import { api, download } from '../lib/api';
import { fmtDate, fmtShortDate } from '../lib/format';
import { useDuplicates, useInvalidate, useRecruiter, useRecruiters } from '../lib/queries';

export const STATUS_TONE: Record<OutreachStatus, Tone> = {
  new: 'neutral',
  contacted: 'sent',
  replied: 'success',
  interviewing: 'success',
  not_interested: 'neutral',
  bounced: 'danger',
  do_not_contact: 'danger',
};

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Recruiters() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const status = params.get('status') ?? '';
  const source = params.get('source') ?? '';
  const tag = params.get('tag') ?? '';
  const sort = params.get('sort') ?? 'created_desc';
  const role = params.get('role') ?? '';
  const addedFrom = params.get('added_from') ?? '';
  const addedTo = params.get('added_to') ?? '';
  const [roleInput, setRoleInput] = useState(role);
  const debouncedRole = useDebounced(roleInput);
  const openId = params.get('open');
  const list = useRecruiters({ q, status, source, tag, sort, page, page_size: 25, role: debouncedRole.trim() || undefined, added_from: addedFrom || undefined, added_to: addedTo || undefined });
  const dups = useDuplicates();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [merging, setMerging] = useState(false);
  const toast = useToast();

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Recruiters"
        description="Everyone you might contact, with what you sent them and what came back."
        actions={
          <>
            <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>
              Import CSV
            </Button>
            <Button icon={<Download className="h-4 w-4" />} onClick={() => download('/api/recruiters/export', 'recruiters.csv').catch(toast.error)}>
              Export CSV
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
              Add recruiter
            </Button>
          </>
        }
      />

      {dups.data && dups.data.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-warn/40 bg-warn/5 px-4 py-2.5 text-sm">
          <span>
            {dups.data.length} possible duplicate {dups.data.length === 1 ? 'pair' : 'groups'} found (same person, different address).
          </span>
          <Button size="sm" className="ml-auto" onClick={() => setMerging(true)}>
            Review duplicates
          </Button>
        </div>
      )}

      <div className="panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-faint" aria-hidden />
            <input
              aria-label="Search recruiters"
              className="field pl-8"
              placeholder="Search name, email, company or title"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select aria-label="Status" className="field w-auto" value={status} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">All statuses</option>
            {OUTREACH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {OUTREACH_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select aria-label="Source" className="field w-auto" value={source} onChange={(e) => setParam('source', e.target.value)}>
            <option value="">All sources</option>
            {RECRUITER_SOURCES.map((s) => (
              <option key={s} value={s}>
                {RECRUITER_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
          <input aria-label="Tag" className="field w-32" placeholder="Tag" value={tag} onChange={(e) => setParam('tag', e.target.value.trim())} />
          <input
            aria-label="Role"
            className="field w-40"
            placeholder="Role"
            value={roleInput}
            onChange={(e) => {
              setRoleInput(e.target.value);
              setPage(1);
            }}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Added
            <input aria-label="Added from" type="date" className="field w-auto" value={addedFrom} max={addedTo || undefined} onChange={(e) => setParam('added_from', e.target.value)} />
            <span>to</span>
            <input aria-label="Added to" type="date" className="field w-auto" value={addedTo} min={addedFrom || undefined} onChange={(e) => setParam('added_to', e.target.value)} />
          </label>
          <select aria-label="Sort" className="field w-auto" value={sort} onChange={(e) => setParam('sort', e.target.value)}>
            <option value="created_desc">Recently added</option>
            <option value="recent_contact">Recently contacted</option>
            <option value="followup_due">Follow-up due first</option>
            <option value="name">Name</option>
            <option value="company">Company</option>
          </select>
        </div>

        {list.isError ? (
          <div className="p-4">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : !list.data ? (
          <div className="px-4">
            <Spinner />
          </div>
        ) : list.data.items.length === 0 ? (
          q || status || source || tag ? (
            <EmptyState title="No recruiters match these filters" action={<Button onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear filters</Button>} />
          ) : (
            <EmptyState title="Your recruiter list is empty" action={<Button variant="primary" onClick={() => setAdding(true)}>Add recruiter</Button>}>
              Add contacts one at a time, import a CSV, or capture them from a page with the Chrome extension.
            </EmptyState>
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Recruiter</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th className="hidden md:table-cell">Last contacted</th>
                    <th className="hidden md:table-cell">Next follow-up</th>
                    <th className="hidden lg:table-cell">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => setParam('open', r.id)}>
                      <td className="max-w-[260px]">
                        <button type="button" className="block max-w-full truncate text-left text-ink hover:underline" onClick={(e) => { e.stopPropagation(); setParam('open', r.id); }}>
                          {r.full_name ?? r.email}
                        </button>
                        <div className="flex items-center gap-1.5 truncate text-2xs text-faint">
                          {r.email}
                          {r.email_verification === 'unverified_guess' && <Badge tone="warning">unverified</Badge>}
                          {r.is_role_address && <Badge title="A shared inbox, not a named person">shared inbox</Badge>}
                        </div>
                      </td>
                      <td className="max-w-[200px]">
                        <div className="truncate text-muted">{r.company ?? '—'}</div>
                        {r.title && <div className="truncate text-2xs text-faint">{r.title}</div>}
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[r.outreach_status]}>{OUTREACH_STATUS_LABELS[r.outreach_status]}</Badge>
                      </td>
                      <td className="num hidden whitespace-nowrap text-muted md:table-cell">{fmtShortDate(r.last_contacted_at)}</td>
                      <td className="num hidden whitespace-nowrap md:table-cell">
                        {r.next_follow_up_at ? (
                          <span className={new Date(r.next_follow_up_at) <= new Date() ? 'text-warn' : 'text-muted'}>{fmtShortDate(r.next_follow_up_at)}</span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="hidden max-w-[200px] lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {r.tags.slice(0, 3).map((t) => (
                            <Badge key={t}>{t}</Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </div>

      {adding && <AddRecruiterDialog onClose={() => setAdding(false)} onCreated={(r) => setParam('open', r.id)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {merging && <DuplicatesDialog onClose={() => setMerging(false)} />}
      {openId && <RecruiterDrawer id={openId} onClose={() => setParam('open', '')} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function toForm(r: RecruiterSummary): RecruiterFormValues {
  return {
    full_name: r.full_name ?? '',
    email: r.email,
    company: r.company ?? '',
    title: r.title ?? '',
    linkedin_url: r.linkedin_url ?? '',
    company_website: r.company_website ?? '',
    target_role: r.target_role ?? '',
    source: r.source,
    tags: r.tags,
    notes: r.notes ?? '',
    unverified: r.email_verification === 'unverified_guess',
    opportunity_id: '',
  };
}

export function RecruiterDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useRecruiter(id);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<RecruiterFormValues | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const invalidate = useInvalidate();
  const toast = useToast();
  const navigate = useNavigate();
  const r = q.data;

  async function save() {
    if (!form || !r) return;
    setBusy(true);
    try {
      const payload = toPayload(form, false);
      await api(`/api/recruiters/${id}`, {
        method: 'PATCH',
        body: { ...payload, email_verification: form.unverified ? 'unverified_guess' : r.email_verification === 'unverified_guess' ? 'confirmed' : r.email_verification },
      });
      await invalidate();
      toast.success('Recruiter updated');
      setEditing(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: OutreachStatus) {
    try {
      await api(`/api/recruiters/${id}`, { method: 'PATCH', body: status === 'do_not_contact' ? { do_not_contact: true } : { outreach_status: status, do_not_contact: false } });
      await invalidate();
      toast.success(status === 'do_not_contact' ? 'Marked do-not-contact. Pending follow-ups were cancelled.' : 'Status updated');
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Drawer
      onClose={onClose}
      title={
        r ? (
          <div>
            <h2 className="truncate text-lg">{r.full_name ?? r.email}</h2>
            <p className="truncate text-xs text-muted">
              {[r.title, r.company].filter(Boolean).join(' at ') || r.email}
            </p>
          </div>
        ) : (
          <h2 className="text-lg">Recruiter</h2>
        )
      }
      actions={
        r && !editing ? (
          <>
            <Button size="sm" variant="primary" icon={<Mail className="h-3.5 w-3.5" />} disabled={r.do_not_contact} onClick={() => navigate(`/outreach/new?recruiter=${r.id}`)}>
              Write email
            </Button>
            <Button size="sm" onClick={() => { setForm(toForm(r)); setEditing(true); }}>
              Edit
            </Button>
          </>
        ) : null
      }
    >
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !r ? (
        <Spinner />
      ) : editing && form ? (
        <div className="space-y-4">
          <RecruiterFields value={form} onChange={setForm} showOpportunity={false} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              Save changes
            </Button>
          </div>
        </div>
      ) : (
        <RecruiterDetailView r={r} onStatus={setStatus} onDelete={() => setConfirmDelete(true)} />
      )}
      {confirmDelete && r && (
        <Confirm
          title="Delete recruiter?"
          danger
          confirmLabel="Delete recruiter"
          body={<p>{r.full_name ?? r.email} will be removed from your CRM. Emails you already sent stay in your outreach history.</p>}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await api(`/api/recruiters/${id}`, { method: 'DELETE' });
            await invalidate();
            toast.success('Recruiter deleted');
            onClose();
          }}
        />
      )}
    </Drawer>
  );
}

function RecruiterDetailView({ r, onStatus, onDelete }: { r: RecruiterDetail; onStatus: (s: OutreachStatus) => void; onDelete: () => void }) {
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Email</dt>
        <dd className="break-all">
          {r.email}{' '}
          {r.email_verification === 'unverified_guess' && <Badge tone="warning">unverified guess</Badge>}
          {r.email_verification === 'confirmed' && <Badge tone="success">confirmed by you</Badge>}
          {r.is_role_address && <Badge>shared inbox</Badge>}
        </dd>
        <dt className="text-muted">Status</dt>
        <dd>
          <select aria-label="Outreach status" className="field h-7 w-auto py-0" value={r.outreach_status} onChange={(e) => onStatus(e.target.value as OutreachStatus)}>
            {OUTREACH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {OUTREACH_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </dd>
        <dt className="text-muted">Role</dt>
        <dd>{r.target_role ?? '—'}</dd>
        <dt className="text-muted">Source</dt>
        <dd>
          {RECRUITER_SOURCE_LABELS[r.source]}
          {r.source_url && (
            <>
              {' '}
              <a href={r.source_url} target="_blank" rel="noreferrer">
                (page)
              </a>
            </>
          )}
        </dd>
        <dt className="text-muted">LinkedIn</dt>
        <dd className="truncate">{r.linkedin_url ? <a href={r.linkedin_url} target="_blank" rel="noreferrer">{r.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}</a> : '—'}</dd>
        <dt className="text-muted">Added</dt>
        <dd>{fmtDate(r.created_at)}</dd>
        <dt className="text-muted">Last contacted</dt>
        <dd>{fmtDate(r.last_contacted_at)}</dd>
        <dt className="text-muted">Last reply</dt>
        <dd>{fmtDate(r.last_reply_at)}</dd>
        {r.tags.length > 0 && (
          <>
            <dt className="text-muted">Tags</dt>
            <dd className="flex flex-wrap gap-1">
              {r.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </dd>
          </>
        )}
      </dl>
      {r.notes && <p className="whitespace-pre-wrap rounded border border-line bg-bg p-3 text-sm text-muted">{r.notes}</p>}

      <section>
        <h3 className="mb-2 text-sm">Jobs</h3>
        {r.opportunities.length === 0 ? (
          <p className="text-sm text-muted">Not linked to any saved job.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {r.opportunities.map((o) => (
              <li key={o.id}>
                <Link to={`/opportunities/${o.id}`}>{o.title}</Link> <span className="text-muted">at {o.company}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm">Email history</h3>
        {r.messages.length === 0 ? (
          <p className="text-sm text-muted">No emails yet.</p>
        ) : (
          <ul className="divide-y divide-line/60 rounded border border-line">
            {r.messages.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <Link to={`/outreach/${m.id}`} className="block truncate text-sm text-ink">
                    {m.subject || '(no subject)'}
                  </Link>
                  <p className="text-2xs text-faint">
                    {m.kind === 'follow_up' ? 'Follow-up' : 'First email'}
                    {m.sent_at ? `, sent ${fmtDate(m.sent_at)}` : ''}
                    {m.legacy ? ' (AutoReach v1)' : ''}
                  </p>
                </div>
                <StatusTrack m={m} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm">Follow-ups</h3>
        {r.follow_ups.length === 0 ? (
          <p className="text-sm text-muted">No reminders.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {r.follow_ups.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <Badge tone={f.status === 'pending' ? (new Date(f.due_at) <= new Date() ? 'warning' : 'info') : 'neutral'}>{f.status}</Badge>
                Follow-up {f.step}, {f.status === 'pending' ? `due ${fmtDate(f.due_at)}` : f.cancel_reason ? f.cancel_reason.replace(/_/g, ' ') : fmtDate(f.due_at)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {r.merged_from.length > 0 && <p className="text-xs text-faint">Merged from: {r.merged_from.map((m) => m.email).join(', ')}</p>}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {!r.do_not_contact && (
          <Button size="sm" onClick={() => onStatus('do_not_contact')}>
            Mark do-not-contact
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={onDelete}>
          Delete recruiter
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface ImportPreview {
  dry_run: boolean;
  total_rows: number;
  created: number;
  duplicates: number;
  invalid: number;
  rows: { row: number; email: string; full_name: string | null; company: string | null; status: string; reason?: string; role_address?: boolean }[];
  unmapped_headers: string[];
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const invalidate = useInvalidate();
  const toast = useToast();

  async function run(dry: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('dry_run', String(dry));
      if (tags.trim()) form.append('default_tags', tags);
      form.append('file', file);
      const res = await api<ImportPreview>('/api/recruiters/import', { method: 'POST', form });
      if (dry) setPreview(res);
      else {
        await invalidate();
        toast.success(`Imported ${res.created} recruiter${res.created === 1 ? '' : 's'}`);
        onClose();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const newCount = useMemo(() => preview?.rows.filter((r) => r.status === 'new').length ?? 0, [preview]);

  return (
    <Dialog
      title="Import recruiters from CSV"
      onClose={onClose}
      width="max-w-3xl"
      footer={
        preview ? (
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Choose another file
            </Button>
            <Button variant="primary" loading={busy} disabled={newCount === 0} onClick={() => run(false)}>
              Import {newCount} new recruiter{newCount === 1 ? '' : 's'}
            </Button>
          </>
        ) : (
          <Button variant="primary" loading={busy} disabled={!file} onClick={() => run(true)}>
            Preview import
          </Button>
        )
      }
    >
      {!preview ? (
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            The file needs an <strong>Email</strong> column. Optional columns: Name (or First name and Last name), Company, Title, Role, LinkedIn, Website, Notes, Tags. Nothing is saved until you
            confirm the preview.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="CSV file" />
          <div>
            <label className="label" htmlFor="imp-tags">
              Tags to add to every imported recruiter (optional)
            </label>
            <input id="imp-tags" className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="career-fair-2026" />
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>
            {preview.total_rows} rows: <span className="text-replied">{newCount} new</span>, {preview.duplicates} duplicates skipped, {preview.invalid} invalid.
          </p>
          {preview.unmapped_headers.length > 0 && <p className="text-xs text-muted">Ignored columns: {preview.unmapped_headers.join(', ')}</p>}
          <div className="max-h-[45vh] overflow-auto rounded border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="num text-faint">{r.row}</td>
                    <td className="break-all">{r.email || '—'}</td>
                    <td>{r.full_name ?? '—'}</td>
                    <td>{r.company ?? '—'}</td>
                    <td>
                      {r.status === 'new' ? (
                        <Badge tone="success">{r.role_address ? 'new (shared inbox)' : 'new'}</Badge>
                      ) : r.status === 'invalid' ? (
                        <Badge tone="danger">{r.reason}</Badge>
                      ) : (
                        <Badge tone="warning">{r.reason}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {error ? (
        <div className="mt-3">
          <ErrorState error={error} />
        </div>
      ) : null}
    </Dialog>
  );
}

function DuplicatesDialog({ onClose }: { onClose: () => void }) {
  const dups = useDuplicates();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Dialog title="Possible duplicates" onClose={onClose} width="max-w-2xl">
      <p className="mb-3 text-sm text-muted">
        Merging keeps the record you choose and moves every email, follow-up, tag and job link from the other one into it. Nothing is deleted.
      </p>
      {!dups.data ? (
        <Spinner />
      ) : dups.data.length === 0 ? (
        <p className="text-sm">No possible duplicates left.</p>
      ) : (
        <ul className="space-y-3">
          {dups.data.map((g) => (
            <li key={g.recruiters.map((r) => r.id).join()} className="rounded border border-line p-3">
              <p className="mb-2 text-xs text-muted">{g.reason === 'same_canonical_email' ? 'Same mailbox written differently' : 'Same name at the same company'}</p>
              <ul className="space-y-1.5">
                {g.recruiters.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {r.full_name ?? '—'} <span className="text-muted">{r.email}</span> <span className="text-2xs text-faint">({r.messages_sent} sent)</span>
                    </span>
                    {g.recruiters.length === 2 && (
                      <Button
                        size="sm"
                        loading={busy === r.id}
                        onClick={async () => {
                          const other = g.recruiters.find((x) => x.id !== r.id)!;
                          setBusy(r.id);
                          try {
                            await api(`/api/recruiters/${r.id}/merge`, { method: 'POST', body: { source_id: other.id } });
                            await invalidate();
                            toast.success(`Merged into ${r.email}`);
                          } catch (e) {
                            toast.error(e);
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        Keep this one
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
