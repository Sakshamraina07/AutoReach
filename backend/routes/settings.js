import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../server.js';

const router = express.Router();

// POST /settings/gmail/exchange
router.post('/gmail/exchange', requireAuth, async (req, res) => {
    try {
        const { code, redirect_uri } = req.body;

        if (!code || !redirect_uri) {
            return res.status(400).json({ error: 'Missing code or redirect_uri' });
        }

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri,
                grant_type: 'authorization_code',
            }),
        });

        const tokens = await tokenRes.json();

        if (!tokenRes.ok || !tokens.access_token) {
            console.error('[Settings] Token exchange failed:', tokens);
            return res.status(400).json({ error: tokens.error_description || 'Token exchange failed' });
        }

        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const profile = await profileRes.json();

        if (!profileRes.ok || !profile.email) {
            return res.status(400).json({ error: 'Could not fetch Gmail user email' });
        }

        const token_expires_at = tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null;

        const { error: dbError } = await supabaseAdmin
            .from('user_smtp_settings')
            .upsert({
                user_id: req.user.id,
                gmail_user: profile.email,
                gmail_access_token: tokens.access_token,
                gmail_refresh_token: tokens.refresh_token || null,
                token_expires_at,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id' });

        if (dbError) throw dbError;

        console.log(`[Settings] Gmail tokens saved for ${profile.email} (user ${req.user.id})`);
        res.json({ success: true, gmail_user: profile.email });

    } catch (err) {
        console.error('[Settings] Gmail exchange error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /settings/gmail/disconnect
router.delete('/gmail/disconnect', requireAuth, async (req, res) => {
    try {
        const { error } = await supabaseAdmin
            .from('user_smtp_settings')
            .delete()
            .eq('user_id', req.user.id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /settings/gmail/status
router.get('/gmail/status', requireAuth, async (req, res) => {
    try {
        const { data } = await supabaseAdmin
            .from('user_smtp_settings')
            .select('gmail_user, token_expires_at')
            .eq('user_id', req.user.id)
            .single();

        res.json({
            connected: !!data?.gmail_user,
            gmail_user: data?.gmail_user || null,
            token_expires_at: data?.token_expires_at || null,
        });
    } catch (err) {
        res.json({ connected: false, gmail_user: null });
    }
});

export default router;