import { supabaseAdmin } from '../server.js';

export const refreshGmailToken = async (userId, refreshToken) => {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });

    const data = await response.json();

    if (!response.ok || !data.access_token) {
        throw new Error(`Token refresh failed: ${data.error_description || data.error || 'Unknown error'}`);
    }

    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

    await supabaseAdmin
        .from('user_smtp_settings')
        .update({ gmail_access_token: data.access_token, token_expires_at: expiresAt })
        .eq('user_id', userId);

    return data.access_token;
};

export const getValidGmailToken = async (userId, smtpSettings) => {
    const expiresAt = smtpSettings.token_expires_at ? new Date(smtpSettings.token_expires_at) : null;
    const isExpired = !expiresAt || expiresAt <= new Date(Date.now() + 5 * 60 * 1000);

    if (isExpired) {
        if (!smtpSettings.gmail_refresh_token) {
            throw new Error('No refresh token available. User must reconnect Gmail.');
        }
        console.log(`[Gmail] Refreshing token for user ${userId}...`);
        return await refreshGmailToken(userId, smtpSettings.gmail_refresh_token);
    }

    return smtpSettings.gmail_access_token;
};

export const sendViaGmail = async ({
    accessToken,
    fromName,
    fromEmail,
    to,
    subject,
    htmlBody,
    attachments = [],
    replyToMessageId = null,
    threadId = null,
}) => {
    const boundary = `boundary_${Date.now()}`;

    const headers = [
        `From: "${fromName}" <${fromEmail}>`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ];

    // ✅ Threading headers
    if (replyToMessageId) {
        headers.push(`In-Reply-To: <${replyToMessageId}>`);
        headers.push(`References: <${replyToMessageId}>`);
    }

    let mimeLines = [
        ...headers,
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset="UTF-8"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        Buffer.from(htmlBody).toString('base64'),
    ];

    for (const attachment of attachments) {
        mimeLines = mimeLines.concat([
            ``,
            `--${boundary}`,
            `Content-Type: application/pdf; name="${attachment.filename}"`,
            `Content-Transfer-Encoding: base64`,
            `Content-Disposition: attachment; filename="${attachment.filename}"`,
            ``,
            attachment.content,
        ]);
    }

    mimeLines.push(`--${boundary}--`);

    const rawMessage = mimeLines.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const requestBody = { raw: encodedMessage };
    if (threadId) requestBody.threadId = threadId;

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error?.message || `Gmail API error: ${response.status}`);
    }

    return {
        messageId: result.id,
        threadId: result.threadId,
    };
};