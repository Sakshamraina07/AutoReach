import nodemailer from 'nodemailer';
import { supabase, supabaseAdmin } from '../server.js';
import { compileTemplate, getRandomDelay, getWarmupLimit } from '../services/emailService.js';
import dotenv from 'dotenv';
dotenv.config();

const BYPASS_WARMUP_EMAILS = ['sakshamraina16@gmail.com'];

let isProcessing = false;

const processQueue = async () => {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const { data: nextRecruiter, error: recError } = await supabase
            .from('recruiters')
            .select('*')
            .eq('status', 'Pending')
            .order('created_at', { ascending: true })
            .limit(1)
            .single();

        if (recError && recError.code !== 'PGRST116') throw recError;
        if (!nextRecruiter) { isProcessing = false; return; }

        // ✅ Use admin auth API to get user
        const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(nextRecruiter.user_id);

        if (userError || !user) {
            console.error('[Queue] Could not find user for recruiter:', nextRecruiter.user_id);
            isProcessing = false;
            return;
        }

        // ✅ Use supabaseAdmin to bypass RLS on smtp settings
        const { data: smtpSettings, error: smtpError } = await supabaseAdmin
            .from('user_smtp_settings')
            .select('*')
            .eq('user_id', user.id)
            .single();

        if (!smtpSettings) {
            console.log(`[Queue] User ${user.email} has no Gmail connected. Skipping.`);
            isProcessing = false;
            return;
        }

        // ✅ Fixed transporter — explicit host/port instead of service:'gmail'
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                user: smtpSettings.gmail_user,
                pass: smtpSettings.gmail_app_password,
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        const isBypassed = BYPASS_WARMUP_EMAILS.includes(user.email);

        if (!isBypassed) {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const recruiterIds = (
                await supabase.from('recruiters').select('id').eq('user_id', user.id)
            ).data?.map(r => r.id) || [];

            const { count: userSentToday } = await supabase
                .from('email_history')
                .select('id', { count: 'exact', head: true })
                .gte('sent_at', startOfDay.toISOString())
                .in('recruiter_id', recruiterIds.length > 0 ? recruiterIds : ['00000000-0000-0000-0000-000000000000']);

            const dailyLimit = getWarmupLimit(user.created_at);
            if (userSentToday >= dailyLimit) {
                console.log(`[Queue] User ${user.email || user.id} hit daily warmup limit (${dailyLimit}). Skipping.`);
                isProcessing = false;
                return;
            }
        } else {
            console.log(`[Queue] Warmup bypass active for ${user.email}`);
        }

        const { data: template } = await supabase
            .from('email_templates')
            .select('*')
            .eq('user_id', user.id)
            .eq('type', 'initial')
            .single();

        if (!template) {
            console.log(`[Queue] User ${user.id} has no template. Cannot send.`);
            isProcessing = false;
            return;
        }

        let subject = compileTemplate(template.subject, nextRecruiter, user);
        let body = compileTemplate(template.body, nextRecruiter, user);

        const { data: historyEntry, error: historyError } = await supabase
            .from('email_history')
            .insert([{
                recruiter_id: nextRecruiter.id,
                user_id: user.id,
                subject,
                status: 'sending',
                sent_at: new Date().toISOString(),
            }])
            .select()
            .single();

        if (historyError || !historyEntry) {
            console.error('[Queue] Failed to create history entry:', historyError);
            isProcessing = false;
            return;
        }

        const trackingUrl = `${process.env.API_URL || 'https://autoreach-pjez.onrender.com'}/track/${historyEntry.id}`;
        body += `<br><img src="${trackingUrl}" width="1" height="1" style="display:none;" />`;

        let attachments = [];
        if (user.user_metadata?.resume_url) {
            try {
                const response = await fetch(user.user_metadata.resume_url);
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    attachments.push({ filename: 'Resume.pdf', content: buffer });
                }
            } catch (err) {
                console.error('[Queue] Could not attach resume:', err);
            }
        }

        try {
            await transporter.sendMail({
                from: `"${user.user_metadata?.name || smtpSettings.gmail_user}" <${smtpSettings.gmail_user}>`,
                to: nextRecruiter.email,
                subject,
                html: body.replace(/\n/g, '<br/>'),
                attachments: attachments.length > 0 ? attachments : undefined,
            });

            await supabase.from('recruiters').update({
                status: 'Sent',
                last_sent_at: new Date().toISOString(),
            }).eq('id', nextRecruiter.id);

            await supabase.from('email_history').update({ status: 'delivered' }).eq('id', historyEntry.id);
            console.log(`[Queue] Sent email to ${nextRecruiter.email} via ${smtpSettings.gmail_user}`);

        } catch (sendError) {
            console.error('[Gmail Error]', sendError.message);
            const retryCount = historyEntry.retry_count || 0;
            if (retryCount < 3) {
                await supabase.from('email_history').update({
                    status: 'failed',
                    error_message: sendError.message,
                    retry_count: retryCount + 1,
                }).eq('id', historyEntry.id);
            } else {
                await supabase.from('email_history').update({
                    status: 'abandoned',
                    error_message: sendError.message,
                }).eq('id', historyEntry.id);
                await supabase.from('recruiters').update({ status: 'Failed' }).eq('id', nextRecruiter.id);
            }
        }

        isProcessing = false;
        const delay = getRandomDelay(30, 90);
        console.log(`[Queue] Sleeping for ${delay / 1000}s before next send...`);
        await new Promise(resolve => setTimeout(resolve, delay));

    } catch (error) {
        console.error('[Queue Worker Fatal]', error);
        isProcessing = false;
    }
};

setInterval(processQueue, 10000);
console.log('Main email Queue Worker initialized.');