import { supabase, supabaseAdmin } from '../server.js';
import { compileTemplate, getRandomDelay } from '../services/emailService.js';
import { getValidGmailToken, sendViaGmail } from '../services/gmailService.js';
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
                .select('opened_at, status, gmail_message_id, gmail_thread_id')
                .eq('recruiter_id', recruiter.id)
                .order('sent_at', { ascending: true });

            const hasOpened = emailHistory?.some(h => h.opened_at !== null);
            if (hasOpened) continue;

            // ✅ Get original message ID and thread ID for threading
            const originalEmail = emailHistory?.find(h => h.gmail_message_id);
            const replyToMessageId = originalEmail?.gmail_message_id || null;
            const threadId = originalEmail?.gmail_thread_id || null;

            const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(recruiter.user_id);

            if (userError || !user) {
                console.error('[Followup Worker] Could not find user:', recruiter.user_id);
                continue;
            }

            const { data: smtpSettings } = await supabaseAdmin
                .from('user_smtp_settings')
                .select('*')
                .eq('user_id', user.id)
                .single();

            if (!smtpSettings || !smtpSettings.gmail_access_token) {
                console.log(`[Followup Worker] User ${user.email} has no Gmail connected. Skipping.`);
                continue;
            }

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

            let subject = compileTemplate(template.subject, recruiter, user.user_metadata);
            let body = compileTemplate(template.body, recruiter, user.user_metadata);

            // ✅ Prefix subject with Re: for threading
            if (replyToMessageId && !subject.startsWith('Re:')) {
                subject = `Re: ${subject}`;
            }

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

            const trackingUrl = `${process.env.API_URL || 'https://autoreach-production.up.railway.app'}/track/${historyEntry.id}`;
            body += `<br><img src="${trackingUrl}" width="1" height="1" style="display:none;" />`;

            let attachments = [];
            if (user.user_metadata?.resume_url) {
                try {
                    const response = await fetch(user.user_metadata.resume_url);
                    if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer();
                        attachments.push({
                            filename: 'Resume.pdf',
                            content: Buffer.from(arrayBuffer).toString('base64'),
                        });
                    }
                } catch (err) {
                    console.error('[Followup Worker] Could not attach resume:', err);
                }
            }

            try {
                const accessToken = await getValidGmailToken(user.id, smtpSettings);

                // ✅ Send as reply in same thread
                const { messageId, threadId: newThreadId } = await sendViaGmail({
                    accessToken,
                    fromName: user.user_metadata?.name || smtpSettings.gmail_user,
                    fromEmail: smtpSettings.gmail_user,
                    to: recruiter.email,
                    subject,
                    htmlBody: body.replace(/\n/g, '<br/>'),
                    attachments,
                    replyToMessageId,
                    threadId,
                });

                await supabase.from('recruiters').update({
                    last_sent_at: new Date().toISOString(),
                    followup_count: recruiter.followup_count + 1,
                }).eq('id', recruiter.id);

                // ✅ Store new message ID and thread ID
                await supabase.from('email_history').update({
                    status: 'delivered',
                    gmail_message_id: messageId,
                    gmail_thread_id: newThreadId,
                }).eq('id', historyEntry.id);

                console.log(`[Followup Worker] ✅ Sent follow-up to ${recruiter.email} in same thread`);

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