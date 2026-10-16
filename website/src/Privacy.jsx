import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

const LOGO = '/logo.png?v=1.0.2';

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
};

const Privacy = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="landing-page privacy-page">
      <header>
        <div className="container nav-content">
          <Link to="/" className="logo">
            <img src={LOGO} alt="AutoReach Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
          </Link>
          <nav className="nav-links">
            <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ArrowLeft size={18} /> Back to Home
            </Link>
          </nav>
        </div>
      </header>

      <main className="privacy-content">
        <section className="hero-mini">
          <div className="container">
            <motion.div {...fadeUp}>
              <span className="badge">Legal &amp; Compliance</span>
              <h1>Privacy <span className="highlight">Policy.</span></h1>
              <p className="subtitle">
                Last updated: October 17, 2026
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '-1rem' }}>
                App: AutoReach &nbsp;|&nbsp; Developer: Saksham Raina &nbsp;|&nbsp;{' '}
                <a href="mailto:sakshamraina16@gmail.com" style={{ color: 'var(--primary-color)' }}>
                  sakshamraina16@gmail.com
                </a>
                &nbsp;|&nbsp;{' '}
                <a href="https://auto-reach-ext.vercel.app" target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)' }}>
                  auto-reach-ext.vercel.app
                </a>
              </p>
            </motion.div>
          </div>
        </section>

        <section className="legal-text">
          <div className="container narrow">

            <div className="policy-section">
              <h2>Introduction</h2>
              <p>
                This policy explains what AutoReach (the web dashboard, the Chrome extension and the AutoReach server they use) collects, why, where it is stored, and how you can export or delete it.
              </p>
              <p>
                AutoReach helps students and early-career engineers keep track of recruiters, write role-specific outreach emails, send them from their own Gmail account after reviewing them, and know when to follow up.
              </p>
            </div>

            <div className="policy-section">
              <h2>1. What AutoReach does</h2>
              <ul>
                <li><strong>Sign in with Google</strong> through Supabase Auth, which gives us your name and email address for your account.</li>
                <li><strong>Profile and résumés:</strong> you enter your education, skills, projects and experience, and upload résumé PDFs. You can ask AutoReach to suggest profile fields from your résumé; nothing is saved until you confirm each field.</li>
                <li><strong>Recruiters and opportunities:</strong> you add recruiter contacts and job opportunities by hand, from a CSV file, or from a page you choose to save with the extension.</li>
                <li><strong>Drafting:</strong> AutoReach builds drafts from your own templates and profile, or, if the server has an AI provider configured, with AI (see section 5). You edit every draft.</li>
                <li><strong>Sending:</strong> emails are sent from your Gmail account only when you press Send, or when you approved an email for the send queue, or (only if you turn it on) for automatic follow-ups that use your own template. You can pause all sending at any time.</li>
                <li><strong>Replies and follow-ups:</strong> AutoReach checks the threads it started for replies, bounces and automatic replies, and reminds you when a follow-up is due.</li>
              </ul>
            </div>

            <div className="policy-section">
              <h2>2. Google permissions we request, and why</h2>
              <div className="highlight-box">
                <p>
                  <strong>We request <code>gmail.send</code> and <code>gmail.metadata</code>, plus your basic identity (<code>openid</code>, <code>email</code>).</strong> We do not request permission to read the content of your emails, and we cannot read, modify or delete your messages.
                </p>
              </div>
              <ul>
                <li><strong><code>gmail.send</code>:</strong> to send the outreach emails you approve from your own address, so they appear in your Sent folder.</li>
                <li><strong><code>gmail.metadata</code>:</strong> to read message <em>headers</em> (sender, recipients, subject, date and labels), not bodies or attachments, so AutoReach can notice when a recruiter replies in a thread you started, and recognise bounces and out-of-office replies. AutoReach looks only at new messages in threads it is tracking; detecting replies that arrive in a brand-new thread is a separate setting that is off by default.</li>
                <li><strong><code>openid</code>, <code>email</code>:</strong> to show which Gmail account is connected.</li>
              </ul>
            </div>

            <div className="policy-section">
              <h2>3. Gmail API: Limited Use</h2>
              <div className="highlight-box">
                <p>
                  AutoReach's use and transfer of information received from Google APIs adheres to the{' '}
                  <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" rel="noreferrer">
                    Google API Services User Data Policy
                  </a>
                  , including the Limited Use requirements.
                </p>
              </div>
              <ul>
                <li>Gmail data is used only to send the emails you approve and to show reply status for your outreach.</li>
                <li>We store only what those features need: Gmail message and thread IDs of emails AutoReach sent, and for messages in those threads the sender, subject, date and how we classified them (reply, automatic reply, bounce).</li>
                <li>Gmail data is never sold, never used for advertising, never used to train AI models, and never sent to AI providers.</li>
                <li>OAuth tokens are encrypted (AES-256-GCM) on the AutoReach server. They are never stored in the browser or the extension.</li>
                <li>Disconnecting Gmail in Settings revokes AutoReach's access at Google and deletes the stored tokens. You can also revoke access at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>.</li>
              </ul>
            </div>

            <div className="policy-section">
              <h2>4. Information we store</h2>
              <h3>Account and profile</h3>
              <p>Your name, email address and the profile details you enter (education, skills, projects, experience, links, writing preferences).</p>
              <h3>Résumés</h3>
              <p>Résumé PDFs are stored in private storage, never at a public link. They are used to attach to the emails you send and, if you ask, to suggest profile fields.</p>
              <h3>Recruiters, opportunities and emails</h3>
              <p>The recruiter contacts and job opportunities you add, the drafts and emails you write and send through AutoReach, their send status, reply status and follow-up reminders, and an activity log of these events.</p>
              <h3>Open tracking (optional, off by default)</h3>
              <p>
                If you turn on open tracking, AutoReach adds a small invisible image to emails you send. When the recipient's mail app loads it, we record the time and a coarse classification (for example "image proxy" or "probably a security scanner"). Recipients are not told about the image. Opens are approximate: image blocking hides some opens, and proxies and scanners can load images without anyone reading. We do not store IP addresses or locations. You can turn tracking off for all emails or for a single email, choose how long signals are kept, and delete all of them in Settings.
              </p>
              <h3>Chrome extension</h3>
              <p>
                The extension keeps your sign-in session in Chrome's extension storage. On Gmail, its assist reads only the email addresses shown in recipient chips and conversation headers and sends them to your AutoReach account to show whether you've contacted those people; it does not read message bodies, and you can turn it off. When you choose to save a page as an opportunity, the extension reads that page's title, address, any text you selected, and the job details the site publishes for search engines; nothing is saved until you review it.
              </p>
            </div>

            <div className="policy-section">
              <h2>5. AI processing</h2>
              <p>
                If the AutoReach server is configured with an AI provider (for example Anthropic, OpenAI, Google Gemini or Groq), then when you ask for a draft or for résumé suggestions, the relevant text is sent to that provider: your profile facts, the recruiter's name, title and company, the job details you saved, your own earlier AutoReach emails to that recruiter, and for résumé suggestions the résumé text. Data read from Gmail is never included. Without an AI provider, drafts are built from your templates on the AutoReach server.
              </p>
            </div>

            <div className="policy-section">
              <h2>6. Security</h2>
              <ul>
                <li>Every request is authenticated, and each user's records are isolated in the database with row-level security as well as checks in the server code.</li>
                <li>OAuth tokens are encrypted at rest; résumé files are private; all traffic uses HTTPS.</li>
                <li>We never see or store your Google password.</li>
                <li>Logs do not contain email bodies or tokens.</li>
              </ul>
            </div>

            <div className="policy-section">
              <h2>7. Service providers</h2>
              <ul>
                <li><strong>Supabase:</strong> sign-in, database and private file storage.</li>
                <li><strong>Railway (or another host chosen by the operator):</strong> runs the AutoReach server.</li>
                <li><strong>Google Gmail API:</strong> sending and reply detection, as described above.</li>
                <li><strong>AI provider (optional):</strong> drafting and résumé suggestions, as described in section 5.</li>
                <li><strong>Hunter.io (optional):</strong> only if the operator configures it and you ask for address suggestions for a named person; the name and company domain are sent. Suggestions are always marked unverified.</li>
              </ul>
              <div className="highlight-box">
                <p><strong>We do not sell your data</strong> or share it with advertisers.</p>
              </div>
            </div>

            <div className="policy-section">
              <h2>8. Your choices, export and deletion</h2>
              <ul>
                <li><strong>Pause:</strong> stop all sending at once from the dashboard or the extension.</li>
                <li><strong>Export:</strong> download all your AutoReach data as JSON, and your recruiters as CSV, from Settings → Data and privacy.</li>
                <li><strong>Delete:</strong> delete your account from Settings → Data and privacy. This revokes Gmail access, deletes your résumé files and permanently removes your records. Emails you already sent remain in your Gmail.</li>
                <li><strong>Retention:</strong> your records are kept until you delete them or your account; open-tracking signals are deleted automatically after the period you choose.</li>
              </ul>
            </div>

            <div className="policy-section">
              <h2>9. Contact</h2>
              <p>
                <strong>App:</strong> AutoReach<br />
                <strong>Developer:</strong> Saksham Raina<br />
                <strong>Email:</strong>{' '}
                <a href="mailto:sakshamraina16@gmail.com">sakshamraina16@gmail.com</a><br />
                <strong>Website:</strong>{' '}
                <a href="https://auto-reach-ext.vercel.app" target="_blank" rel="noreferrer">
                  https://auto-reach-ext.vercel.app
                </a>
              </p>
            </div>

          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <p>
            © 2026 AutoReach. All rights reserved. &nbsp;|&nbsp;{' '}
            <Link to="/" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
              Home
            </Link>
            &nbsp;|&nbsp;{' '}
            <a href="mailto:sakshamraina16@gmail.com" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
              Contact
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Privacy;
