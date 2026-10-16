import { randomUUID } from 'node:crypto';
import type { Resume } from '@autoreach/shared';
import { extractText } from 'unpdf';
import type { Tx } from '../db/pool.js';
import { badRequest, notFound, unprocessable } from '../errors.js';
import { sha256Hex } from '../lib/crypto.js';
import type { FileStorage } from '../storage/index.js';

export const MAX_RESUME_BYTES = 10 * 1024 * 1024; // Gmail's limit is 25 MB per message; résumés never need more than this.
const ATTACHABLE_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const RESUME_COLUMNS = `id, label, file_name, mime_type, size_bytes, sha256, role_tags, is_default,
  (extracted_text IS NOT NULL AND length(extracted_text) > 0) AS has_text, legacy, created_at`;

export function isPdf(buf: Buffer): boolean {
  return buf.length > 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

export function sanitizeFileName(name: string, fallback = 'Resume.pdf'): string {
  const cleaned = name
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex -- control characters are invalid in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const { text } = await extractText(new Uint8Array(Buffer.from(buf)), { mergePages: true });
    // eslint-disable-next-line no-control-regex -- strip NUL bytes from PDF text
    return text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 60000);
  } catch {
    return '';
  }
}

export async function listResumes(tx: Tx, userId: string): Promise<Resume[]> {
  return tx.many<Resume>(`SELECT ${RESUME_COLUMNS} FROM resumes WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`, [userId]);
}

