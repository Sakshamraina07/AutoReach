import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../server.js';

const router = express.Router();

router.post('/generate', requireAuth, async (req, res) => {
    try {
        const { profile } = req.body;

        if (!profile || !profile.name) {
            return res.status(400).json({ error: 'Missing profile data' });
        }

        const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(req.user.id);
        if (userError || !user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userName = user.user_metadata?.name || 'the applicant';
        const userDegree = user.user_metadata?.degree || '';
        const userYear = user.user_metadata?.year || '';
        const userLocation = user.user_metadata?.location || '';
        const userContact = user.user_metadata?.contact || '';

        // Step 1: Apollo email lookup
        let recruiterEmail = null;
        let emailSource = 'not found';

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
                        organization_name: profile.company || '',
                        linkedin_url: profile.profileUrl || '',
                    }),
                });

                const apolloData = await apolloRes.json();

                if (apolloData?.person?.email) {
                    recruiterEmail = apolloData.person.email;
                    emailSource = 'Apollo API';
                } else {
                    emailSource = 'not found via Apollo';
                }
            } catch (err) {
                console.error('[LinkedIn] Apollo error:', err.message);
                emailSource = 'Apollo error';
            }
        }

        // Step 2: Groq AI email generation (free)
        const aboutSnippet = profile.about ? `Their bio: "${profile.about.slice(0, 300)}"` : '';
        const postSnippet = profile.recentPost ? `Their recent LinkedIn post: "${profile.recentPost.slice(0, 200)}"` : '';
        const contextParts = [aboutSnippet, postSnippet].filter(Boolean).join('\n');

        const prompt = `You are writing a cold email from a student to a recruiter.

RECRUITER INFO:
- Name: ${profile.name}
- Role/Headline: ${profile.headline || profile.currentRole || 'Recruiter'}
- Company: ${profile.company || 'their company'}
- Location: ${profile.location || ''}
${contextParts ? `\nCONTEXT:\n${contextParts}` : ''}

SENDER INFO:
- Name: ${userName}
- Degree: ${userDegree}
- Year: ${userYear}
- Location: ${userLocation}
- Contact: ${userContact}

Write a SHORT cold email (under 120 words) that:
1. References something specific from their bio or recent post
2. Briefly introduces the student
3. Expresses interest in opportunities at their company
4. Ends with a soft call to action
5. Sounds human, NOT salesy

FORMAT EXACTLY:
SUBJECT: [subject line]
BODY:
[email body]

No explanation outside this format.`;

        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                max_tokens: 600,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        const groqData = await groqRes.json();

        if (!groqRes.ok || !groqData.choices?.[0]?.message?.content) {
            console.error('[LinkedIn] Groq API error:', groqData);
            return res.status(500).json({ error: 'AI email generation failed' });
        }

        const rawText = groqData.choices[0].message.content;
        const subjectMatch = rawText.match(/SUBJECT:\s*(.+)/i);
        const bodyMatch = rawText.match(/BODY:\s*([\s\S]+)/i);
        const subject = subjectMatch ? subjectMatch[1].trim() : 'Exploring Opportunities';
        const body = bodyMatch ? bodyMatch[1].trim() : rawText.trim();

        console.log(`[LinkedIn] Generated email for ${profile.name} at ${profile.company}`);

        res.json({
            success: true,
            email: recruiterEmail,
            emailSource,
            subject,
            body,
        });

    } catch (err) {
        console.error('[LinkedIn Route Error]', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
