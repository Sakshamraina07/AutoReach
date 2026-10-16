import type { MessageSummary, RecruiterLookupResult, RecruiterSummary } from '@autoreach/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { assistItems, composeDialogs, composeRecipients, threadParticipants } from '../content/gmailDom';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Gmail DOM reading', () => {
  it('reads recipients from compose chips and hidden inputs, ignoring other text', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <div><span data-hovercard-id="Meera.Iyer@Contoso.example">Meera</span><span email="daniel@fabrikam.example">Daniel</span></div>
        <input name="cc" value="Priya <priya@northwind.example>, not-an-email">
        <input name="subjectbox" value="">
        <div contenteditable="true" role="textbox">Write to someone@else.example in the body</div>
      </div>`;
    expect(composeDialogs(document)).toHaveLength(1);
    expect(composeRecipients(document).sort()).toEqual(['daniel@fabrikam.example', 'meera.iyer@contoso.example', 'priya@northwind.example']);
  });

  it('ignores dialogs that are not compose windows', () => {
    document.body.innerHTML = '<div role="dialog"><span email="x@y.example"></span></div>';
    expect(composeRecipients(document)).toEqual([]);
  });

  it('reads conversation participants from headers only', () => {
    document.body.innerHTML = `
      <div role="main">
        <h2>Re: Internship</h2>
        <table><tr><td><h3><span class="gD" email="meera.iyer@contoso.example">Meera Iyer</span></h3></td></tr></table>
        <div class="body">Forwarding to <span email="hidden@contoso.example">someone</span> in the body text</div>
      </div>`;
    expect(threadParticipants(document)).toEqual(['meera.iyer@contoso.example']);
  });
});

const rec = (over: Partial<RecruiterSummary> = {}): RecruiterSummary =>
  ({ id: 'r1', full_name: 'Meera Iyer', email: 'meera.iyer@contoso.example', company: 'Contoso', do_not_contact: false, outreach_status: 'contacted', last_reply_at: null, ...over }) as RecruiterSummary;
const msg = (over: Partial<MessageSummary> = {}): MessageSummary =>
  ({ id: 'm1', send_status: 'sent', reply_status: 'none', sent_at: '2026-10-01T10:00:00Z', replied_at: null, ...over }) as MessageSummary;

describe('assist card content', () => {
  it('warns about repeat outreach only while composing', () => {
    const results: RecruiterLookupResult[] = [{ email: 'meera.iyer@contoso.example', recruiter: rec(), messages: [msg()] }];
    expect(assistItems(results, true)[0]!.duplicateWarning).toBe("You've emailed Meera once already.");
    expect(assistItems(results, false)[0]!.duplicateWarning).toBeNull();
    expect(assistItems(results, false)[0]!.detail).toMatch(/^Emailed .*, no reply yet$/);
    const opened = assistItems([{ email: 'meera.iyer@contoso.example', recruiter: rec(), messages: [msg({ first_open_at: '2026-10-02T09:00:00Z' })] }], false)[0]!;
    expect(opened.detail).toMatch(/open detected, no reply yet$/);
    expect(opened.detail).not.toMatch(/read/i);
  });

  it('shows replies, bounces and do-not-contact distinctly', () => {
    expect(assistItems([{ email: 'a@x.example', recruiter: rec(), messages: [msg({ reply_status: 'replied', replied_at: '2026-10-03T10:00:00Z' })] }], false)[0]).toMatchObject({ tone: 'success' });
    expect(assistItems([{ email: 'a@x.example', recruiter: rec({ outreach_status: 'bounced' }), messages: [msg({ reply_status: 'bounced' })] }], false)[0]!.tone).toBe('danger');
    const dnc = assistItems([{ email: 'a@x.example', recruiter: rec({ do_not_contact: true }), messages: [] }], true)[0]!;
    expect(dnc).toMatchObject({ doNotContact: true, detail: 'Marked do-not-contact in AutoReach' });
  });

  it('marks unknown people without guessing anything about them', () => {
    expect(assistItems([{ email: 'new@x.example', recruiter: null, messages: [] }], true)[0]).toMatchObject({ known: false, title: 'new@x.example', detail: 'Not in AutoReach' });
  });
});
