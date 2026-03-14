import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabase } from '../server.js';

const router = express.Router();

router.get('/me', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        res.json({ user: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/setup', requireAuth, async (req, res) => {
    try {
        const { name, degree, year, location, contact } = req.body;

        const { data, error } = await supabase
            .from('users')
            .upsert({
                id: req.user.id,
                name,
                degree,
                year,
                location,
                contact
            }, { onConflict: 'id' })
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, user: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
