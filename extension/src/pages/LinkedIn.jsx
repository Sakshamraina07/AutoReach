import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

function LinkedIn() {
  const [profile, setProfile] = useState(null);
  const [targetRole, setTargetRole] = useState('');
  const [guessedEmail, setGuessedEmail] = useState(null);
  const [manualEmail, setManualEmail] = useState('');
  const [manualCompany, setManualCompany] = useState('');
  const [emailSource, setEmailSource] = useState('');
  const [addingToQueue, setAddingToQueue] = useState(false);
  const [message, setMessage] = useState('');
  const [step, setStep] = useState('idle');

  useEffect(() => {
    const handleMessage = (msg) => {
      if (msg.type === 'LINKEDIN_PROFILE_LOADED' && msg.data?.name) {
        setProfile(msg.data);
        setStep('idle');
        setGuessedEmail(null);
        setManualEmail('');
        setManualCompany('');
        setTargetRole('');
        setMessage('');
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const handleScrape = async () => {
    setStep('scraping');
    setMessage('');
    setGuessedEmail(null);
    setManualEmail('');
    setManualCompany('');
    setTargetRole('');

    try {
      // Ask background to actively scrape the open LinkedIn tab right now
      const scrapeResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'SCRAPE_LINKEDIN_NOW' }, resolve);
      });

      if (!scrapeResult?.success) {
        setMessage(scrapeResult?.error || 'Please open a LinkedIn profile page (linkedin.com/in/...) and try again.');
        setStep('idle');
        return;
      }

      const profileData = scrapeResult.data;

      if (!profileData?.name) {
        setMessage('Profile page loaded but name could not be detected. Scroll down a bit and try again.');
        setStep('idle');
        return;
      }

      // Auto guess email
      try {
        const response = await api.post('/linkedin/guess-email', { profile: profileData });
        if (response.data.success && response.data.email) {
          setGuessedEmail(response.data.email);
          setEmailSource(response.data.emailSource);
        }
      } catch (e) {
        // Email guess failed silently
      }

      setProfile(profileData);
      setStep('idle');
    } catch (err) {
      setMessage('Scraping failed: ' + err.message);
      setStep('idle');
    }
  };

  const handleAddToQueue = async () => {
    const finalEmail = manualEmail.trim() || guessedEmail;
    const finalCompany = manualCompany.trim() || profile.company || 'Unknown';

    if (!finalEmail) {
      setMessage('Please enter the recruiter email.');
      return;
    }
    if (!targetRole.trim()) {
      setMessage('Please enter the target role.');
      return;
    }
    setAddingToQueue(true);
    try {
      await api.post('/hr/add', {
        hr_name: profile.name,
        company: finalCompany,
        email: finalEmail,
        role: targetRole.trim(),
        source: 'linkedin',
      });
      setMessage('✅ Added to queue! Email will be sent using your template.');
      setStep('idle');
      setProfile(null);
      setGuessedEmail(null);
      setManualEmail('');
      setManualCompany('');
      setTargetRole('');
    } catch (err) {
      setMessage('Failed to add: ' + (err.response?.data?.error || err.message));
    } finally {
      setAddingToQueue(false);
    }
  };

  return (
    <div className="p-4 h-screen overflow-y-auto bg-slate-50">
      <h2 className="text-xl font-bold text-slate-900 mb-1">LinkedIn Outreach</h2>
      <p className="text-xs text-slate-500 mb-5">
        Open a LinkedIn recruiter profile → Scrape → Enter role → Add to queue. Your email template handles the rest.
      </p>

      {/* Step 1 — Scrape */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">1</span>
          Scrape LinkedIn Profile
        </h3>
        <button
          onClick={handleScrape}
          disabled={step === 'scraping'}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {step === 'scraping' ? (
            <><div className="animate-spin h-4 w-4 border-2 border-white rounded-full border-t-transparent" />Scraping...</>
          ) : (
            <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>Scrape Active LinkedIn Tab</>
          )}
        </button>

        {profile && (
          <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
            <p className="text-sm font-semibold text-slate-800">{profile.name}</p>
            {profile.headline && <p className="text-xs text-slate-600">{profile.headline}</p>}
            {profile.company
              ? <p className="text-xs text-green-600">🏢 {profile.company} ✅</p>
              : <p className="text-xs text-amber-600">🏢 Company not detected — enter below</p>
            }
            {profile.location && <p className="text-xs text-slate-500">📍 {profile.location}</p>}
            {guessedEmail && (
              <p className="text-xs text-green-600 font-mono mt-1">📧 {guessedEmail}</p>
            )}
            <p className="text-xs text-green-600 font-medium mt-1">✅ Profile scraped</p>
          </div>
        )}
      </div>

      {/* Step 2 — Details */}
      {profile && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">2</span>
            Enter Details
          </h3>

          {/* Company field — only show if not detected */}
          {!profile.company && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Company Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={manualCompany}
                onChange={(e) => setManualCompany(e.target.value)}
                placeholder="e.g. Tata Consultancy Services"
                className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 bg-amber-50"
              />
              <p className="text-xs text-amber-600 mt-1">⚠️ Not detected from experience — enter manually</p>
            </div>
          )}

          {/* Email field */}
          {!guessedEmail && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Recruiter Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="recruiter@company.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-amber-600 mt-1">⚠️ Could not auto-guess — enter manually</p>
            </div>
          )}

          {guessedEmail && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-700 mb-1">Recruiter Email</label>
              <input
                type="email"
                value={manualEmail || guessedEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                className="w-full px-3 py-2 border border-green-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 bg-green-50"
              />
              <p className="text-xs text-green-600 mt-1">✅ Auto-guessed — edit if incorrect</p>
            </div>
          )}

          {/* Role field */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Target Role <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="e.g. Software Engineer Intern"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Fills the {'{role}'} variable in your template</p>
          </div>
        </div>
      )}

      {/* Step 3 — Add to Queue */}
      {profile && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">3</span>
            Add to AutoReach Queue
          </h3>
          <button
            onClick={handleAddToQueue}
            disabled={addingToQueue || (!guessedEmail && !manualEmail.trim()) || !targetRole.trim() || (!profile.company && !manualCompany.trim())}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {addingToQueue ? (
              <><div className="animate-spin h-4 w-4 border-2 border-white rounded-full border-t-transparent" />Adding...</>
            ) : (
              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>Add to Queue & Send</>
            )}
          </button>
        </div>
      )}

      {message && (
        <div className={`p-3 rounded-lg text-sm text-center font-medium ${message.includes('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
          {message}
        </div>
      )}
    </div>
  );
}

export default LinkedIn;