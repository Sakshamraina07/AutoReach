-- AutoReach 2.0.1: bind Gmail OAuth completion to the account that started it.
--
-- The Google redirect no longer completes the connection by itself. It hands
-- code + state back to the signed-in dashboard (or the extension), which then
-- calls POST /api/integrations/gmail/complete; the API only accepts a state
-- created by that same user. return_url holds the extension's
-- https://<id>.chromiumapp.org/ redirect when the flow started there.

alter table public.oauth_states add column if not exists return_url text;
