import type { RoleCategory } from './enums.js';

/**
 * Classify a job title (and optionally description) into a role category for
 * analytics ("performance by role category") and prompt framing. Ordered rules:
 * the first matching rule wins, title is checked before description.
 */
const RULES: Array<{ category: RoleCategory; re: RegExp }> = [
  { category: 'ai_ml', re: /\b(ai|a\.i\.|ml|machine learning|deep learning|llm|nlp|computer vision|data scien\w*|applied scien\w*|genai|generative ai)\b/i },
  { category: 'data', re: /\b(data engineer\w*|data analyst|analytics engineer|business intelligence|bi developer|etl)\b/i },
  { category: 'fullstack', re: /\b(full[\s-]?stack|mern|mean stack)\b/i },
  { category: 'frontend', re: /\b(front[\s-]?end|ui engineer|ui developer|web developer|react developer|angular developer|vue developer)\b/i },
  { category: 'backend', re: /\b(back[\s-]?end|api engineer|server[\s-]side|platform engineer|java developer|node(\.js)? developer|golang developer|python developer)\b/i },
  { category: 'mobile', re: /\b(mobile|android|ios|flutter|react native)\b/i },
  { category: 'devops_cloud', re: /\b(devops|sre|site reliability|cloud engineer|infrastructure|platform reliability)\b/i },
  { category: 'security', re: /\b(security|appsec|cyber\w*|penetration)\b/i },
  { category: 'qa', re: /\b(qa|quality assurance|sdet|test engineer|automation tester)\b/i },
  { category: 'embedded', re: /\b(embedded|firmware|systems engineer|kernel|fpga)\b/i },
  {
    category: 'general_swe',
    re: /\b(software|sde|swe|developer|programmer|engineer(ing)? (intern|trainee|fresher)|graduate engineer|associate engineer|member of technical staff|mts)\b/i,
  },
];

export function classifyRoleCategory(title: string | null | undefined, description?: string | null): RoleCategory {
  const t = (title ?? '').trim();
  if (!t && !description) return 'speculative';
  for (const rule of RULES) if (t && rule.re.test(t)) return rule.category;
  if (description) {
    // Only use the description for the more specific categories.
    for (const rule of RULES.slice(0, -1)) if (rule.re.test(description.slice(0, 2000))) return rule.category;
  }
  return t ? 'other' : 'speculative';
}

/** Extract an experience requirement phrase like "0-2 years" from a description. */
export function extractExperienceRequirement(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = description.match(/\b(\d{1,2})\s*(?:\+|-|–|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+\w+){0,3}?\s*(?:experience|exp)?/i);
  if (m) return m[0].trim();
  if (/\b(fresher|freshers|new grad|recent graduate|entry[\s-]level|no experience required)\b/i.test(description)) return 'Entry level / freshers';
  return null;
}
