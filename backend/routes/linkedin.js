import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Blacklist of false positive company names from LinkedIn page sections
const COMPANY_BLACKLIST = ['about', 'activity', 'experience', 'education', 'skills', 'posts', 'comments', 'no', 'in', 'com'];

function cleanCompanyName(name) {
    if (!name) return '';
    const cleaned = name.trim();
    if (COMPANY_BLACKLIST.includes(cleaned.toLowerCase())) return '';
    return cleaned;
}

function extractCompanyFromHeadline(headline) {
    if (!headline) return '';

    // "HR @Learning Routes Pvt. Ltd. | HR Generalist..."
    if (headline.includes('@')) {
        const afterAt = headline.split('@')[1];
        const company = afterAt
            .split(/\s*[\|]\s*|\s+supporting\s+/i)[0]
            .trim();
        return cleanCompanyName(company);
    }

    // "Team Lead - Korn Ferry supporting Google"
    if (headline.includes(' - ')) {
        const afterDash = headline.split(' - ')[1];
        if (afterDash) {
            const company = afterDash
                .split(/\s*[\|]\s*|\s+supporting\s+/i)[0]
                .split('||')[0]
                .trim();
            return cleanCompanyName(company);
        }
    }

    // "Specialist at Korn Ferry"
    if (headline.toLowerCase().includes(' at ')) {
        const company = headline.split(/ at /i)[1]
            .split(/\s*[\|]\s*|\s+supporting\s+/i)[0]
            .split('||')[0]
            .trim();
        return cleanCompanyName(company);
    }

    return '';
}

function getDomain(companyName) {
    return (companyName || '')
        .toLowerCase()
        .replace(/\s+(india|pvt|ltd|limited|inc|corp|technologies|tech|solutions|services|consulting|group|global|international|software|systems|infosystems|infotech|pvt\.?\s*ltd\.?)\b.*/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

function guessEmail(fullName, company, headline) {
    const parts = fullName.trim().toLowerCase().split(/\s+/);
    const first = parts[0] || '';
    const last = parts[parts.length - 1] || '';

    // Try company first, then extract from headline
    let companyName = cleanCompanyName(company);
    if (!companyName) {
        companyName = extractCompanyFromHeadline(headline);
    }

    const domain = getDomain(companyName);

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

                // Get best company name for Hunter
                let companyForHunter = cleanCompanyName(company);
                if (!companyForHunter) {
                    companyForHunter = extractCompanyFromHeadline(headline);
                }

                if (companyForHunter && firstName && lastName) {
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
                    } else {
                        console.log(`[LinkedIn] Hunter returned no email for ${profile.name}`);
                    }
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