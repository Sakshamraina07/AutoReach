import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function guessEmail(fullName, company, headline) {
    const parts = fullName.trim().toLowerCase().split(/\s+/);
    const first = parts[0] || '';
    const last = parts[parts.length - 1] || '';

    let companyName = company;

    if (companyName && companyName.toLowerCase() === 'about') {
        companyName = '';
    }

    if (!companyName && headline && headline.includes('@')) {
        const afterAt = headline.split('@')[1];
        companyName = afterAt.split(/\s+supporting\s+/i)[0].trim();
    }

    if (!companyName && headline && headline.includes(' - ')) {
        const afterDash = headline.split(' - ')[1];
        if (afterDash) {
            companyName = afterDash.split(/\s+supporting\s+/i)[0]
                .split('||')[0].trim();
        }
    }

    if (!companyName && headline && headline.toLowerCase().includes(' at ')) {
        companyName = headline.split(/ at /i)[1]
            .split(/\s+supporting\s+/i)[0]
            .split('||')[0].trim();
    }

    const domain = (companyName || '')
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
        const headline = profile.headline || '';
        let recruiterEmail = null;
        let emailSource = '';

        // ── Step 1: Try Hunter.io API ──
        if (process.env.HUNTER_API_KEY) {
            try {
                const nameParts = profile.name.trim().split(' ');
                const firstName = nameParts[0] || '';
                const lastName = nameParts.slice(1).join(' ') || '';

                // Get domain from company name
                let companyForHunter = company || '';
                if (!companyForHunter && headline) {
                    if (headline.includes('@')) {
                        companyForHunter = headline.split('@')[1]
                            .split(/\s+supporting\s+/i)[0].trim();
                    } else if (headline.includes(' - ')) {
                        companyForHunter = headline.split(' - ')[1]
                            .split(/\s+supporting\s+/i)[0]
                            .split('||')[0].trim();
                    } else if (headline.toLowerCase().includes(' at ')) {
                        companyForHunter = headline.split(/ at /i)[1]
                            .split(/\s+supporting\s+/i)[0]
                            .split('||')[0].trim();
                    }
                }

                // Hunter Email Finder API
                const hunterUrl = new URL('https://api.hunter.io/v2/email-finder');
                hunterUrl.searchParams.set('first_name', firstName);
                hunterUrl.searchParams.set('last_name', lastName);
                hunterUrl.searchParams.set('company', companyForHunter);
                hunterUrl.searchParams.set('api_key', process.env.HUNTER_API_KEY);

                const hunterRes = await fetch(hunterUrl.toString());
                const hunterData = await hunterRes.json();

                if (hunterData?.data?.email) {
                    recruiterEmail = hunterData.data.email;
                    emailSource = `Hunter.io (${hunterData.data.confidence}% confidence)`;
                    console.log(`[LinkedIn] Hunter found: ${recruiterEmail}`);
                }
            } catch (err) {
                console.error('[LinkedIn] Hunter error:', err.message);
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