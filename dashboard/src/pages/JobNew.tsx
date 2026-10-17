import type { JobAnalysisResult, JobView } from '@autoreach/shared';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, ErrorState, Field, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useInvalidate, useMe } from '../lib/queries';

const MIN_CHARS = 80;

/**
 * Step one of the job flow: paste the posting. Reading it and saving it happen in one
 * click; the next page shows the reading, the fit and a box for the people to email.
 */
export default function JobNew() {
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const me = useMe();
  // Arriving from career-ops (or anywhere else) with the posting's link and names.
  const [params] = useSearchParams();
  const [hints] = useState(() => ({ company: params.get('company') ?? '', role: params.get('role') ?? '' }));
  const [text, setText] = useState('');
  const [url, setUrl] = useState(() => params.get('url') ?? '');
  const [fetching, setFetching] = useState(false);
  const [fetchedFrom, setFetchedFrom] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Shown only when the posting doesn't say which company or role it is.
  const [missing, setMissing] = useState<{ result: JobAnalysisResult; company: string; title: string } | null>(null);

  // A link pasted without "https://" still counts; anything else that isn't a web link is left out.
  const trimmedUrl = url.trim();
  const cleanUrl = !trimmedUrl ? null : /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(trimmedUrl) ? `https://${trimmedUrl}` : null;
  const tooShort = text.trim().length < MIN_CHARS;

  async function save(result: JobAnalysisResult, company: string, title: string) {
    setBusy('saving');
    const job = await api<JobView>('/api/jobs', {
      method: 'POST',
      body: { text, url: cleanUrl, analysis: { ...result.analysis, company: company.trim(), title: title.trim() } },
    });
    await invalidate();
    navigate(`/jobs/${job.opportunity.id}`, { replace: true });
  }

  async function read() {
    setError(null);
    setBusy('reading');
    try {
      const result = await api<JobAnalysisResult>('/api/jobs/analyze', { method: 'POST', body: { text } });
      const { company, title } = result.analysis;
      if (company && title) await save(result, company, title);
      else {
        // Names passed in the link (from career-ops) are suggestions to confirm, not facts.
        setMissing({ result, company: company ?? hints.company, title: title ?? hints.role });
        setBusy(null);
      }
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  /** Greenhouse, Lever and Ashby publish their postings' text; read it instead of copying. */
  async function fetchFromLink(replace = false) {
    if (!cleanUrl) return;
    if (text.trim() && !replace) {
      setConfirmReplace(true);
      return;
    }
    setConfirmReplace(false);
    setError(null);
    setFetching(true);
    try {
      const job = await api<{ text: string; board: string }>('/api/jobs/fetch', { method: 'POST', body: { url: cleanUrl } });
      setText(job.text);
      setMissing(null);
      setFetchedFrom(job.board === 'greenhouse' ? 'Greenhouse' : job.board === 'lever' ? 'Lever' : 'Ashby');
    } catch (e) {
      setError(e);
    } finally {
      setFetching(false);
    }
  }

  async function saveWithNames() {
    if (!missing) return;
    setError(null);
    try {
      await save(missing.result, missing.company, missing.title);
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New job"
        description="Paste the job description, or a Greenhouse, Lever or Ashby link. AutoReach reads it, shows how your profile fits, and writes an email for each person you add. Nothing is sent until you press Send."
      />

      <div className="space-y-4">
        <Field
          label="Link to the posting (optional)"
          htmlFor="jd-url"
          hint="Greenhouse, Lever and Ashby links can fill in the description for you. Other links are just saved with the job."
          error={url.trim() && !cleanUrl ? 'This isn’t a web link, so it won’t be saved.' : null}
        >
          <div className="flex gap-2">
            <input id="jd-url" type="url" className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" disabled={!!busy || fetching} />
            <Button onClick={() => void fetchFromLink()} loading={fetching} disabled={!cleanUrl || !!busy}>
              Get description
            </Button>
          </div>
        </Field>
        {confirmReplace && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-warn/40 bg-warn/5 p-3 text-sm" role="alert">
            <span className="flex-1">This replaces the description you already pasted.</span>
            <Button size="sm" variant="primary" onClick={() => void fetchFromLink(true)}>
              Replace it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReplace(false)}>
              Keep mine
            </Button>
          </div>
        )}
        <Field label="Job description" htmlFor="jd-text" hint={
            tooShort && text
              ? `Paste the full description (${text.trim().length} of at least ${MIN_CHARS} characters).`
              : fetchedFrom
                ? `Read from the ${fetchedFrom} posting. Check it, then read it below.`
                : 'Copy everything from the posting: title, company, responsibilities and requirements.'
          }>
          <textarea
            id="jd-text"
            rows={14}
            className="field leading-relaxed"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMissing(null);
              setFetchedFrom(null);
            }}
            placeholder="Software Engineer Intern, Backend&#10;Company: …&#10;&#10;What you'll do: …&#10;Requirements: …"
            disabled={!!busy}
          />
        </Field>
        {missing && (
          <div className="panel space-y-3 p-4">
            <p className="text-sm">The posting doesn't say {!missing.company && !missing.title ? 'the company or the role' : !missing.company ? 'which company it is' : 'the role title'}. Add it so emails name it correctly.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company" htmlFor="jd-company">
                <input id="jd-company" className="field" value={missing.company} onChange={(e) => setMissing({ ...missing, company: e.target.value })} />
              </Field>
              <Field label="Role" htmlFor="jd-title">
                <input id="jd-title" className="field" value={missing.title} onChange={(e) => setMissing({ ...missing, title: e.target.value })} />
              </Field>
            </div>
            <Button variant="primary" loading={busy === 'saving'} disabled={!missing.company.trim() || !missing.title.trim()} onClick={saveWithNames}>
              Save job
            </Button>
          </div>
        )}

        {error ? <ErrorState error={error} /> : null}

        {!missing && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={!!busy} disabled={tooShort} onClick={read}>
              {busy === 'saving' ? 'Saving' : busy === 'reading' ? 'Reading the job description' : 'Read job description'}
            </Button>
            <span className="text-xs text-faint">
              {me.data?.ai.configured ? `Read by ${me.data.ai.model ?? me.data.ai.provider ?? 'AI'}, then checked against your text.` : 'AI isn’t set up on the server, so this is a plain keyword reading.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
