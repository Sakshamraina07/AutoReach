/** Shared SELECT producing the FollowUp shape (business_days_since_contact is filled in by the service). */
export const FOLLOW_UP_SELECT = `
  SELECT f.id, f.recruiter_id, r.full_name AS recruiter_name, r.email AS recruiter_email, r.company,
    f.original_message_id, f.previous_message_id, pm.subject AS previous_subject, pm.sent_at AS previous_sent_at,
    f.step, f.due_at, f.status, f.auto_send, f.cancel_reason,
    (SELECT d.id FROM email_messages d
      WHERE d.follow_up_id = f.id AND d.send_status IN ('draft', 'queued', 'failed')
      ORDER BY d.created_at DESC LIMIT 1) AS draft_message_id,
    f.completed_message_id, f.created_at, NULL::int AS business_days_since_contact
  FROM follow_ups f
  JOIN recruiters r ON r.id = f.recruiter_id
  JOIN email_messages pm ON pm.id = f.previous_message_id`;
