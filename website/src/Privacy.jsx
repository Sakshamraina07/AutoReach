import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Lock, FileText, Mail, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

const Privacy = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="landing-page privacy-page">
      <header>
        <div className="container nav-content">
          <Link to="/" className="logo">
            <Shield size={24} fill="#3b82f6" />
            <span>AutoReach</span>
          </Link>
          <nav className="nav-links">
            <Link to="/"><ArrowLeft size={18} /> Back to Home</Link>
          </nav>
        </div>
      </header>

      <main className="privacy-content">
        <section className="hero-mini">
          <div className="container">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="badge">Legal</span>
              <h1>Privacy <span className="highlight">Policy.</span></h1>
              <p className="subtitle">
                Last updated: March 15, 2026
              </p>
            </motion.div>
          </div>
        </section>

        <section className="legal-text">
          <div className="container narrow">
            <div className="policy-section">
              <h2>Introduction</h2>
              <p>
                Welcome to AutoReach ("we," "our," or "us"). We are committed to protecting your privacy. This Privacy Policy explains how our Chrome Extension, AutoReach, collects, uses, and safeguards your information when you use our service.
              </p>
              <p>
                AutoReach is a productivity tool designed to help students automate cold email outreach to recruiters. By using AutoReach, you agree to the collection and use of information in accordance with this policy.
              </p>
            </div>

            <div className="policy-section">
              <h2>Information We Collect</h2>
              <h3>1. Personal Information</h3>
              <p>
                When you sign in using Google OAuth (via Supabase Auth), we collect your name and email address (`userinfo.email`). This is used to identify you and manage your account.
              </p>
              <h3>2. Profile Data</h3>
              <p>
                You may provide additional information such as your degree, graduation year, location, and contact details. This data is stored securely in our database.
              </p>
              <h3>3. Resume and Files</h3>
              <p>
                If you upload your resume (PDF), it is stored in Supabase Storage. We do not access or use this file for any purpose other than sending it as an attachment in your outreach emails.
              </p>
              <h3>4. OAuth Tokens</h3>
              <p>
                To send emails on your behalf, we securely store your Google OAuth access and refresh tokens. These tokens are used exclusively to communicate with the Gmail API.
              </p>
            </div>

            <div className="policy-section">
              <h2>Gmail API Usage & Scopes</h2>
              <p>
                AutoReach requests the `gmail.send` scope. This allows the app to send emails on your behalf.
              </p>
              <div className="highlight-box">
                <p><strong>Important:</strong> AutoReach's use and transfer of information received from Google APIs to any other app will adhere to <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
              </div>
              <ul>
                <li><strong>Limited Use:</strong> We only use the `gmail.send` scope to send emails that you have specifically drafted or initiated.</li>
                <li><strong>No Reading:</strong> We do NOT read your inbox, your existing emails, or any other data from your Gmail account.</li>
                <li><strong>No Passwords:</strong> We never see or store your Google password. Authentication is handled entirely through Google's secure OAuth protocol.</li>
                <li><strong>Direct Integration:</strong> Emails are sent directly from your Gmail account to the recruiters you specify.</li>
              </ul>
            </div>

            <div className="policy-section">
              <h2>How We Use Your Data</h2>
              <p>We use the collected data for the following purposes:</p>
              <ul>
                <li>To provide and maintain the service.</li>
                <li>To send outreach emails on your behalf.</li>
                <li>To track email opens and provide you with analytics on your outreach performance.</li>
                <li>To manage your user profile and resume.</li>
              </ul>
              <p><strong>We do NOT sell your data to any third party.</strong> We do NOT share your data with advertisers.</p>
            </div>

            <div className="policy-section">
              <h2>Data Storage & Security</h2>
              <p>
                Your data is stored using industry-standard security measures. We use the following third-party services:
              </p>
              <ul>
                <li><strong>Supabase:</strong> Used for database management, authentication, and file storage. Data is hosted on Supabase's secure infrastructure.</li>
                <li><strong>Railway:</strong> Our backend services are hosted on Railway.app.</li>
              </ul>
              <p>
                We implement technical and organizational measures to protect your data, including encryption of sensitive information like OAuth tokens.
              </p>
            </div>

            <div className="policy-section">
              <h2>User Rights & Data Deletion</h2>
              <p>
                You have the right to access, update, or delete your personal information at any time. If you wish to delete your account and all associated data (including profile info, resumes, and email history), please contact us at <strong>sakshamraina16@gmail.com</strong>.
              </p>
              <p>
                You can also revoke AutoReach's access to your Google account at any time through your Google Account Security settings.
              </p>
            </div>

            <div className="policy-section">
              <h2>Contact Information</h2>
              <p>
                If you have any questions about this Privacy Policy, please contact:
              </p>
              <p>
                <strong>Developer:</strong> Saksham Raina<br />
                <strong>Email:</strong> sakshamraina16@gmail.com<br />
                <strong>Website:</strong> <a href="https://auto-reach-ext.vercel.app">https://auto-reach-ext.vercel.app</a>
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <p>© 2026 AutoReach. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Privacy;
