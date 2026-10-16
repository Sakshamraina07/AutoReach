import type { ProfileUpdate } from './schemas.js';

export interface CompletenessItem {
  key: string;
  label: string;
  done: boolean;
  weight: number;
}

/**
 * Profile completeness: weighted checklist of the information the drafting
 * assistant actually uses. Returned as a percentage plus what is missing.
 */
export function profileCompleteness(
  p: Partial<ProfileUpdate> | null | undefined,
  extras: { hasResume: boolean; gmailConnected: boolean },
): { percent: number; items: CompletenessItem[] } {
  const profile = p ?? {};
  const items: CompletenessItem[] = [
    { key: 'full_name', label: 'Full name', done: !!profile.full_name, weight: 8 },
    { key: 'education', label: 'Degree and college', done: !!profile.degree && !!profile.university, weight: 10 },
    { key: 'graduation', label: 'Graduation month/year', done: !!profile.graduation_year, weight: 6 },
    { key: 'location', label: 'Current location', done: !!profile.current_location, weight: 4 },
    { key: 'target_roles', label: 'Target roles', done: (profile.target_roles?.length ?? 0) > 0, weight: 10 },
    { key: 'job_types', label: 'Preferred job types', done: (profile.job_types?.length ?? 0) > 0, weight: 4 },
    { key: 'skills', label: 'At least 5 skills', done: (profile.skills?.length ?? 0) >= 5, weight: 12 },
    {
      key: 'projects',
      label: 'At least 2 projects with a description',
      done: (profile.projects ?? []).filter((x) => x.description && x.description.length > 20).length >= 2,
      weight: 14,
    },
    {
      key: 'achievements',
      label: 'At least one measurable achievement',
      done: [...(profile.projects ?? []), ...(profile.experience ?? [])].some((x) => (x.achievements?.length ?? 0) > 0),
      weight: 8,
    },
    { key: 'links', label: 'GitHub or LinkedIn link', done: !!profile.links?.github || !!profile.links?.linkedin, weight: 6 },
    { key: 'resume', label: 'Résumé uploaded', done: extras.hasResume, weight: 12 },
    { key: 'gmail', label: 'Gmail connected', done: extras.gmailConnected, weight: 6 },
  ];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const done = items.filter((i) => i.done).reduce((s, i) => s + i.weight, 0);
  return { percent: Math.round((done / total) * 100), items };
}
