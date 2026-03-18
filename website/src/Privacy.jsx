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
            <img src={LOGO} alt="AutoReach Logo" style={{ height: '36px', width: 'auto', objectFit: 'contain' }} />
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
                Last updated: March 18, 2026
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

            {/* Introduction */}
            <div className="policy-section">
              <h2>Introduction</h2>
              <p>
                Welcome to AutoReach ("we," "our," or "us"). We are committed to protecting your privacy. This Privacy Policy explains how our Chrome Extension, AutoReach, collects, uses, and safeguards your information when you use our service.
              </p>
              <p>
                AutoReach is a productivity tool designed to help students automate personalized cold email outreach to recruiters. By using AutoReach, you agree to the collection and use of information in accordance with this policy.
              </p>
            </div>

            {/* What AutoReach Does */}
            <div className="policy-section">
              <h2>1. What AutoReach Does</h2>
              <p>
                AutoReach is a Chrome Extension that helps students automate personalized cold email outreach to recruiters. Here is exactly how it works:
              </p>
              <ul>
                <li><strong>Sign in with Google:</strong> Users authenticate via Google OAuth (Supabase Auth), which provides their name and email address for account management.</li>
                <li><strong>Connect Gmail:</strong> Users connect their own Gmail account via Google OAuth (<code>gmail.send</code> scope) so that emails are sent from their real Gmail address.</li>
                <li><strong>Add Recruiter Contacts:</strong> Users manually add recruiter contacts or import them via a CSV file.</li>
                <li><strong>Write Email Templates:</strong> Users write their own email templates and can include personalization variables (e.g., recruiter name, company name).</li>
                <li><strong>Automated Sending:</strong> AutoReach sends emails on behalf of the user with configurable 30–90 second delays between messages to mimic natural sending behavior.</li>
              </ul>
            </div>

            {/* Why We Need gmail.send */}
            <div className="policy-section">
              <h2>2. Why We Need the <code>gmail.send</code> Scope</h2>
              <div className="highlight-box">
                <p>
                  <strong>We request only the <code>gmail.send</code> scope.</strong> We do NOT request any other Gmail scopes. We can never read, modify, delete, or access any existing emails or inbox data.
                </p>
              </div>
              <ul>
                <li><strong>Authentic Sending:</strong> We need <code>gmail.send</code> to send job application emails directly from the user's own Gmail account — not from a third-party domain.</li>
                <li><strong>Better Deliverability:</strong> Emails appearing from the user's real Gmail address improve deliverability and authenticity of job applications.</li>
                <li><strong>Explicit User Action:</strong> Emails are only sent when the user has explicitly configured and triggered them within the extension.</li>
                <li><strong>No Inbox Access:</strong> We never read, scan, index, or access any existing emails or inbox data in any form.</li>
                <li><strong>No Unrelated Usage:</strong> The <code>gmail.send</code> access is used solely to send outreach emails that the user has drafted and approved.</li>
              </ul>
            </div>

            {/* Limited Use Compliance */}
            <div className="policy-section">
              <h2>3. Gmail API — Limited Use Compliance</h2>
              <div className="highlight-box">
                <p>
                  <strong>Important:</strong> AutoReach's use and transfer of information received from Google APIs to any other app adheres to the{' '}
                  <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" rel="noreferrer">
                    Google API Services User Data Policy
                  </a>
                  , including the Limited Use requirements.
                </p>
              </div>
              <p>AutoReach's use of Gmail API data is strictly limited as follows:</p>
              <ul>
                <li><strong>Purpose:</strong> Gmail API access is used solely to send emails on behalf of the user. No other use.</li>
                <li><strong>No Storage Beyond Necessity:</strong> We do not store email content beyond what is immediately necessary to send the email.</li>
                <li><strong>No Third-Party Sharing:</strong> We do not share Gmail data with any third parties under any circumstances.</li>
                <li><strong>No Advertising:</strong> We do not use Gmail data for advertising, profiling, or any marketing purposes.</li>
                <li><strong>Secure Token Storage:</strong> OAuth access and refresh tokens are stored server-side in Supabase with encryption. They are never stored in Chrome extension storage or exposed to the client.</li>
                <li><strong>User Revocation:</strong> Users can disconnect their Gmail OAuth at any time from the Settings page, which immediately invalidates and removes their stored tokens.</li>
              </ul>
            </div>

            {/* Information We Collect */}
            <div className="policy-section">
              <h2>4. Information We Collect</h2>
              <h3>Account Information</h3>
              <p>
                When you sign in using Google OAuth, we collect your name and email address to identify you and manage your account.
              </p>
              <h3>Profile Data</h3>
              <p>
                You may provide additional information such as your degree, graduation year, location, and contact details. This data is stored securely in our Supabase database.
              </p>
              <h3>Resume and Files</h3>
              <p>
                If you upload your resume (PDF), it is stored in Supabase Storage and used exclusively as an email attachment in your outreach emails — nothing else.
              </p>
              <h3>OAuth Tokens</h3>
              <p>
                To send emails on your behalf, we securely store your Google OAuth access and refresh tokens server-side. These tokens are used exclusively to communicate with the Gmail API for email sending only.
              </p>
              <h3>Recruiter Contact Data</h3>
              <p>
                Recruiter contacts you add manually or import via CSV are stored in your account and used solely to address outreach emails as directed by you.
              </p>
            </div>

            {/* User Control */}
            <div className="policy-section">
              <h2>5. User Control</h2>
              <p>AutoReach is designed to keep you fully in control at all times:</p>
              <ul>
                <li><strong>Explicit Consent:</strong> You must explicitly click "Connect Gmail" to grant the <code>gmail.send</code> permission. No emails are sent without this step.</li>
                <li><strong>Your Content:</strong> You write and control all email content and templates. We never generate or modify your emails without your input.</li>
                <li><strong>Your Recipient List:</strong> You choose which recruiters to contact. We never automatically discover or add contacts.</li>
                <li><strong>Stop Anytime:</strong> You can pause or stop email sending at any time from within the extension.</li>
                <li><strong>Disconnect Gmail:</strong> You can disconnect your Gmail OAuth at any time from the Settings page. This immediately revokes our access.</li>
                <li><strong>Delete Your Account:</strong> You can request full deletion of your account and all associated data at any time by contacting us (see below).</li>
              </ul>
            </div>

            {/* Security Measures */}
            <div className="policy-section">
              <h2>6. Security Measures</h2>
              <ul>
                <li><strong>OAuth 2.0:</strong> We use Google's OAuth 2.0 standard with refresh token rotation. We never see or store your Google password.</li>
                <li><strong>Server-Side Token Storage:</strong> OAuth tokens are stored exclusively server-side in Supabase (never in Chrome extension storage or the browser).</li>
                <li><strong>Encryption:</strong> Sensitive information, including OAuth tokens, is encrypted at rest.</li>
                <li><strong>HTTPS Only:</strong> All communications between the extension, our backend, and external APIs are over HTTPS.</li>
                <li><strong>No Password Storage:</strong> We never store or have access to your Google account password.</li>
                <li><strong>Infrastructure:</strong> Backend services are hosted on Railway.app; database and storage on Supabase's secure, SOC 2-compliant infrastructure.</li>
              </ul>
            </div>

            {/* How We Use Your Data */}
            <div className="policy-section">
              <h2>7. How We Use Your Data</h2>
              <p>We use the collected data exclusively for the following purposes:</p>
              <ul>
                <li>To authenticate you and manage your account.</li>
                <li>To send outreach emails on your behalf via the Gmail API.</li>
                <li>To manage your recruiter contacts and email templates.</li>
                <li>To store and attach your resume to outreach emails.</li>
              </ul>
              <div className="highlight-box">
                <p><strong>We do NOT sell your data.</strong> We do NOT share your data with advertisers or third parties. We do NOT use your data for any purpose other than providing and improving the AutoReach service.</p>
              </div>
            </div>

            {/* Data Storage & Third Parties */}
            <div className="policy-section">
              <h2>8. Data Storage &amp; Third-Party Services</h2>
              <p>Your data is stored using industry-standard security measures via the following trusted providers:</p>
              <ul>
                <li><strong>Supabase:</strong> Used for database management, user authentication, OAuth token storage, and file storage.</li>
                <li><strong>Railway.app:</strong> Our backend API and email sending worker services are hosted here.</li>
                <li><strong>Google Gmail API:</strong> Used exclusively to send emails on behalf of the user.</li>
              </ul>
              <p>We do not use any other third-party services that receive your personal or Gmail data.</p>
            </div>

            {/* User Rights & Deletion */}
            <div className="policy-section">
              <h2>9. User Rights &amp; Data Deletion</h2>
              <p>
                You have the right to access, update, or delete your personal information at any time. To request account deletion and removal of all associated data (profile, resume, email history, and OAuth tokens), please contact us at the address below.
              </p>
              <p>
                You can also revoke AutoReach's access to your Google account at any time through your{' '}
                <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google Account Security settings</a>.
              </p>
            </div>

            {/* Contact */}
            <div className="policy-section">
              <h2>10. Contact Information</h2>
              <p>If you have any questions about this Privacy Policy, please contact:</p>
              <p>
                <strong>App Name:</strong> AutoReach<br />
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
