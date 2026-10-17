# AI drafting providers

AI is optional. Without it, the composer builds drafts from your own templates
(Settings → Templates) and profile, and everything else works the same. With it, drafts
are written from your verified profile facts, the job posting and the recruiter's details,
and you can ask for a more concise, more personal or more project-focused version.

API keys live **only on the API server** (`backend/.env` or the host's variables). The
dashboard and extension never see them.

## Configuration

```env
AI_PROVIDER=anthropic        # none | anthropic | openai | gemini | groq | openai_compatible
AI_MODEL=claude-haiku-5-5    # required: the provider's model ID
AI_API_KEY=...               # required except for some openai_compatible servers
AI_BASE_URL=                 # only for openai_compatible, or to override a default endpoint
AI_TIMEOUT_MS=45000
```

Check it worked: `GET /readyz` reports `integrations.ai`, and Settings → AI drafting shows
the provider and model.

| `AI_PROVIDER` | Endpoint used | Notes |
|---|---|---|
| `anthropic` | `https://api.anthropic.com/v1/messages` (`x-api-key`, `anthropic-version: 2023-06-01`) | e.g. `claude-haiku-5-5` (fast, inexpensive) or `claude-sonnet-5-5`. Keys: console.anthropic.com |
| `openai` | `https://api.openai.com/v1/chat/completions` (JSON mode) | Use a current chat model ID from platform.openai.com/docs/models |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (`x-goog-api-key`, JSON response type) | e.g. `gemini-3.8-flash`; see below. Model IDs: ai.google.dev/gemini-api/docs/models |
| `groq` | `https://api.groq.com/openai/v1/chat/completions` | e.g. `llama-3.3-70b-versatile`; see console.groq.com/docs/models |
| `openai_compatible` | `${AI_BASE_URL}/chat/completions` | Any OpenAI-compatible server, e.g. Ollama at `http://localhost:11434/v1` with `AI_MODEL=llama3.1`. `AI_API_KEY` optional |

### Gemini

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-3.8-flash      # or gemini-3.5-flash-lite (cheaper)
AI_API_KEY=...                 # from aistudio.google.com → Get API key
```

* Gemini 3 models always think before answering. AutoReach asks for
  `thinkingConfig.thinkingLevel: "low"` and adds 4,096 tokens of room to `maxOutputTokens`,
  because thinking counts against that limit. Gemini 2.5 models get a `thinkingBudget`
  (512 for Flash, 1,024 for Pro) instead. If a reply still comes back empty (finish reason
  `MAX_TOKENS`), the error says so.
* **Free tier and your data.** Google's pricing page lists the free tier of these models as
  "Used to improve our products: **Yes**" and the paid tier as "No"
  ([pricing](https://ai.google.dev/gemini-api/docs/pricing), checked 17 October 2026). On the
  free tier, the job descriptions, your profile facts and your drafts that AutoReach sends can
  be used by Google. Turn on billing for the key's project if you don't want that. Paid
  prices on that page: `gemini-3.8-flash` $0.75 input / $3.75 output per million tokens until
  31 December 2026 (then $1.50 / $7.50); `gemini-3.5-flash-lite` $0.30 / $2.50. Thinking
  tokens are billed too. Free-tier request limits are shown in AI Studio, not in the docs.

Model names change; use the provider's current model list. A wrong model ID or key shows up
as an error in the composer; **Use my template** still builds a draft without AI.

## What is sent to the provider

When you press **Read job description**, the job page writes an email, or you press
**Generate**, a refine action, or **Fill from résumé**:

* reading a job description sends **only the text you pasted** (not your profile);
* for emails: your profile facts (name, education, skills, projects and achievements, experience, links);
* the recruiter's name, title and company;
* the job title, description and company notes you saved, and the confirmed reading of the
  job (priorities with their quotes, skills, experience) plus which of its skills your profile
  lists;
* your earlier AutoReach emails to that recruiter (for follow-ups);
* your tone, goal, writing-style notes and template (as a style reference);
* for "Fill from résumé", the résumé text.

Nothing read from Gmail is ever sent. Provider data-retention terms apply to what is sent;
check them before enabling a provider.

## How drafts are kept honest

* The model is told to use only the numbered facts it is given, to mention at most two
  projects, to keep numbers verbatim, to avoid invented referrals or prior conversations,
  and to return JSON.
* Every draft (AI or template) then goes through the same quality check as anything you
  type: wrong company or recipient name, leftover placeholders, numbers or skills that
  aren't in your profile or the posting, claimed referrals, too long or too generic,
  missing or unmentioned attachment, already contacted. Errors must be fixed or explicitly
  overridden before sending.
* "How this draft was made" lists the facts the model says it used.
* On the job page, the reading of the job description is checked against the pasted text
  before you see it: skills that aren't in the text are dropped, each priority must quote the
  text word for word, responsibilities must mostly use its words, a minimum number of years
  must be written next to "year(s)", and the company and role must appear in it. The email
  prompt names only the skills from the posting that your profile lists (for "Java / Kotlin"
  only the one you have) and says never to mention missing skills.
* Drafts are never sent automatically. Automatic follow-ups (off by default) only ever use
  your own follow-up template, never AI text.

## Cost and limits

Each Generate, refine or résumé suggestion is one request to the provider. The API
rate-limits AI requests per user (`limiters.ai` in `backend/src/app.ts`). If a provider times
out, rate-limits or returns something that isn't valid JSON, the composer shows the error and
**Use my template** still works.
