import { randomUUID } from 'node:crypto';
import { extractSkills, profilePatchSchema, type ProfileUpdate } from '@autoreach/shared';
import type { Deps } from '../context.js';
import { parseJsonObject } from './ai/provider.js';

/**
 * Turns résumé text into SUGGESTED profile fields. Nothing is saved here: the
 * client shows the suggestions and the user confirms each section first.
 */

export interface ExtractionResult {
  source: 'ai' | 'heuristic';
  suggested: Partial<ProfileUpdate>;
  warnings: string[];
}

const DEGREE_RE =
  /\b(B\.?\s?Tech|B\.?\s?E\.?|B\.?\s?Sc|B\.?\s?S\.?|BCA|MCA|M\.?\s?Tech|M\.?\s?S\.?|M\.?\s?Sc|MBA|Bachelor(?:'s)? of [A-Za-z ]+|Master(?:'s)? of [A-Za-z ]+|Ph\.?\s?D)\b[^\n,|]{0,80}/i;
const SECTION_RE = /^\s*(projects?|personal projects|academic projects|experience|work experience|internships?|education|skills|technical skills|achievements|certifications|publications|extracurricular)\s*:?\s*$/i;

function sections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current = 'header';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(SECTION_RE);
    if (m?.[1]) {
      const name = m[1].toLowerCase();
      current = name.startsWith('project') || name.includes('project') ? 'projects' : name.includes('experience') || name.startsWith('intern') ? 'experience' : name.includes('skill') ? 'skills' : name;
      continue;
    }
    (out[current] ??= []).push(line);
  }
  return out;
}

export function heuristicExtract(text: string): Partial<ProfileUpdate> {
  const s = sections(text);
  const header = (s.header ?? []).slice(0, 6);
  const out: Partial<ProfileUpdate> = {};
  const nameLine = header.find((l) => /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(l));
  if (nameLine) out.full_name = nameLine;
  const email = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
  if (email) out.primary_email = email;
  const phone = text.match(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)\d{3,5}[\s-]?\d{3,5}/)?.[0];
  if (phone && phone.replace(/\D/g, '').length >= 10) out.phone = phone.trim();
  const url = (re: RegExp) => {
    const m = text.match(re)?.[0];
    return m ? (m.startsWith('http') ? m : `https://${m}`).replace(/[).,;]+$/, '') : null;
  };
  out.links = {
    github: url(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.-]+/i),
    linkedin: url(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+/i),
    portfolio: null,
    other: [],
  };
  const edu = (s.education ?? []).join('\n') || text;
  const degree = edu.match(DEGREE_RE)?.[0]?.trim();
  if (degree) out.degree = degree.replace(/\s{2,}/g, ' ').slice(0, 120);
  const uni = edu.split('\n').find((l) => /(university|institute|college|iit|nit|iiit|school of)/i.test(l));
  if (uni) out.university = uni.replace(/\s*[|,–-]\s*\d{4}.*$/, '').slice(0, 160);
  const years = [...edu.matchAll(/\b(20[1-4]\d)\b/g)].map((m) => Number(m[1]));
  if (years.length) out.graduation_year = Math.max(...years);
  const skills = extractSkills(text);
  if (skills.length) out.skills = skills;
  const projLines = s.projects ?? [];
  const projects: ProfileUpdate['projects'] = [];
  for (const line of projLines) {
    const isBullet = /^[•\-*▪◦]/.test(line);
    if (!isBullet && line.length < 120) {
      projects.push({ id: randomUUID().slice(0, 8), name: line.replace(/\s*[|–-].*$/, '').slice(0, 120) || line.slice(0, 120), description: '', technologies: extractSkills(line), achievements: [], url: null });
    } else if (projects.length) {
      const p = projects[projects.length - 1]!;
      const clean = line.replace(/^[•\-*▪◦]\s*/, '');
      p.description = (p.description ? `${p.description} ` : '') + clean;
      if (/\d/.test(clean) && p.achievements.length < 4) p.achievements.push(clean.slice(0, 300));
      p.technologies = [...new Set([...p.technologies, ...extractSkills(clean)])];
    }
  }
  if (projects.length) out.projects = projects.slice(0, 8).map((p) => ({ ...p, description: p.description.slice(0, 1200) }));
  return out;
}

const AI_SYSTEM = `You extract structured profile data from a résumé for a job-search tool.
Rules: copy information exactly as written; never infer, guess or embellish. If something is not in the text, use null or an empty list.
Achievements must be verbatim phrases from the résumé (keep any numbers exactly). Return ONE JSON object only, with keys:
full_name, primary_email, phone, degree, specialization, university, graduation_month (1-12 or null), graduation_year (number or null),
current_location, skills (string[]), projects ([{name, description, technologies: string[], achievements: string[], url}]),
experience ([{organization, title, start ("YYYY-MM" or null), end ("YYYY-MM" or null), current (boolean), description, achievements: string[], technologies: string[]}]),
links ({github, linkedin, portfolio}).`;

export async function extractProfileFromText(deps: Deps, text: string): Promise<ExtractionResult> {
  // eslint-disable-next-line no-control-regex -- strip NUL bytes from PDF text
  const trimmed = text.replace(/\u0000/g, '').slice(0, 30000);
  const heuristic = heuristicExtract(trimmed);
  const warnings: string[] = [];
  if (!trimmed.trim()) return { source: 'heuristic', suggested: {}, warnings: ['No text could be read from this résumé. If it is a scanned image, paste the text instead.'] };
  if (!deps.ai) {
    warnings.push('AI extraction is not configured on the server, so these suggestions come from simple pattern matching. Review them carefully.');
    return { source: 'heuristic', suggested: validated(heuristic, warnings), warnings };
  }
  try {
    const raw = await deps.ai.complete({ system: AI_SYSTEM, user: `<resume>\n${trimmed}\n</resume>`, maxTokens: 3000, temperature: 0, json: true });
    const obj = parseJsonObject(raw);
    if (!obj) throw new Error('unreadable');
    const withIds = {
      ...obj,
      projects: Array.isArray(obj.projects) ? (obj.projects as Record<string, unknown>[]).map((p) => ({ ...p, id: randomUUID().slice(0, 8), url: p.url || null })) : undefined,
      experience: Array.isArray(obj.experience) ? (obj.experience as Record<string, unknown>[]).map((e) => ({ ...e, id: randomUUID().slice(0, 8) })) : undefined,
      links: obj.links && typeof obj.links === 'object' ? { github: null, linkedin: null, portfolio: null, other: [], ...(obj.links as object) } : undefined,
    };
    const cleaned = Object.fromEntries(Object.entries(withIds).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)));
    const merged = { ...heuristic, ...cleaned } as Partial<ProfileUpdate>;
    return { source: 'ai', suggested: validated(merged, warnings), warnings: ['Extracted with AI from your résumé text. Check every field before saving.', ...warnings] };
  } catch {
    warnings.push('AI extraction failed, so these suggestions come from simple pattern matching. Review them carefully.');
    return { source: 'heuristic', suggested: validated(heuristic, warnings), warnings };
  }
}

/** Keep only fields that pass the same validation the profile endpoint uses. */
function validated(candidate: Partial<ProfileUpdate>, warnings: string[]): Partial<ProfileUpdate> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    const res = profilePatchSchema.safeParse({ [k]: v });
    if (res.success && (res.data as Record<string, unknown>)[k] !== undefined) out[k] = (res.data as Record<string, unknown>)[k];
    else if (!res.success) warnings.push(`Skipped "${k}" because it did not look valid.`);
  }
  return out as Partial<ProfileUpdate>;
}
