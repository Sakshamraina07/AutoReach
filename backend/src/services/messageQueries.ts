/** Shared SELECT producing the MessageSummary shape (see @autoreach/shared types). */
export const MESSAGE_SUMMARY_SELECT = `
  SELECT m.id, m.kind, m.recruiter_id,
    coalesce(r.full_name, m.recipient_name) AS recruiter_name,
    m.recipient_email,
    coalesce(o.company_name, r.company) AS company,
    m.opportunity_id, o.title AS opportunity_title,
    coalesce(o.title, m.manual_role, r.target_role) AS role_label,
    m.campaign_id, m.subject, m.send_status, m.reply_status, m.tracking_enabled,
    m.first_open_at, m.last_open_at, m.open_event_count, m.scheduled_for, m.sent_at, m.failed_at,
    m.error_code, m.error_message, m.replied_at, m.gmail_thread_id, m.gmail_message_id,
    (SELECT min(f.due_at) FROM follow_ups f
      WHERE f.status = 'pending' AND (f.original_message_id = m.id OR f.previous_message_id = m.id)) AS next_follow_up_at,
    m.ai_generated, m.legacy, m.created_at, m.updated_at
  FROM email_messages m
  LEFT JOIN recruiters r ON r.id = m.recruiter_id
  LEFT JOIN opportunities o ON o.id = m.opportunity_id`;
