import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

function LinkedIn() {
  const [profile, setProfile] = useState(null);
  const [generatedEmail, setGeneratedEmail] = useState(null);
  const [addingToQueue, setAddingToQueue] = useState(false);
  const [message, setMessage] = useState('');
  const [step, setStep] = useState('idle');

  useEffect(() => {
    const handleMessage = (msg) => {
      if (msg.type === 'LINKEDIN_PROFILE_LOADED' && msg.data?.name) {
        setProfile(msg.data);
        setStep('idle');
        setGeneratedEmail(null);
        setMessage('');
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  const handleScrape = async () => {
    setStep('scraping');
    setMessage('');
    setGeneratedEmail(null);
    try {
      // Read profile from chrome.storage (set by content script)
      const result = await new Promise((resolve) => {
        chrome.storage.local.get(['linkedinProfile'], resolve);
      });

      const profileData = result?.linkedinProfile;

      if (!profileData?.name) {
        setMessage('Please open a LinkedIn profile page and wait 2 seconds for it to load, then try again.');
        setStep('idle');
        return;
      }

      setProfile(profileData);
      setStep('idle');
    } catch (err) {
      setMessage('Scraping failed: ' + err.message);
      setStep('idle');
    }
  };

  const handleGenerateEmail = async () => {
    if (!profile) return;
    setStep('generating');
    setMessage('');
    try {
      const response = await api.post('/linkedin/generate', { profile });
      if (response.data.success) {
        setGeneratedEmail(response.data);
        setStep('done');
      } else {
        setMessage(response.data.error || 'Generation failed.');
        setStep('idle');
      }
    } catch (err) {
      setMessage('Error: ' + (err.response?.data?.error || err.message));
      setStep('idle');
    }
  };

  const handleAddToQueue = async () => {
    if (!generatedEmail) return;
    setAddingToQueue(true);
    try {
      await api.post('/hr/add', {
        hr_name: profile.name,
        company: profile.company || 'Unknown',
        email: generatedEmail.email,
        role: profile.currentRole || profile.headline || 'Recruiter',
        source: 'linkedin',
      });
      setMessage('✅ Added to queue! Email will be sent automatically.');
      setStep('idle');
      setProfile(null);
      setGeneratedEmail(null);
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
        Open a LinkedIn recruiter profile → Scrape → AutoReach finds their email and generates a personalized AI email.
      </p>

      {/* Step 1 */}
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
            {profile.company && <p className="text-xs text-slate-500">🏢 {profile.company}</p>}
            {profile.location && <p className="text-xs text-slate-500">📍 {profile.location}</p>}
            {profile.about && <p className="text-xs text-slate-400 italic mt-1">"{profile.about.slice(0, 100)}..."</p>}
            <p className="text-xs text-green-600 font-medium mt-1">✅ Profile scraped</p>
          </div>
        )}
      </div>

      {/* Step 2 */}
      {profile && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">2</span>
            Find Email + Generate AI Email
          </h3>
          <button
            onClick={handleGenerateEmail}
            disabled={step === 'generating'}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {step === 'generating' ? (
              <><div className="animate-spin h-4 w-4 border-2 border-white rounded-full border-t-transparent" />Finding email + generating...</>
            ) : (
              <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Find Email + Generate with AI</>
            )}
          </button>
          {generatedEmail && (
            <div className="mt-3 space-y-2">
              <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                <p className="text-xs font-semibold text-green-800 mb-1">📧 Email Found:</p>
                <p className="text-sm text-green-700 font-mono">{generatedEmail.email || 'Not found — add manually'}</p>
                <p className="text-xs text-green-600 mt-1">Source: {generatedEmail.emailSource}</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                <p className="text-xs font-semibold text-purple-800 mb-2">✨ AI Generated Email:</p>
                <p className="text-xs font-medium text-purple-700 mb-1">Subject: {generatedEmail.subject}</p>
                <div className="text-xs text-purple-600 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                  {generatedEmail.body}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3 */}
      {generatedEmail && generatedEmail.email && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">3</span>
            Add to AutoReach Queue
          </h3>
          <button
            onClick={handleAddToQueue}
            disabled={addingToQueue}
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
        <div className={`p-3 rounded-lg text-sm text-center font-medium ${message.includes('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {message}
        </div>
      )}
    </div>
  );
}

export default LinkedIn;