export async function uploadResume(
  tx: Tx,
  storage: FileStorage,
  userId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  meta: { label?: string; role_tags?: string[]; make_default?: boolean },
): Promise<Resume> {
  if (!file.buffer?.length) throw badRequest('The uploaded file is empty.', undefined, 'EMPTY_FILE');
  if (file.size > MAX_RESUME_BYTES) throw badRequest('Résumés must be 10 MB or smaller.', undefined, 'FILE_TOO_LARGE');
  if (!isPdf(file.buffer)) throw badRequest('Upload your résumé as a PDF file.', undefined, 'NOT_A_PDF');

  const id = randomUUID();
  const storagePath = `${userId}/${id}.pdf`;
  const sha256 = sha256Hex(file.buffer);
  const fileName = sanitizeFileName(file.originalname.toLowerCase().endsWith('.pdf') ? file.originalname : `${file.originalname}.pdf`);
  const text = await extractPdfText(file.buffer);

  await storage.put(storagePath, file.buffer, 'application/pdf');
  try {
    const existingCount = (await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM resumes WHERE user_id = $1`, [userId])).n;
    const makeDefault = meta.make_default || existingCount === 0;
    if (makeDefault) await tx.query(`UPDATE resumes SET is_default = false WHERE user_id = $1 AND is_default`, [userId]);
    const row = await tx.one<Resume>(
      `INSERT INTO resumes (id, user_id, label, file_name, storage_path, mime_type, size_bytes, sha256, extracted_text, role_tags, is_default)
       VALUES ($1,$2,$3,$4,$5,'application/pdf',$6,$7,$8,$9,$10) RETURNING ${RESUME_COLUMNS}`,
      [id, userId, (meta.label ?? 'Résumé').slice(0, 80), fileName, storagePath, file.size, sha256, text || null, meta.role_tags ?? [], makeDefault],
    );
    if (makeDefault) await tx.query(`UPDATE user_settings SET default_resume_id = $2 WHERE user_id = $1`, [userId, id]);
    return row;
  } catch (err) {
    // Keep storage consistent with the database.
    await storage.remove([storagePath]).catch(() => {});
    throw err;
  }
}

export async function updateResume(
  tx: Tx,
  userId: string,
  id: string,
  patch: { label?: string; role_tags?: string[]; is_default?: boolean },
): Promise<Resume> {
  const exists = await tx.maybeOne(`SELECT 1 FROM resumes WHERE user_id = $1 AND id = $2`, [userId, id]);
  if (!exists) throw notFound('Résumé');
  if (patch.label !== undefined) await tx.query(`UPDATE resumes SET label = $3 WHERE user_id = $1 AND id = $2`, [userId, id, patch.label]);
  if (patch.role_tags !== undefined) await tx.query(`UPDATE resumes SET role_tags = $3 WHERE user_id = $1 AND id = $2`, [userId, id, patch.role_tags]);
  if (patch.is_default) {
    await tx.query(`UPDATE resumes SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2`, [userId, id]);
    await tx.query(`UPDATE resumes SET is_default = true WHERE user_id = $1 AND id = $2`, [userId, id]);
    await tx.query(`UPDATE user_settings SET default_resume_id = $2 WHERE user_id = $1`, [userId, id]);
  }
  return tx.one<Resume>(`SELECT ${RESUME_COLUMNS} FROM resumes WHERE user_id = $1 AND id = $2`, [userId, id]);
}

export async function deleteResume(tx: Tx, storage: FileStorage, userId: string, id: string): Promise<void> {
  const row = await tx.maybeOne<{ storage_path: string; is_default: boolean; legacy: boolean }>(
    `DELETE FROM resumes WHERE user_id = $1 AND id = $2 RETURNING storage_path, is_default, legacy`,
    [userId, id],
  );
  if (!row) throw notFound('Résumé');
  if (row.is_default) {
    const next = await tx.maybeOne<{ id: string }>(`SELECT id FROM resumes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
    if (next) await tx.query(`UPDATE resumes SET is_default = true WHERE id = $1`, [next.id]);
    await tx.query(`UPDATE user_settings SET default_resume_id = $2 WHERE user_id = $1`, [userId, next?.id ?? null]);
  }
  await storage.remove([row.storage_path]);
}

export interface VerifiedAttachment {
  resumeId: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
  sizeBytes: number;
  sha256: string;
}

/**
 * Load the exact résumé file and verify it before attaching: it must exist in
 * private storage, be within size limits, be an attachable type, and match the
 * checksum recorded at upload (legacy v1 files get their checksum recorded on
 * first verification).
 */
export async function loadVerifiedAttachment(tx: Tx, storage: FileStorage, userId: string, resumeId: string): Promise<VerifiedAttachment> {
  const row = await tx.maybeOne<{ id: string; file_name: string; storage_path: string; mime_type: string; sha256: string | null; legacy: boolean }>(
    `SELECT id, file_name, storage_path, mime_type, sha256, legacy FROM resumes WHERE user_id = $1 AND id = $2`,
    [userId, resumeId],
  );
  if (!row) throw unprocessable('RESUME_NOT_FOUND', 'The selected résumé no longer exists. Choose another one.');
  const data = await storage.get(row.storage_path);
  if (!data) throw unprocessable('RESUME_FILE_MISSING', `The file for "${row.file_name}" is missing from storage. Upload it again.`);
  if (data.length === 0) throw unprocessable('RESUME_FILE_EMPTY', `The file for "${row.file_name}" is empty. Upload it again.`);
  if (data.length > MAX_RESUME_BYTES) throw unprocessable('RESUME_TOO_LARGE', 'The résumé is larger than 10 MB.');
  if (!ATTACHABLE_MIME.has(row.mime_type)) throw unprocessable('RESUME_TYPE_UNSUPPORTED', 'The résumé file type cannot be attached.');
  if (row.mime_type === 'application/pdf' && !isPdf(data)) throw unprocessable('RESUME_CORRUPT', 'The stored résumé is not a valid PDF. Upload it again.');
  const sha = sha256Hex(data);
  if (row.sha256 && row.sha256 !== sha) throw unprocessable('RESUME_CHECKSUM_MISMATCH', 'The stored résumé changed since upload. Upload it again.');
  if (!row.sha256) {
    const text = row.mime_type === 'application/pdf' ? await extractPdfText(data) : '';
    await tx.query(`UPDATE resumes SET sha256 = $3, size_bytes = $4, extracted_text = COALESCE(extracted_text, $5) WHERE user_id = $1 AND id = $2`, [
      userId,
      resumeId,
      sha,
      data.length,
      text || null,
    ]);
  }
  return { resumeId: row.id, fileName: row.file_name, mimeType: row.mime_type, data, sizeBytes: data.length, sha256: sha };
}

export async function getResumeText(tx: Tx, userId: string, resumeId: string): Promise<string | null> {
  const row = await tx.maybeOne<{ extracted_text: string | null }>(`SELECT extracted_text FROM resumes WHERE user_id = $1 AND id = $2`, [userId, resumeId]);
  return row?.extracted_text ?? null;
}

export async function getResumeFile(tx: Tx, storage: FileStorage, userId: string, id: string) {
  const row = await tx.maybeOne<{ file_name: string; storage_path: string; mime_type: string }>(
    `SELECT file_name, storage_path, mime_type FROM resumes WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  if (!row) throw notFound('Résumé');
  const data = await storage.get(row.storage_path);
  if (!data) throw notFound('Résumé file');
  return { ...row, data };
}
