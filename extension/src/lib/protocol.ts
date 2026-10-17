/**
 * Messages between extension pages / content scripts and the service worker.
 * The service worker owns the session and makes every API call, so tokens
 * never reach a web page (the Gmail content script only gets results).
 */
import type { CapturedPage } from './capture';

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

export interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export type ApiResult<T = unknown> = { ok: true; status: number; data: T } | { ok: false; error: ApiErrorShape };

export interface AuthState {
  signedIn: boolean;
  email: string | null;
  mode: 'supabase' | 'dev' | null;
}

export type Message =
  | { type: 'auth:get' }
  | { type: 'auth:signIn' }
  | { type: 'auth:devSignIn'; email: string }
  | { type: 'auth:signOut' }
  | { type: 'api'; request: ApiRequest }
  | { type: 'badge:refresh' }
  | { type: 'capture:page'; tabId: number }
  | { type: 'compose:open'; prefill: ComposePrefill }
  | { type: 'gmail:lookup'; emails: string[] }
  | { type: 'gmail:selfView'; emails: string[] }
  | { type: 'gmail:insert'; tabId: number; subject: string; body: string }
  | { type: 'gmail:connect' };

/** What a composer should start with (from the popup or the Gmail assist). */
export interface ComposePrefill {
  recruiterId?: string;
  recruiterEmail?: string;
  recruiterName?: string;
  opportunityId?: string;
  /** Open an existing draft, or create the draft for a due follow-up. */
  draftId?: string;
  followUpId?: string;
  from?: 'popup' | 'gmail';
}

export type MessageResponse<M extends Message> = M extends { type: 'auth:get' | 'auth:signIn' | 'auth:devSignIn' | 'auth:signOut' }
  ? { ok: true; auth: AuthState } | { ok: false; error: ApiErrorShape }
  : M extends { type: 'api' | 'gmail:lookup' }
    ? ApiResult
    : M extends { type: 'capture:page' }
      ? { ok: true; page: CapturedPage } | { ok: false; error: ApiErrorShape }
      : M extends { type: 'gmail:connect' }
        ? { ok: true; email: string } | { ok: false; error: ApiErrorShape }
        : { ok: true } | { ok: false; error: ApiErrorShape };

export const PREFILL_KEY = 'autoreach.composePrefill';
/** In chrome.storage.sync: the only setting the Gmail content script may read (local storage holds the session and is closed to it). */
export const GMAIL_ASSIST_KEY = 'autoreach.gmailAssist';
