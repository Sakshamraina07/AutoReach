import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { emailSendLimiter } from '../middleware/rateLimiter.js';
import { supabaseAdmin } from '../server.js';
import { compileTemplate } from '../services/emailService.js';

const router = express.Router();

router.post('/preview', requireAuth, async (req, res) => {
    try {
        const { templateType, recruiterData } = req.body;

        const { data: { user: userProfile }, error: userError } = await supabaseAdmin.auth.admin.getUserById(req.user.id);

        if (userError || !userProfile) return res.status(404).json({ error: 'User not found' });

        const { data: template, error: tplError } = await supabaseAdmin
            .from('email_templates')
            .select('*')
            .eq('user_id', req.user.id)
            .eq('type', templateType || 'initial')
            .single();

        if (tplError && tplError.code !== 'PGRST116') throw tplError;

        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const previewSubject = compileTemplate(template.subject, recruiterData, userProfile.user_metadata);
        const previewBody = compileTemplate(template.body, recruiterData, userProfile.user_metadata);

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
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const { count, error } = await supabaseAdmin
            .from('email_history')
            .select('*', { count: 'exact', head: true })
            .gte('sent_at', startOfDay.toISOString())
            .in('recruiter_id', (
                await supabaseAdmin.from('recruiters').select('id').eq('user_id', req.user.id)
            ).data?.map(r => r.id) || []);

        if (error) throw error;

        res.json({ sentToday: count || 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/send', requireAuth, emailSendLimiter, async (req, res) => {
    try {
        res.json({ success: true, message: 'Email queue started. Processing in background.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/template/:type', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
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

        const { data, error } = await supabaseAdmin
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