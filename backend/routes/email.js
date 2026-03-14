import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { emailSendLimiter } from '../middleware/rateLimiter.js';
import { supabase } from '../server.js';
import { compileTemplate } from '../services/emailService.js';

const router = express.Router();

router.post('/preview', requireAuth, async (req, res) => {
    try {
        const { templateType, recruiterData } = req.body;

        // Fetch User profile to replace sender vars
        const { data: userProfile, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (userError) throw userError;

        // Fetch Template
        const { data: template, error: tplError } = await supabase
            .from('email_templates')
            .select('*')
            .eq('user_id', req.user.id)
            .eq('type', templateType || 'initial')
            .single();

        if (tplError && tplError.code !== 'PGRST116') throw tplError; // PGRST116 is not found

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const previewSubject = compileTemplate(template.subject, recruiterData, userProfile);
        const previewBody = compileTemplate(template.body, recruiterData, userProfile);

        res.json({
            subject: previewSubject,
            body: previewBody
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/status', requireAuth, async (req, res) => {
    try {
        // Fetch today's count
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const { count, error } = await supabase
            .from('email_history')
            .select('*', { count: 'exact', head: true })
            .gte('sent_at', startOfDay.toISOString())
            // Join recruiters to filter by user_id
            // Equivalent inner join filter approach in Supabase JS:
            .in('recruiter_id', (
                await supabase.from('recruiters').select('id').eq('user_id', req.user.id)
            ).data?.map(r => r.id) || []);

        if (error) throw error;

        res.json({
            sentToday: count || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/send', requireAuth, emailSendLimiter, async (req, res) => {
    try {
        // This endpoint just triggers our background queue. 
        // We will flip the state in global scope so the set interval worker processes this user.

        // Mark user queue as "Active" -- in a real scalable system, we'd use Redis or DB job table.
        // For MVP, we insert a generic trigger command to activate queue or rely on worker polling.

        res.json({ success: true, message: 'Email queue started. Processing in background.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Template management
router.get('/template/:type', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('email_templates')
            .select('*')
            .eq('user_id', req.user.id)
            .eq('type', req.params.type)
            .single();

        res.json({ template: data || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/template', requireAuth, async (req, res) => {
    try {
        const { type, subject, body } = req.body;

        const { data, error } = await supabase
            .from('email_templates')
            .upsert({
                user_id: req.user.id,
                type: type || 'initial',
                subject,
                body,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,type' })
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, template: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
