import { PEOPLE_GROUP_LABELS, type FoundPerson, type JobPasteResult, type JobView, type PeopleGroup, type PeopleSearch } from '@autoreach/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { keys } from '../lib/queries';
import { Button, ErrorState, Field } from './ui';

/** What Hunter's own address check means, in plain words. Never presented as AutoReach's check. */
const HUNTER_STATUS: Record<string, string> = {
  valid: 'Hunter checked it: the address accepts mail',
  accept_all: 'The company accepts mail for any address, so this one can’t be checked',
  webmail: 'A personal webmail address',
  unknown: 'Hunter couldn’t check it',
  invalid: 'Hunter found it doesn’t accept mail',
  disposable: 'A throwaway address',
};

const name = (p: FoundPerson) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;

/**
 * People at the job's company from Hunter.io. Searching spends the user's Hunter credits
 * (1 per address found) and saves nothing; added people are unconfirmed addresses, so the
 * first email to each asks the user to check it.
 */
export function FindPeople({ jobId, company }: { jobId: string; company: string }) {
  const qc = useQueryClient();
  const [group, setGroup] = useState<PeopleGroup>('recruiters');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState<'search' | 'add' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [found, setFound] = useState<PeopleSearch | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<string | null>(null);

  async function search() {
    setBusy('search');
    setError(null);
    setAdded(null);
    try {
      const r = await api<PeopleSearch>(`/api/jobs/${jobId}/find-people`, { method: 'POST', body: { group, domain: domain.trim() || undefined } });
      setFound(r);
      setPicked(new Set());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function addPicked() {
    if (!found) return;
    setBusy('add');
    setError(null);
    try {
      const people = found.people
        .filter((p) => picked.has(p.email))
        .map(({ email, first_name, last_name, position, linkedin, source_url }) => ({ email, first_name, last_name, position, linkedin, source_url }));
      const r = await api<JobPasteResult>(`/api/jobs/${jobId}/people`, { method: 'POST', body: { people } });
      qc.setQueryData(keys.job(jobId), (({ added: _a, already_saved: _s, skipped: _k, ...view }) => view)(r) as JobView);
      await qc.invalidateQueries({ queryKey: ['recruiters'] });
      setAdded(`Added ${people.length === 1 ? '1 person' : `${people.length} people`}. Their emails are being written below.`);
      setFound(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="border-t border-line pt-3">
      <summary className="cursor-pointer text-sm text-muted hover:text-ink">Find people at {company} with Hunter.io</summary>
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <Field label="Who" htmlFor="hunter-group">
            <select id="hunter-group" className="field" value={group} onChange={(e) => setGroup(e.target.value as PeopleGroup)}>
              {(Object.keys(PEOPLE_GROUP_LABELS) as PeopleGroup[]).map((g) => (
                <option key={g} value={g}>
                  {PEOPLE_GROUP_LABELS[g]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Company website (optional)" htmlFor="hunter-domain">
            <input id="hunter-domain" className="field" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="contoso.com" />
          </Field>
          <Button icon={<Search className="h-4 w-4" />} loading={busy === 'search'} disabled={!!busy} onClick={search}>
            Search Hunter
          </Button>
        </div>
        <p className="text-xs text-faint">
          Hunter lists work addresses it found on public web pages. Each address found uses 1 of your Hunter credits (up to 10 per search; the free plan has 50 a month). Without a website,
          Hunter guesses it from the company name, so add it if the results look wrong.
        </p>

        {found && (
          <div className="space-y-2">
            {found.people.length === 0 ? (
              <p className="text-sm text-muted">Hunter found nobody{found.domain ? ` at ${found.domain}` : ''} in this group. Try “{PEOPLE_GROUP_LABELS.everyone}” or add the company website.</p>
            ) : (
              <>
                <p className="text-xs text-muted">
                  {found.people.length} found{found.domain ? ` at ${found.domain}` : ''}. Pick who to write to:
                </p>
                <ul className="divide-y divide-line rounded border border-line">
                  {found.people.map((p) => (
                    <li key={p.email} className="flex items-start gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        aria-label={`Add ${name(p)}`}
                        checked={picked.has(p.email)}
                        onChange={(e) =>
                          setPicked((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(p.email);
                            else n.delete(p.email);
                            return n;
                          })
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-ink">
                          {name(p)}
                          {p.position ? <span className="text-muted">, {p.position}</span> : null}
                          {p.recruiter_id ? <span className="text-xs text-faint"> (already saved)</span> : null}
                        </p>
                        <p className="break-all text-xs text-muted">{p.email}</p>
                        <p className="text-xs text-faint">
                          {p.confidence !== null ? `Hunter confidence ${p.confidence}%. ` : ''}
                          {p.hunter_status ? `${HUNTER_STATUS[p.hunter_status] ?? `Hunter status: ${p.hunter_status}`}. ` : ''}
                          {p.source_url ? (
                            <a href={p.source_url} target="_blank" rel="noreferrer">
                              Where Hunter saw it
                            </a>
                          ) : null}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" loading={busy === 'add'} disabled={!picked.size || !!busy} onClick={addPicked}>
                    {picked.size ? `Add ${picked.size === 1 ? '1 person' : `${picked.size} people`} and write emails` : 'Add and write emails'}
                  </Button>
                  <span className="text-xs text-faint">They’re saved as unconfirmed addresses: the first email to each asks you to check the address.</span>
                </div>
              </>
            )}
          </div>
        )}
        {added && (
          <p className="text-xs text-muted" role="status">
            {added}
          </p>
        )}
        {error ? <ErrorState error={error} /> : null}
      </div>
    </details>
  );
}
