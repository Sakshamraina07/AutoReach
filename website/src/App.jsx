import React from 'react';
import { motion } from 'framer-motion';
import { Download, Zap, Shield, Mail, MousePointer2, Settings, CheckCircle2, Github, Linkedin } from 'lucide-react';

const App = () => {
  const features = [
    {
      icon: <Zap size={24} />,
      title: "Intelligent Queueing",
      description: "Send emails with human-like delays (30-90s) to maintain high deliverability and avoid spam filters."
    },
    {
      icon: <Shield size={24} />,
      title: "Gmail OAuth Security",
      description: "Secure, professional-grade OAuth 2.0 connection. No more shared passwords, just pure, direct integration."
    },
    {
      icon: <Mail size={24} />,
      title: "Automated Follow-ups",
      description: "Smart follow-ups that stop automatically when someone replies. Set your drip and let it run."
    },
    {
      icon: <MousePointer2 size={24} />,
      title: "One-Click Import",
      description: "Bulk import HR contacts via CSV with intelligent domain filtering and duplicate prevention."
    },
    {
      icon: <CheckCircle2 size={24} />,
      title: "Open Tracking",
      description: "Real-time analytics on who opened your emails, helping you focus on the most interested leads."
    },
    {
      icon: <Settings size={24} />,
      title: "Smart Warmups",
      description: "Automated daily warmup limits that gradually increase to protect your sender reputation."
    }
  ];

  const steps = [
    {
      number: "01",
      title: "Secure Authentication",
      description: "Connect your Gmail account via Google OAuth 2.0. No passwords shared, just a secure, direct link to your inbox."
    },
    {
      number: "02",
      title: "Import Your Lead List",
      description: "Upload your CSV of recruiters or HR contacts. Our engine automatically filters invalid domains and duplicates."
    },
    {
      number: "03",
      title: "Craft Your Template",
      description: "Set up your personalized outreach message with dynamic tags like {name} and {company} for a personal touch."
    },
    {
      number: "04",
      title: "Automate with Precision",
      description: "Launch the engine. Human-like delays (30-90s) and daily limits ensure your emails land in the primary inbox."
    }
  ];

  const SmartConsole = () => (
    <div className="console-wrapper">
      <div className="console-header">
        <div className="dots">
          <span></span><span></span><span></span>
        </div>
        <div className="console-title">AutoReach Engine v1.0.4</div>
      </div>
      <div className="console-content">
        <div className="console-grid">
          <div className="stat-card">
            <span className="stat-label">DAILY_OUTREACH</span>
            <div className="stat-value">18 <span className="stat-unit">/ 50</span></div>
            <div className="stat-progress">
              <motion.div 
                className="progress-bar"
                initial={{ width: 0 }}
                animate={{ width: '36%' }}
                transition={{ duration: 1.5, ease: "easeOut" }}
              />
            </div>
          </div>
          <div className="stat-card accent">
            <span className="stat-label">ENGINE_STATUS</span>
            <div className="status-indicator">
              <span className="pulse-dot"></span>
              ACTIVE
            </div>
            <div className="stat-subtext">Precision Delays: 30-90s</div>
          </div>
        </div>
        
        <div className="activity-feed">
          <div className="feed-header">RECENT_LOGS</div>
          <div className="log-entries">
            <div className="log-entry">
              <span className="log-time">[01:52:10]</span>
              <span className="log-msg">GMAIL_SYNC: Connected as sakshamraina16@gmail.com</span>
            </div>
            <div className="log-entry">
              <span className="log-time">[01:54:33]</span>
              <span className="log-msg">QUEUE: Initializing follow-up sequence [SET_1]</span>
            </div>
            <div className="log-entry success">
              <span className="log-time">[01:58:12]</span>
              <span className="log-msg">SUCCESS: Outreach sent to gsrprasad@7hillsbiz.com</span>
            </div>
            <div className="log-entry">
              <span className="log-time">[02:01:05]</span>
              <span className="log-msg">WAITING: Human-like delay (42s) remaining...</span>
            </div>
          </div>
        </div>

        <div className="console-footer">
          <div className="footer-tag">SECURE_OAUTH_2.0</div>
          <div className="footer-tag">SUPABASE_DB_SYNC</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="landing-page">
      <header>
        <div className="container nav-content">
          <div className="logo">
            <Zap size={24} fill="#3b82f6" />
            <span>AutoReach</span>
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
              <span className="badge">New: Gmail OAuth 2.0 Integrated</span>
              <h1>Cold Emailing <br /> <span className="highlight">Reimagined.</span></h1>
              <p className="subtitle">
                The ultimate Chrome extension for recruiters and job seekers. Automate your outreach with human-like intelligence and direct Gmail integration.
              </p>
              
              <div className="cta-group">
                <a href="/AutoReachExt.zip" download className="btn btn-primary">
                  <Download size={20} />
                  Download Extension
                </a>
                <a href="#features" className="btn btn-secondary">
                  Learn More
                </a>
              </div>

              <motion.div 
                id="concept"
                className="app-preview"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }}
              >
                <SmartConsole />
              </motion.div>
            </motion.div>
          </div>
        </section>

        <section id="features" className="features">
          <div className="container">
            <div className="section-head">
              <h2>Engineered for Deliverability</h2>
              <p className="subtitle">Powerful features that give you the edge in cold outreach without getting flagged.</p>
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
              <p className="subtitle">From connection to connection. A seamless flow designed for high-impact outreach.</p>
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
                  Saksham Raina is a developer focused on automation, AI systems, and building intelligent productivity tools. 
                  AutoReach was built to eliminate friction from outreach using precision engineering and AI logic.
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
              <h2>Ready to scale your outreach?</h2>
              <p className="subtitle" style={{ marginBottom: '2.5rem' }}>Download the extension and start connecting with recruiters today.</p>
              <a href="/AutoReachExt.zip" download className="btn btn-primary" style={{ margin: '0 auto', width: 'fit-content' }}>
                <Download size={20} />
                Get AutoReach Now
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <p>© 2026 AutoReach. Built for precision outreach.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
