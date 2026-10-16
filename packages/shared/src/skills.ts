/**
 * A compact technology lexicon used for:
 *  - extracting required skills from job descriptions,
 *  - matching a candidate's verified skills against a role,
 *  - flagging drafts that mention technologies the candidate never listed.
 *
 * Ambiguous words ("Go", "Swift", "Express", "Spring", "Dart") are matched
 * case-sensitively or only in unambiguous forms to avoid false positives.
 */

interface SkillEntry {
  name: string;
  aliases: string[];
  caseSensitive?: boolean;
  /** Extra hand-written patterns for words that are ambiguous in prose. */
  patterns?: RegExp[];
}

export const SKILL_LEXICON: readonly SkillEntry[] = [
  // Languages
  { name: 'JavaScript', aliases: ['javascript', 'js', 'es6', 'ecmascript'] },
  { name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { name: 'Python', aliases: ['python', 'python3'] },
  { name: 'Java', aliases: ['java'] },
  { name: 'C++', aliases: ['c++', 'cpp'] },
  { name: 'C#', aliases: ['c#', 'csharp'] },
  { name: 'C', aliases: ['C programming', 'C language', 'ANSI C'], caseSensitive: true },
  {
    name: 'Go',
    aliases: ['golang', 'go language', 'go programming'],
    // "Go" only when it appears as a list item: "Python, Go, Java" / "Go/Rust" / "(Go)"
    patterns: [/(?:^|[,/(;|]\s*|\b(?:or|and)\s+)Go(?=\s*(?:[,/);|]|$))/gm],
  },
  { name: 'Rust', aliases: ['rust'] },
  { name: 'Kotlin', aliases: ['kotlin'] },
  { name: 'Swift', aliases: ['Swift', 'SwiftUI'], caseSensitive: true },
  { name: 'Dart', aliases: ['Dart'], caseSensitive: true },
  { name: 'Ruby', aliases: ['ruby'] },
  { name: 'PHP', aliases: ['php'] },
  { name: 'Scala', aliases: ['scala'] },
  { name: 'R', aliases: ['R programming', 'R language', 'RStudio'], caseSensitive: true },
  { name: 'SQL', aliases: ['sql'] },
  { name: 'Bash', aliases: ['bash', 'shell scripting'] },
  { name: 'HTML', aliases: ['html', 'html5'] },
  { name: 'CSS', aliases: ['css', 'css3'] },
  // Frontend
  { name: 'React', aliases: ['react', 'react.js', 'reactjs'] },
  { name: 'Next.js', aliases: ['next.js', 'nextjs'] },
  { name: 'Vue', aliases: ['vue', 'vue.js', 'vuejs'] },
  { name: 'Angular', aliases: ['angular', 'angularjs'] },
  { name: 'Svelte', aliases: ['svelte', 'sveltekit'] },
  { name: 'Redux', aliases: ['redux'] },
  { name: 'Tailwind CSS', aliases: ['tailwind', 'tailwindcss', 'tailwind css'] },
  { name: 'React Native', aliases: ['react native', 'react-native'] },
  { name: 'Flutter', aliases: ['flutter'] },
  // Backend
  { name: 'Node.js', aliases: ['node.js', 'nodejs', 'node js'] },
  { name: 'Express', aliases: ['express.js', 'expressjs'] },
  { name: 'NestJS', aliases: ['nestjs', 'nest.js'] },
  { name: 'Django', aliases: ['django'] },
  { name: 'Flask', aliases: ['flask'] },
  { name: 'FastAPI', aliases: ['fastapi'] },
  { name: 'Spring Boot', aliases: ['spring boot', 'springboot'] },
  { name: '.NET', aliases: ['.net', 'dotnet', 'asp.net'] },
  { name: 'Ruby on Rails', aliases: ['rails', 'ruby on rails'] },
  { name: 'GraphQL', aliases: ['graphql'] },
  { name: 'REST APIs', aliases: ['rest api', 'rest apis', 'restful'] },
  { name: 'gRPC', aliases: ['grpc'] },
  { name: 'Microservices', aliases: ['microservices', 'microservice'] },
  // Data stores
  { name: 'PostgreSQL', aliases: ['postgresql', 'postgres'] },
  { name: 'MySQL', aliases: ['mysql'] },
  { name: 'MongoDB', aliases: ['mongodb', 'mongo'] },
  { name: 'Redis', aliases: ['redis'] },
  { name: 'Firebase', aliases: ['firebase', 'firestore'] },
  { name: 'Supabase', aliases: ['supabase'] },
  { name: 'Elasticsearch', aliases: ['elasticsearch'] },
  { name: 'Kafka', aliases: ['kafka'] },
  // Cloud / DevOps
  { name: 'AWS', aliases: ['aws', 'amazon web services', 'ec2', 's3', 'lambda'] },
  { name: 'Google Cloud', aliases: ['gcp', 'google cloud'] },
  { name: 'Azure', aliases: ['azure'] },
  { name: 'Docker', aliases: ['docker'] },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'] },
  { name: 'Terraform', aliases: ['terraform'] },
  { name: 'CI/CD', aliases: ['ci/cd', 'github actions', 'jenkins', 'gitlab ci'] },
  { name: 'Linux', aliases: ['linux'] },
  { name: 'Git', aliases: ['git', 'github', 'gitlab'] },
  { name: 'Vercel', aliases: ['vercel'] },
  // AI / ML / Data
  { name: 'Machine Learning', aliases: ['machine learning', 'ml'] },
  { name: 'Deep Learning', aliases: ['deep learning'] },
  { name: 'PyTorch', aliases: ['pytorch'] },
  { name: 'TensorFlow', aliases: ['tensorflow', 'keras'] },
  { name: 'scikit-learn', aliases: ['scikit-learn', 'sklearn'] },
  { name: 'Pandas', aliases: ['pandas'] },
  { name: 'NumPy', aliases: ['numpy'] },
  { name: 'NLP', aliases: ['nlp', 'natural language processing'] },
  { name: 'Computer Vision', aliases: ['computer vision', 'opencv'] },
  { name: 'LLMs', aliases: ['llm', 'llms', 'large language models', 'langchain', 'rag', 'prompt engineering'] },
  { name: 'Data Analysis', aliases: ['data analysis', 'data analytics'] },
  { name: 'Spark', aliases: ['apache spark', 'pyspark'] },
  // Testing
  { name: 'Jest', aliases: ['jest'] },
  { name: 'Playwright', aliases: ['playwright'] },
  { name: 'Cypress', aliases: ['cypress'] },
  { name: 'Selenium', aliases: ['selenium'] },
  { name: 'Unit testing', aliases: ['unit testing', 'unit tests', 'tdd'] },
  // CS fundamentals
  { name: 'Data Structures & Algorithms', aliases: ['data structures', 'algorithms', 'dsa'] },
  { name: 'System Design', aliases: ['system design'] },
  { name: 'Operating Systems', aliases: ['operating systems'] },
  { name: 'DBMS', aliases: ['dbms', 'database management'] },
  { name: 'OOP', aliases: ['oop', 'object-oriented', 'object oriented'] },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

interface CompiledSkill {
  name: string;
  patterns: RegExp[];
}

const COMPILED: CompiledSkill[] = SKILL_LEXICON.map((entry) => ({
  name: entry.name,
  patterns: [
    ...entry.aliases.map(
      (alias) =>
        new RegExp(`(?<![A-Za-z0-9+#.])${escapeRegex(alias)}(?![A-Za-z0-9+#]|\\.[A-Za-z])`, entry.caseSensitive ? 'g' : 'gi'),
    ),
    ...(entry.patterns ?? []),
  ],
}));

/** Return canonical skill names mentioned in free text, in lexicon order. */
export function extractSkills(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const skill of COMPILED) {
    if (skill.patterns.some((re) => {
      re.lastIndex = 0;
      return re.test(text);
    })) {
      found.push(skill.name);
    }
  }
  return found;
}

const CANONICAL_LOOKUP = new Map<string, string>();
for (const entry of SKILL_LEXICON) {
  CANONICAL_LOOKUP.set(entry.name.toLowerCase(), entry.name);
  for (const alias of entry.aliases) {
    if (!CANONICAL_LOOKUP.has(alias.toLowerCase())) CANONICAL_LOOKUP.set(alias.toLowerCase(), entry.name);
  }
}

/** Map a user-typed skill to its canonical name when we know it, else return it trimmed. */
export function canonicalSkill(raw: string): string {
  const trimmed = raw.trim();
  return CANONICAL_LOOKUP.get(trimmed.toLowerCase()) ?? trimmed;
}

export function canonicalSkillSet(skills: readonly string[]): Set<string> {
  return new Set(skills.map((s) => canonicalSkill(s).toLowerCase()));
}

export interface SkillMatch {
  /** Skills the job asks for that the candidate has listed. */
  matched: string[];
  /** Skills the job asks for that the candidate has NOT listed. */
  missing: string[];
  /** Number of skills considered from the job. */
  considered: number;
}

/**
 * Compare a candidate's verified skills (profile + project tech) against
 * the skills a job lists. Pure counting — no invented scores.
 */
export function matchSkills(candidateSkills: readonly string[], jobSkills: readonly string[]): SkillMatch {
  const have = canonicalSkillSet(candidateSkills);
  const job = [...new Set(jobSkills.map((s) => canonicalSkill(s)))];
  const matched = job.filter((s) => have.has(s.toLowerCase()));
  const missing = job.filter((s) => !have.has(s.toLowerCase()));
  return { matched, missing, considered: job.length };
}
