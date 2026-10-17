import React from 'react';
import { motion } from 'framer-motion';
import { Download, Shield, Mail, Users, Sparkles, Paperclip, Bell, Github, Linkedin, LayoutDashboard } from 'lucide-react';
import { Routes, Route, Link } from 'react-router-dom';
import Privacy from './Privacy';

const LOGO = '/logo.png?v=1.0.2';

// Set these in the Vercel project (Settings → Environment Variables) once the
// dashboard is deployed and a 2.0 extension release is published.
const REPO = 'https://github.com/Sakshamraina07/AutoReach';
const EXTENSION_URL = import.meta.env.VITE_EXTENSION_URL || `${REPO}/blob/main/docs/EXTENSION.md`;
const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || '';

const Home = () => {
  const features = [
    {
      icon: <Users size={24} />,
      title: "Recruiter CRM",
      description: "Every recruiter you contact in one place, with the role, every email you sent and what came back. Duplicates are caught by email address before you send twice."
    },
    {
      icon: <Sparkles size={24} />,
      title: "Role-specific drafts",
      description: "Drafts are written from your saved profile, projects and the job posting. Anything not in your profile is flagged, and you edit every word before it goes out."
    },
    {
      icon: <Paperclip size={24} />,
      title: "Your résumé, attached",
      description: "Keep several labelled résumés. The one you pick is checked and attached as a real PDF, not a link, and sending stops if the file is missing."
    },
    {
      icon: <Mail size={24} />,
      title: "Sent from your Gmail",
      description: "Emails go out from your own address and appear in your Sent folder. Nothing is sent until you press Send, and you can pause everything at once."
    },
    {
      icon: <Bell size={24} />,
      title: "Replies and follow-ups",
      description: "Replies are detected in your Gmail threads and cancel pending reminders. Follow-up reminders come a few business days later, ready to draft in the same thread."
    },
    {
      icon: <Shield size={24} />,
      title: "Honest tracking",
      description: "Sent, opened and replied are kept separate. Open tracking is optional and off by default, and opens are shown as approximate signals, never as proof someone read your email."
    }
  ];

  const steps = [
    {
      number: "01",
      title: "Set up your profile",
      description: "Sign in with Google, add your education, skills and projects (or let AutoReach suggest them from your résumé for you to confirm), and upload your résumé PDFs."
    },
    {
      number: "02",
      title: "Connect Gmail",
      description: "Allow AutoReach to send email for you and to read message headers so it can spot replies. It never reads the content of your emails."
    },
    {
      number: "03",
      title: "Add recruiters and roles",
      description: "Add recruiters by hand, from a CSV, or from a job page with the Chrome extension. Link them to the opportunities you're applying for."
    },
    {
      number: "04",
      title: "Review, send, follow up",
      description: "Generate a draft, check it, and send it with your résumé attached. AutoReach reminds you when a follow-up is due and stops when someone replies."
    }
  ];

  const ExamplePanel = () => (
    <div className="console-wrapper" aria-label="Example of the AutoReach outreach list (fictional data)">
      <div className="console-header">
        <div className="dots">
          <span></span><span></span><span></span>
        </div>
        <div className="console-title">Example outreach list (fictional data)</div>
      </div>
      <div className="console-content">
        <div className="console-grid">
          <div className="stat-card">
            <span className="stat-label">Sent today</span>
            <div className="stat-value">4 <span className="stat-unit">of 20</span></div>
            <div className="stat-progress">
              <motion.div
                className="progress-bar"
                initial={{ width: 0 }}
                animate={{ width: '20%' }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              />
            </div>
          </div>
          <div className="stat-card accent">
            <span className="stat-label">Follow-ups due</span>
            <div className="stat-value">2</div>
            <div className="stat-subtext">Reminders, not automatic emails</div>
          </div>
        </div>

        <div className="activity-feed">
          <div className="feed-header">Recent outreach</div>
          <div className="log-entries">
            <div className="log-entry success">
              <span className="log-time">Replied</span>
              <span className="log-msg">Meera Iyer, Contoso: Frontend Developer Intern</span>
            </div>
            <div className="log-entry">
              <span className="log-time">Open detected</span>
              <span className="log-msg">Daniel Okafor, Fabrikam: Full-Stack Developer Intern</span>
            </div>
            <div className="log-entry">
              <span className="log-time">Sent</span>
              <span className="log-msg">Priya Nair, Northwind Traders: Software Engineer Intern</span>
            </div>
            <div className="log-entry">
              <span className="log-time">Draft</span>
              <span className="log-msg">Hana Sato, Wingtip Toys: UI Engineering Intern</span>
            </div>
          </div>
        </div>

        <div className="console-footer">
          <div className="footer-tag">Sent from your Gmail</div>
          <div className="footer-tag">Opens are approximate</div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <header>
        <div className="container nav-content">
          <div className="logo">
            <img src={LOGO} alt="AutoReach Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain' }} />
          </div>
          
          <nav className="nav-links">
            <a href="#concept">Concept</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How it Works</a>
            <a href="#developer">Developer</a>
          </nav>

          <a href="https://github.com/Sakshamraina07/AutoReach" target="_blank" rel="noreferrer" className="btn btn-secondary github-btn">
            <Github size={18} />
            GitHub
          </a>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="badge">AutoReach 2.0</span>
              <h1>Recruiter outreach, <br /> <span className="highlight">kept honest.</span></h1>
              <p className="subtitle">
                A recruiter CRM, role-specific email drafts and follow-up reminders for your internship or first-job search. Emails go out from your own Gmail, only when you approve them.
              </p>
              
              <div className="cta-group">
                {DASHBOARD_URL && (
                  <a href={DASHBOARD_URL} className="btn btn-primary">
                    <LayoutDashboard size={20} />
                    Open the dashboard
                  </a>
                )}
                <a href={EXTENSION_URL} className={DASHBOARD_URL ? 'btn btn-secondary' : 'btn btn-primary'} target="_blank" rel="noreferrer">
                  <Download size={20} />
                  Get the Chrome extension
                </a>
                <a href="#features" className="btn btn-secondary">
                  Learn more
                </a>
              </div>

              <motion.div 
                id="concept"
                className="app-preview"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }}
              >
                <ExamplePanel />
              </motion.div>

              <motion.div 
                className="demo-video-container"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
                style={{ marginTop: '4rem', width: '100%', maxWidth: '800px', margin: '4rem auto 0' }}
              >
                <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: '1rem', border: '1px solid var(--border-color)', boxShadow: 'var(--card-shadow)' }}>
                  <iframe 
                    width="100%" 
                    height="100%" 
                    src="https://www.youtube.com/embed/YOug_Lsap-E" 
                    title="AutoReach Demo" 
                    frameBorder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowFullScreen
                    style={{ position: 'absolute', top: 0, left: 0 }}
                  ></iframe>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>

        <section id="features" className="features">
          <div className="container">
            <div className="section-head">
              <h2>What AutoReach does</h2>
              <p className="subtitle">Everything you need to reach recruiters personally, keep track of every conversation and know when to follow up.</p>
            </div>
            
            <div className="grid">
              {features.map((f, i) => (
                <motion.div 
                  key={i}
                  className="card"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                >
                  <div className="icon-box">
                    {f.icon}
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="how-it-works">
          <div className="container">
            <div className="section-head">
              <h2>How AutoReach Works</h2>
              <p className="subtitle">Four steps from sign-in to your first reply.</p>
            </div>

            <div className="steps-container">
              {steps.map((s, i) => (
                <motion.div 
                  key={i}
                  className="step-card"
                  initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.15 }}
                >
                  <div className="step-number">{s.number}</div>
                  <div className="step-content">
                    <h3>{s.title}</h3>
                    <p>{s.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="developer" className="built-by">
          <div className="container">
            <motion.div 
              className="founder-card"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="tech-element el-br">
                <span className="atomic-num">35</span>
                <span className="symbol">Br</span>
              </div>
              <div className="tech-element el-ba">
                <span className="atomic-num">56</span>
                <span className="symbol">Ba</span>
              </div>

              <div className="founder-profile">
                <div className="profile-img-glow">
                  <img src="https://github.com/Sakshamraina07.png" alt="Saksham Raina" />
                </div>
                <div className="dev-badge">DEV_CORE_01</div>
              </div>

              <div className="founder-info">
                <span className="built-by-label">Built By</span>
                <h2>Saksham Raina</h2>
                <p className="founder-bio">
                  Saksham Raina is a developer focused on automation, AI systems, and productivity tools.
                  AutoReach started as his own way to keep track of recruiter outreach during an internship search.
                </p>
                <div className="founder-socials">
                  <a href="https://github.com/Sakshamraina07" target="_blank" rel="noreferrer" className="social-icon">
                    <Github size={20} />
                  </a>
                  <a href="https://linkedin.com/in/sakshamraina" target="_blank" rel="noreferrer" className="social-icon">
                    <Linkedin size={20} />
                  </a>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="cta-final" style={{ padding: '8rem 0', textAlign: 'center' }}>
          <div className="container">
            <div style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.1))', padding: '4rem', borderRadius: '32px', border: '1px solid var(--border-color)' }}>
              <h2>Start your outreach list</h2>
              <p className="subtitle" style={{ marginBottom: '2.5rem' }}>Set up your profile once, then write to each recruiter about the role you actually want.</p>
              <a href={DASHBOARD_URL || EXTENSION_URL} className="btn btn-primary" style={{ margin: '0 auto', width: 'fit-content' }}>
                <Download size={20} />
                {DASHBOARD_URL ? 'Open AutoReach' : 'Set up AutoReach'}
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <p>© 2026 AutoReach.</p>
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center', gap: '2rem' }}>
            <Link to="/privacy" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem' }}>Privacy Policy</Link>
          </div>
        </div>
      </footer>
    </>
  );
};

const App = () => {
  return (
    <div className="landing-page">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/privacy" element={<Privacy />} />
      </Routes>
    </div>
  );
};

export default App;
