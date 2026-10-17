/**
 * Template variable substitution.
 *
 * v1 variables are still supported so existing saved templates keep working:
 *   {name} {company} {role} {year} {degree} {location} {user_name} {contact}
 * New variables are listed in TEMPLATE_VARIABLES.
 */

export const TEMPLATE_VARIABLES: ReadonlyArray<{ key: string; description: string }> = [
  { key: 'name', description: "Recruiter's full name (v1)" },
  { key: 'first_name', description: "Recruiter's first name" },
  { key: 'company', description: 'Company name' },
  { key: 'role', description: 'Role you are reaching out about (v1)' },
  { key: 'recruiter_title', description: "Recruiter's job title" },
  { key: 'user_name', description: 'Your full name (v1)' },
  { key: 'degree', description: 'Your degree (v1)' },
  { key: 'university', description: 'Your college / university' },
  { key: 'year', description: 'Graduation year (v1 used free text, e.g. "3rd")' },
  { key: 'location', description: 'Your current location (v1)' },
  { key: 'contact', description: 'Your phone / contact line (v1)' },
  { key: 'skills', description: 'Your skills most relevant to this role' },
  { key: 'project', description: 'Your most relevant project, one line' },
  { key: 'github', description: 'Your GitHub URL' },
  { key: 'linkedin', description: 'Your LinkedIn URL' },
  { key: 'portfolio', description: 'Your portfolio URL' },
];

export type TemplateVars = Partial<Record<string, string | null | undefined>>;

export interface CompiledTemplate {
  text: string;
  /** Known variables that were used but had no value (replaced with ""). */
  missing: string[];
  /** `{something}` tokens that are not known variables (left untouched). */
  unknown: string[];
}

const KNOWN = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
const TOKEN_RE = /\{([a-zA-Z_]+)\}/g;

export function compileTemplate(template: string | null | undefined, vars: TemplateVars): CompiledTemplate {
  if (!template) return { text: '', missing: [], unknown: [] };
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const text = template.replace(TOKEN_RE, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (!KNOWN.has(key)) {
      unknown.add(whole);
      return whole;
    }
    const value = vars[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing.add(key);
      return '';
    }
    return String(value);
  });
  return { text, missing: [...missing], unknown: [...unknown] };
}

/** Find leftover placeholders such as {company}, [Company Name], <NAME>, {{x}}. */
export function findPlaceholders(text: string): string[] {
  const found = new Set<string>();
  const patterns = [/\{\{?[A-Za-z_ ]{2,40}\}?\}/g, /\[(?:[A-Z][A-Za-z ]{1,40}|your [a-z ]{2,40}|insert [a-z ]{2,40})\]/g, /<(?:[A-Z_]{3,30})>/g];
  for (const re of patterns) for (const m of text.matchAll(re)) found.add(m[0]);
  return [...found];
}
