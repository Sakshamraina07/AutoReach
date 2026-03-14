import express from 'express';
import { supabaseAdmin } from '../server.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Save user's Gmail SMTP credentials
router.post('/smtp', requireAuth, async (req, res) => {
    const { gmail_user, gmail_app_password } = req.body;

    if (!gmail_user || !gmail_app_password) {
        return res.status(400).json({ error: 'Gmail and App Password are required' });
    }

    const { error } = await supabaseAdmin
        .from('user_smtp_settings')
        .upsert({
            user_id: req.user.id,
            gmail_user,
            gmail_app_password
        }, { onConflict: 'user_id' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: 'Gmail connected successfully' });
});

// Get user's connected Gmail (without exposing password)
router.get('/smtp', requireAuth, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('user_smtp_settings')
        .select('gmail_user, created_at')
        .eq('user_id', req.user.id)
        .single();

    if (error) return res.status(404).json({ connected: false });
    res.json({ connected: true, gmail_user: data.gmail_user });
});

export default router;