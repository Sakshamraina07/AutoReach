import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../server.js';

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
    try {
        const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(req.user.id);

        if (error || !user) return res.status(404).json({ error: 'User not found' });

        res.json({
            user: {
                id: user.id,
                email: user.email,
                name: user.user_metadata?.name || '',
                degree: user.user_metadata?.degree || '',
                year: user.user_metadata?.year || '',
                location: user.user_metadata?.location || '',
                contact: user.user_metadata?.contact || '',
                resume_url: user.user_metadata?.resume_url || null,
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/setup', requireAuth, async (req, res) => {
    try {
        const { name, degree, year, location, contact } = req.body;

        const { data: { user }, error } = await supabaseAdmin.auth.admin.updateUserById(
            req.user.id,
            {
                user_metadata: { name, degree, year, location, contact }
            }
        );

        if (error) throw error;

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.user_metadata?.name || '',
                degree: user.user_metadata?.degree || '',
                year: user.user_metadata?.year || '',
                location: user.user_metadata?.location || '',
                contact: user.user_metadata?.contact || '',
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;