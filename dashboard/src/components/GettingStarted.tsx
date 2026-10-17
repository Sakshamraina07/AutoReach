import type { MeResponse } from '@autoreach/shared';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface ChecklistItem {
  key: 'profile' | 'gmail' | 'job' | 'email';
  label: string;
  done: boolean;
  to: string;
  hint: string;
}

/** The profile fields a first email cannot do without. */
const PROFILE_ESSENTIALS = new Set(['full_name', 'education', 'target_roles', 'skills']);

/**
 * Built only from what the dashboard already loads: /api/me plus whether any job exists.
 * The caller hides the whole panel once an email has been sent.
 */
export function checklistItems(me: MeResponse, hasJob: boolean): ChecklistItem[] {
  const profileDone = !!me.profile && me.completeness.items.filter((i) => PROFILE_ESSENTIALS.has(i.key)).every((i) => i.done);
  const viaCareerOps = me.career_ops.configured;
  return [
    {
      key: 'profile',
      label: 'Complete your profile',
      done: profileDone,
      to: me.onboarding_completed ? '/settings?section=profile' : '/onboarding',
      hint: 'Name, degree, target roles and skills. Emails are written from this.',
    },
    {
      key: 'gmail',
      label: 'Connect Gmail',
      done: me.gmail.connected,
      to: '/settings?section=gmail',
      hint: 'Emails are sent from your own Gmail account.',
    },
    {
      key: 'job',
      label: 'Add your first job',
      done: hasJob,
      to: viaCareerOps ? '/career-ops' : '/jobs/new',
      hint: viaCareerOps ? 'Pick one from career-ops, or paste a posting.' : 'Paste a job posting.',
    },
    {
      key: 'email',
      label: 'Send your first email',
      done: false,
      to: hasJob ? '/opportunities' : '/jobs/new',
      hint: 'Open a job, add the people to write to, review each draft and send.',
    },
  ];
}

export function GettingStarted({ me, hasJob }: { me: MeResponse; hasJob: boolean }) {
  const items = checklistItems(me, hasJob);
  const remaining = items.filter((i) => !i.done).length;
  return (
    <section aria-labelledby="start-h" className="panel mb-6">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 id="start-h" className="text-sm font-semibold">
          Getting started
        </h2>
        <span className="text-xs text-muted">{`${remaining} of ${items.length} to go`}</span>
      </div>
      <ol className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
        {items.map((i, n) => (
          <li key={i.key} className="flex gap-3 bg-surface px-4 py-3">
            <span
              aria-hidden
              className={clsx(
                'num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-2xs',
                i.done ? 'border-replied bg-replied text-surface' : 'border-line text-muted',
              )}
            >
              {i.done ? <Check className="h-3 w-3" /> : n + 1}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2">
                <Link to={i.to} className={clsx('text-sm', i.done ? 'text-muted line-through' : 'text-ink')}>
                  {i.label}
                </Link>
                <span className="text-2xs text-faint">{i.done ? 'Done' : 'Not done'}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted">{i.hint}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
