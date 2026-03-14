import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { requireAuth } from '../middleware/auth.js';
import { supabase } from '../server.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Validation for emails (Generic / Domain filters)
const isValidEmail = (email) => {
    if (!email) return false;
    const lower = email.toLowerCase().trim();

    // Check basic format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lower)) return false;

    // Reject generic roles
    const genericRoles = ['admin@', 'info@', 'support@', 'noreply@', 'hr@', 'contact@', 'hello@'];
    if (genericRoles.some(role => lower.startsWith(role))) return false;

    // Reject bad domains
    const badDomains = ['@example.com', '@test.com', '@dummy.com'];
    if (badDomains.some(domain => lower.endsWith(domain))) return false;

    return true;
};

router.get('/list', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('recruiters')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ recruiters: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/add', requireAuth, async (req, res) => {
    try {
        const { hr_name, company, email, role, source } = req.body;

        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Invalid or generic email address' });
        }

        const { data, error } = await supabase
            .from('recruiters')
            .insert([{
                user_id: req.user.id,
                hr_name,
                company,
                email: email.trim(),
                role,
                source: source || 'manual'
            }])
            .select()
            .single();

        // Check for unique constraint violation (code 23505 in Postgres)
        if (error && error.code === '23505') {
            return res.status(409).json({ error: 'Recruiter with this email already exists' });
        }
        if (error) throw error;

        res.json({ success: true, recruiter: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/import', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No CSV file uploaded' });
        }

        const csvData = req.file.buffer.toString('utf8');

        parse(csvData, { columns: true, skip_empty_lines: true }, async (err, records) => {
            if (err) return res.status(400).json({ error: 'Invalid CSV format' });

            const validRecruiters = [];
            const seenEmails = new Set();

            for (const record of records) {
                // Map possible column names
                const email = record.Email || record.email || record['Email Address'];
                const hr_name = record['HR Name'] || record.Name || record.name || record.hr_name;
                const company = record.Company || record.company;
                const role = record.Role || record.role || '';

                if (email && isValidEmail(email) && !seenEmails.has(email.toLowerCase())) {
                    seenEmails.add(email.toLowerCase());
                    validRecruiters.push({
                        user_id: req.user.id,
                        hr_name,
                        company,
                        email: email.trim(),
                        role,
                        source: 'csv'
                    });
                }
            }

            if (validRecruiters.length === 0) {
                return res.status(400).json({ error: 'No valid recruiter emails found in CSV' });
            }

            // Insert matching valid records, ignoring duplicates
            const { data, error } = await supabase
                .from('recruiters')
                .upsert(validRecruiters, { onConflict: 'user_id,email', ignoreDuplicates: true })
                .select();

            if (error) throw error;

            res.json({
                success: true,
                message: `Imported ${validRecruiters.length} valid recruiters`,
                inserted: data?.length || 0
            });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete recruiter
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const { error } = await supabase
            .from('recruiters')
            .delete()
            .eq('id', req.params.id)
            .eq('user_id', req.user.id);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
