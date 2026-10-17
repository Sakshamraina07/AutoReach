import { canonicalSkill, type Profile, type ProfileUpdate } from '@autoreach/shared';
import type { Tx } from '../db/pool.js';

const COLUMNS = `user_id, full_name, primary_email, phone, degree, specialization, university, graduation_month,
  graduation_year, current_location, preferred_locations, job_types, target_roles, skills, projects, experience,
  links, preferred_tone, writing_style, signature, legacy_year, onboarding_completed_at, updated_at`;

export async function getProfile(tx: Tx, userId: string): Promise<Profile | null> {
  return tx.maybeOne<Profile>(`SELECT ${COLUMNS} FROM profiles WHERE user_id = $1`, [userId]);
}

function dedupe(list: string[] | undefined, canonical = false): string[] | undefined {
  if (!list) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = canonical ? canonicalSkill(raw) : raw.trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

const JSON_COLUMNS = new Set(['projects', 'experience', 'links']);

/** Partial upsert: only provided keys are written. */
export async function saveProfile(tx: Tx, userId: string, patch: Partial<ProfileUpdate>, opts: { completeOnboarding?: boolean } = {}): Promise<Profile> {
  const clean: Record<string, unknown> = { ...patch };
  if (patch.skills) clean.skills = dedupe(patch.skills, true);
  if (patch.target_roles) clean.target_roles = dedupe(patch.target_roles);
  if (patch.preferred_locations) clean.preferred_locations = dedupe(patch.preferred_locations);
  const entries = Object.entries(clean).filter(([, v]) => v !== undefined);

  await tx.query(`INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
  if (entries.length) {
    const sets = entries.map(([k], i) => (JSON_COLUMNS.has(k) ? `${k} = $${i + 2}::jsonb` : `${k} = $${i + 2}`));
    await tx.query(
      `UPDATE profiles SET ${sets.join(', ')} WHERE user_id = $1`,
      [userId, ...entries.map(([k, v]) => (JSON_COLUMNS.has(k) ? JSON.stringify(v) : v))],
    );
  }
  if (opts.completeOnboarding) {
    await tx.query(`UPDATE profiles SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()) WHERE user_id = $1`, [userId]);
  }
  return (await getProfile(tx, userId))!;
}

/** All verified skills: profile skills + technologies of projects and experience. */
export function verifiedSkills(profile: Profile | null): string[] {
  if (!profile) return [];
  const all = [
    ...profile.skills,
    ...profile.projects.flatMap((p) => p.technologies ?? []),
    ...profile.experience.flatMap((e) => e.technologies ?? []),
  ];
  return dedupe(all, true) ?? [];
}
