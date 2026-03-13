import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, testSupabaseConnection } from '../utils/supabase';

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const restoreSession = async () => {
            try {
                // ✅ Try a direct connection test first to debug "Invalid API Key"
                await testSupabaseConnection();

                const { data: { session: existingSession }, error } = await supabase.auth.getSession();

                if (existingSession) {
                    console.log('[Auth] ✅ Restored existing Supabase session');
                    setSession(existingSession);
                    setUser(existingSession.user ?? null);
                } else {
                    const stored = await new Promise(resolve => 
                        chrome.storage.local.get(['access_token', 'refresh_token'], resolve)
                    );

                    if (stored?.access_token && stored?.refresh_token) {
                        console.log('[Auth] Attempting restore from storage tokens...');
                        const { data, error: sessionError } = await supabase.auth.setSession({
                            access_token: stored.access_token,
                            refresh_token: stored.refresh_token,
                        });

                        if (!sessionError) {
                            console.log('[Auth) ✅ Session restored from storage');
                            setSession(data.session);
                            setUser(data.session?.user ?? null);
                        } else {
                            console.error('[Auth] Storage session restore failed:', sessionError.message);
                            chrome.storage.local.remove(['access_token', 'refresh_token', 'sessionToken']);
                        }
                    }
                }
            } catch (err) {
                console.error('[Auth] restoreSession unexpected error:', err);
            } finally {
                // ✅ CRITICAL: Always set loading to false to prevent blank screen
                setLoading(false);
            }
        };

        restoreSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
            setSession(newSession);
            setUser(newSession?.user ?? null);
            if (newSession?.access_token) {
                chrome.storage.local.set({
                    access_token: newSession.access_token,
                    refresh_token: newSession.refresh_token ?? null,
                    sessionToken: newSession.access_token
                });
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const signInWithGoogle = async () => {
        try {
            const redirectUrl = chrome.identity.getRedirectURL();
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
            });

            if (error) throw error;

            return new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { type: 'SIGN_IN_WITH_GOOGLE', url: data.url },
                    async (response) => {
                        if (response?.error) return resolve({ error: response.error });

                        const { access_token, refresh_token } = response;
                        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                            access_token,
                            refresh_token: refresh_token ?? '',
                        });

                        if (sessionError) return resolve({ error: sessionError.message });

                        setUser(sessionData.session?.user ?? null);
                        setSession(sessionData.session);
                        chrome.storage.local.set({
                            access_token,
                            refresh_token: refresh_token ?? null,
                            sessionToken: access_token,
                        });
                        resolve({ success: true });
                    }
                );
            });
        } catch (err) {
            return { error: err.message };
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        chrome.storage.local.remove(['sessionToken', 'access_token', 'refresh_token']);
        setUser(null);
        setSession(null);
    };

    return (
        <AuthContext.Provider value={{ user, session, loading, signInWithGoogle, signOut }}>
            {!loading && children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);