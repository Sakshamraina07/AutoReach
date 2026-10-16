/** Build-time configuration (Vite env). No secrets live here: the anon key is public by design. */
export const config = {
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? 'http://localhost:3001',
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  /** Local development only; the API refuses dev login in production. */
  devLogin: import.meta.env.VITE_DEV_LOGIN === 'true',
  extensionInstallUrl: (import.meta.env.VITE_EXTENSION_URL as string | undefined) ?? 'https://github.com/Sakshamraina07/AutoReach#chrome-extension',
};

export const supabaseConfigured = !!config.supabaseUrl && !!config.supabaseAnonKey;
