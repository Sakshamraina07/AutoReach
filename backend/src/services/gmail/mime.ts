import { randomBytes } from 'node:crypto';

/**
 * RFC 5322 / 2045 / 2047 / 2231 message builder for Gmail's `messages.send`.
 * Produces multipart/mixed { multipart/alternative { text/plain, text/html }, attachments }.
 */

export interface MimeAddress {
  email: string;
  name?: string | null;
}

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface MimeInput {
  from: MimeAddress;
  to: MimeAddress;
  subject: string;
  text: string;
  html: string;
  attachments?: MimeAttachment[];
  messageId?: string;
  inReplyTo?: string | null;
  references?: string[];
  date?: Date;
}

const CRLF = '\r\n';

function isPrintableAscii(s: string): boolean {
  return /^[\x20-\x7e]*$/.test(s);
}

function stripHeaderBreaks(s: string): string {
  // Header injection guard: no CR/LF may survive into a header value.
  return s.replace(/[\r\n]+/g, ' ').trim();
}

/** RFC 2047 encoded-words, split on character boundaries so UTF-8 sequences stay intact. */
export function encodeHeaderWords(value: string): string {
  const v = stripHeaderBreaks(value);
  if (isPrintableAscii(v)) return v;
  const words: string[] = [];
  let chunk = '';
  for (const ch of v) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

export function formatAddress(a: MimeAddress): string {
  const email = stripHeaderBreaks(a.email);
  if (!/^[^\s<>@,;"]+@[^\s<>@,;"]+$/.test(email)) throw new Error('Invalid email address for MIME header');
  const name = a.name ? stripHeaderBreaks(a.name) : '';
  if (!name) return email;
  if (isPrintableAscii(name)) return `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>`;
  return `${encodeHeaderWords(name)} <${email}>`;
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, (m) => `${m}${CRLF}`).trimEnd();
}

function encodeFilenameParams(filename: string): string {
  const safe = stripHeaderBreaks(filename).replace(/["\\]/g, '_');
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
  if (ascii === safe) return `filename="${ascii}"`;
  const pct = encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `filename="${ascii}"; filename*=UTF-8''${pct}`;
}

function boundary(): string {
  return `=_ar_${randomBytes(12).toString('hex')}`;
}

export function buildMime(input: MimeInput): string {
  const mixed = boundary();
  const alt = boundary();
  const headers = [
    `From: ${formatAddress(input.from)}`,
    `To: ${formatAddress(input.to)}`,
    `Subject: ${encodeHeaderWords(input.subject)}`,
    `Date: ${(input.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
  ];
  if (input.messageId) headers.push(`Message-ID: ${stripHeaderBreaks(input.messageId)}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${stripHeaderBreaks(input.inReplyTo)}`);
  if (input.references?.length) headers.push(`References: ${input.references.map(stripHeaderBreaks).join(' ')}`);
  headers.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);

  const parts: string[] = [];
  parts.push(
    [
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      '',
      `--${alt}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(Buffer.from(input.text, 'utf8').toString('base64')),
      `--${alt}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(Buffer.from(input.html, 'utf8').toString('base64')),
      `--${alt}--`,
    ].join(CRLF),
  );
  for (const att of input.attachments ?? []) {
    const mimeType = /^[a-z]+\/[a-z0-9.+-]+$/i.test(att.mimeType) ? att.mimeType : 'application/octet-stream';
    parts.push(
      [
        `--${mixed}`,
        `Content-Type: ${mimeType}; name="${stripHeaderBreaks(att.filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; ${encodeFilenameParams(att.filename)}`,
        '',
        wrap76(att.data.toString('base64')),
      ].join(CRLF),
    );
  }
  return `${headers.join(CRLF)}${CRLF}${CRLF}${parts.join(CRLF)}${CRLF}--${mixed}--${CRLF}`;
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/* ------------------------------------------------------------------ */
/* Plain text → safe HTML                                              */
/* ------------------------------------------------------------------ */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<>&"']+(?:&amp;[^\s<>&"']+)*/g, (url) => {
    const trimmed = url.replace(/[.,;:!?)]+$/, '');
    const tail = url.slice(trimmed.length);
    return `<a href="${trimmed}">${trimmed}</a>${tail}`;
  });
}

/** Convert the user's plain-text email to minimal HTML; optionally append a tracking pixel. */
export function textToHtml(text: string, trackingPixelUrl?: string | null): string {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 1em 0">${linkify(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const pixel = trackingPixelUrl ? `\n<img src="${escapeHtml(trackingPixelUrl)}" width="1" height="1" alt="" style="width:1px;height:1px;border:0">` : '';
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">\n${paragraphs}${pixel}\n</body></html>`;
}
