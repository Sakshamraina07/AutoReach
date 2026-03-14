import nodemailer from 'nodemailer';
import { supabase } from '../server.js';
import { compileTemplate, getRandomDelay } from '../services/emailService.js';
import dotenv from 'dotenv';
dotenv.config();

let isProcessingFollowups = false;

const processFollowups = async () => {
    if (isProcessingFollowups) return;
    isProcessingFollowups = true;

    try {
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

        const { data: eligibleRecruiters, error } = await supabase
            .from('recruiters')
            .select('*')
            .eq('status', 'Sent')
            .lte('last_sent_at', fiveDaysAgo.toISOString())
            .lt('followup_count', 2);

        if (error) {
            console.error('[Followup Worker] DB Error:', error);
            isProcessingFollowups = false;
            return;
        }

        if (!eligibleRecruiters || eligibleRecruiters.length === 0) {
            isProcessingFollowups = false;
            return;
        }

        for (const recruiter of eligibleRecruiters) {
            const { data: emailHistory } = await supabase
                .from('email_history')
                .select('opened_at, status')
                .eq('recruiter_id', recruiter.id);

            const hasOpened = emailHistory?.some(h => h.opened_at !== null);
            if (hasOpened) continue;

            const { data: user, error: userError } = await supabase
                .from('users')
                .select('*')
                .eq('id', recruiter.user_id)
                .single();

            if (userError || !user) {
                console.error('[Followup Worker] Could not find user:', recruiter.user_id);
                continue;
            }

            // ✅ Fetch user's own Gmail SMTP credentials
            const { data: smtpSettings } = await supabase
                .from('user_smtp_settings')
                .select('*')
                .eq('user_id', user.id)
                .single();

            if (!smtpSettings) {
                console.log(`[Followup Worker] User ${user.email} has no Gmail connected. Skipping.`);
                continue;
            }

            // ✅ Create transporter dynamically per user
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: smtpSettings.gmail_user,
                    pass: smtpSettings.gmail_app_password,
                },
            });

            const nextFollowupType = recruiter.followup_count === 0 ? 'followup_1' : 'followup_2';

            const { data: template } = await supabase
                .from('email_templates')
                .select('*')
                .eq('user_id', user.id)
                .eq('type', nextFollowupType)
                .single();

            if (!template) {
                console.log(`[Followup Worker] Missing ${nextFollowupType} template. Skipping ${recruiter.email}.`);
                continue;
            }

            let subject = compileTemplate(template.subject, recruiter, user);
            let body = compileTemplate(template.body, recruiter, user);

            const { data: historyEntry, error: historyError } = await supabase
                .from('email_history')
                .insert([{
                    recruiter_id: recruiter.id,
                    user_id: user.id,
                    subject,
                    status: 'sending',
                    sent_at: new Date().toISOString(),
                }])
                .select()
                .single();

            if (historyError || !historyEntry) {
                console.error('[Followup Worker] Failed to create history entry:', historyError);
                continue;
            }

            const trackingUrl = `${process.env.API_URL || 'https://autoreach-pjez.onrender.com'}/track/${historyEntry.id}`;
            body += `<br><img src="${trackingUrl}" width="1" height="1" style="display:none;" />`;

            let attachments = [];
            if (user.resume_url) {
                try {
                    const response = await fetch(user.resume_url);
                    if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);
                        attachments.push({ filename: 'Resume.pdf', content: buffer });
                    }
                } catch (err) {
                    console.error('[Followup Worker] Could not attach resume:', err);
                }
            }

            try {
                await transporter.sendMail({
                    from: `"${user.name || smtpSettings.gmail_user}" <${smtpSettings.gmail_user}>`,
                    to: recruiter.email,
                    subject,
                    html: body.replace(/\n/g, '<br/>'),
                    attachments: attachments.length > 0 ? attachments : undefined,
                });

                await supabase.from('recruiters').update({
                    last_sent_at: new Date().toISOString(),
                    followup_count: recruiter.followup_count + 1,
                }).eq('id', recruiter.id);

                await supabase.from('email_history').update({ status: 'delivered' }).eq('id', historyEntry.id);
                console.log(`[Followup Worker] ✅ Sent follow-up to ${recruiter.email} via ${smtpSettings.gmail_user}`);

            } catch (err) {
                console.error('[Followup Worker] Send failed:', err.message);
                await supabase.from('email_history').update({
                    status: 'failed',
                    error_message: err.message,
                }).eq('id', historyEntry.id);
            }

            const delay = getRandomDelay(15, 45);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

    } catch (err) {
        console.error('[Followup Worker Fatal]', err);
    } finally {
        isProcessingFollowups = false;
    }
};

setInterval(processFollowups, 3600000);
console.log('Followup Worker initialized.');