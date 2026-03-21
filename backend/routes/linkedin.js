import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function guessEmail(fullName, company) {
    const parts = fullName.trim().toLowerCase().split(/\s+/);
    const first = parts[0] || '';
    const last = parts[parts.length - 1] || '';

    const domain = company
        .toLowerCase()
        .replace(/\s+(india|pvt|ltd|limited|inc|corp|technologies|tech|solutions|services|consulting|group|global|international|software|systems|infosystems|infotech)\b.*/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();

    if (!first || !last || !domain) return null;
    return `${first}.${last}@${domain}.com`;
}

router.post('/guess-email', requireAuth, async (req, res) => {
    try {
        const { profile } = req.body;

        if (!profile || !profile.name) {
            return res.status(400).json({ error: 'Missing profile data' });
        }

        const company = profile.company || '';
        const recruiterEmail = guessEmail(profile.name, company);

        res.json({
            success: true,
            email: recruiterEmail,
            emailSource: recruiterEmail
                ? 'firstname.lastname@company.com'
                : 'could not guess — add manually',
        });

    } catch (err) {
        console.error('[LinkedIn Route Error]', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;