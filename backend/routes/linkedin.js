import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function guessEmail(fullName, company, headline) {
    const parts = fullName.trim().toLowerCase().split(/\s+/);
    const first = parts[0] || '';
    const last = parts[parts.length - 1] || '';

    let companyName = company;

    // Extract from headline with @ sign e.g. "Specialist @Korn Ferry supporting Google"
    if (!companyName && headline && headline.includes('@')) {
        companyName = headline.split('@')[1].split(' ')[0].trim();
    }

    // Extract from headline with "at" e.g. "Specialist at Korn Ferry"
    if (!companyName && headline && headline.toLowerCase().includes(' at ')) {
        companyName = headline.split(/ at /i)[1].split(' supporting')[0].trim();
    }

    // Extract from headline with "supporting" e.g. "Specialist @Korn Ferry supporting Google"
    if (!companyName && headline && headline.toLowerCase().includes('supporting')) {
        const match = headline.match(/supporting\s+(\w+)/i);
        if (match) companyName = match[1];
    }

    const domain = (companyName || '')
        .toLowerCase()
        .replace(/\s+(india|pvt|ltd|limited|inc|corp|technologies|tech|solutions|services|consulting|group|global|international|software|systems|infosystems|infotech|supporting.*)\b.*/g, '')
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
        const headline = profile.headline || '';
        let recruiterEmail = null;
        let emailSource = '';

        // ── Step 1: Try Apollo API ──
        if (process.env.APOLLO_API_KEY) {
            try {
                const nameParts = profile.name.trim().split(' ');
                const firstName = nameParts[0] || '';
                const lastName = nameParts.slice(1).join(' ') || '';

                const apolloRes = await fetch('https://api.apollo.io/v1/people/match', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Api-Key': process.env.APOLLO_API_KEY,
                    },
                    body: JSON.stringify({
                        first_name: firstName,
                        last_name: lastName,
                        organization_name: company || headline,
                        linkedin_url: profile.profileUrl || '',
                    }),
                });

                const apolloData = await apolloRes.json();

                if (apolloData?.person?.email) {
                    recruiterEmail = apolloData.person.email;
                    emailSource = 'Apollo API (verified)';
                    console.log(`[LinkedIn] Apollo found: ${recruiterEmail}`);
                }
            } catch (err) {
                console.error('[LinkedIn] Apollo error:', err.message);
            }
        }

        // ── Step 2: Fallback to pattern ──
        if (!recruiterEmail) {
            recruiterEmail = guessEmail(profile.name, company, headline);
            emailSource = recruiterEmail
                ? 'pattern guess (firstname.lastname@company.com)'
                : 'could not guess — add manually';
            console.log(`[LinkedIn] Pattern guess: ${recruiterEmail}`);
        }

        res.json({
            success: true,
            email: recruiterEmail,
            emailSource,
        });

    } catch (err) {
        console.error('[LinkedIn Route Error]', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;