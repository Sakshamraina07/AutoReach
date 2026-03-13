import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

function Setup() {
    const [profile, setProfile] = useState({
        name: '', degree: '', year: '', location: '', contact: '', resume_url: null
    });
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    // Gmail SMTP state
    const [gmailUser, setGmailUser] = useState('');
    const [gmailAppPassword, setGmailAppPassword] = useState('');
    const [gmailConnected, setGmailConnected] = useState(false);
    const [connectedEmail, setConnectedEmail] = useState('');
    const [gmailSaving, setGmailSaving] = useState(false);
    const [gmailMessage, setGmailMessage] = useState('');

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const response = await api.get('/user/me');
                if (response.data.user) {
                    setProfile({
                        name: response.data.user.name || '',
                        degree: response.data.user.degree || '',
                        year: response.data.user.year || '',
                        location: response.data.user.location || '',
                        contact: response.data.user.contact || '',
                        resume_url: response.data.user.resume_url || null
                    });
                }
            } catch (error) {
                console.error('Error fetching profile', error);
            } finally {
                setLoading(false);
            }
        };

        const fetchGmailStatus = async () => {
            try {
                const response = await api.get('/settings/smtp');
                if (response.data.connected) {
                    setGmailConnected(true);
                    setConnectedEmail(response.data.gmail_user);
                }
            } catch (error) {
                setGmailConnected(false);
            }
        };

        fetchProfile();
        fetchGmailStatus();
    }, []);

    const handleChange = (e) => {
        setProfile({ ...profile, [e.target.name]: e.target.value });
    };

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        setMessage('');

        try {
            await api.post('/user/setup', profile);

            if (file) {
                const formData = new FormData();
                formData.append('resume', file);

                const uploadRes = await api.post('/resume/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });

                if (uploadRes.data.resume_url) {
                    setProfile(prev => ({ ...prev, resume_url: uploadRes.data.resume_url }));
                    setFile(null);
                }
            }

            setMessage('Profile saved successfully!');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            setMessage('Failed to save profile. ' + (error.response?.data?.error || error.message));
        } finally {
            setSaving(false);
        }
    };

    const handleGmailSave = async (e) => {
        e.preventDefault();
        setGmailSaving(true);
        setGmailMessage('');

        try {
            await api.post('/settings/smtp', {
                gmail_user: gmailUser,
                gmail_app_password: gmailAppPassword
            });
            setGmailConnected(true);
            setConnectedEmail(gmailUser);
            setGmailUser('');
            setGmailAppPassword('');
            setGmailMessage('Gmail connected successfully!');
            setTimeout(() => setGmailMessage(''), 3000);
        } catch (error) {
            setGmailMessage('Failed to connect Gmail. ' + (error.response?.data?.error || error.message));
        } finally {
            setGmailSaving(false);
        }
    };

    if (loading) return <div className="p-6 flex justify-center"><div className="animate-spin h-6 w-6 border-2 border-blue-500 rounded-full border-t-transparent"></div></div>;

    return (
        <div className="p-6 h-screen overflow-y-auto bg-slate-50">
            <h2 className="text-xl font-bold text-slate-900 mb-6">User Profile</h2>

            <form onSubmit={handleSave} className="space-y-4">
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                        <input type="text" name="name" value={profile.name} onChange={handleChange} className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" required />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Degree</label>
                            <input type="text" name="degree" value={profile.degree} onChange={handleChange} placeholder="e.g. B.S. Computer Science" className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
                            <input type="text" name="year" value={profile.year} onChange={handleChange} placeholder="e.g. 3rd" className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" required />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
                        <input type="text" name="location" value={profile.location} onChange={handleChange} placeholder="e.g. New York, NY" className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" required />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Contact Email/Phone</label>
                        <input type="text" name="contact" value={profile.contact} onChange={handleChange} className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm" required />
                    </div>
                </div>

                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-800 mb-3">Resume Upload</h3>

                    {profile.resume_url && (
                        <div className="mb-4 flex items-center justify-between bg-green-50 p-3 rounded-md border border-green-100">
                            <span className="text-sm text-green-700 flex items-center">
                                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                                Resume uploaded
                            </span>
                            <a href={profile.resume_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-800 font-medium">View</a>
                        </div>
                    )}

                    <input type="file" accept=".pdf,.doc,.docx" onChange={handleFileChange} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                    <p className="mt-2 text-xs text-slate-500">Only PDF or DOCX allowed.</p>
                </div>

                <button
                    type="submit"
                    disabled={saving}
                    className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                    {saving ? 'Saving...' : 'Save Profile'}
                </button>

                {message && (
                    <div className={`mt-3 p-3 rounded-md text-sm text-center font-medium ${message.includes('success') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {message}
                    </div>
                )}
            </form>

            {/* Gmail SMTP Section */}
            <div className="mt-6 bg-white p-5 rounded-xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800 mb-1">Connect Gmail for Sending</h3>
                <p className="text-xs text-slate-500 mb-4">Emails will be sent from your own Gmail account. Use a Google App Password — not your regular password.</p>

                {gmailConnected && (
                    <div className="mb-4 flex items-center justify-between bg-green-50 p-3 rounded-md border border-green-100">
                        <span className="text-sm text-green-700 flex items-center">
                            <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
                            Connected: {connectedEmail}
                        </span>
                        <span className="text-xs text-slate-400">Update below</span>
                    </div>
                )}

                <form onSubmit={handleGmailSave} className="space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Gmail Address</label>
                        <input
                            type="email"
                            value={gmailUser}
                            onChange={e => setGmailUser(e.target.value)}
                            placeholder="you@gmail.com"
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">App Password</label>
                        <input
                            type="password"
                            value={gmailAppPassword}
                            onChange={e => setGmailAppPassword(e.target.value)}
                            placeholder="16-character app password"
                            className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            required
                        />
                        <p className="mt-1 text-xs text-slate-400">
                            Get it from: Google Account → Security → 2-Step Verification → App Passwords
                        </p>
                    </div>
                    <button
                        type="submit"
                        disabled={gmailSaving}
                        className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                    >
                        {gmailSaving ? 'Connecting...' : gmailConnected ? 'Update Gmail' : 'Connect Gmail'}
                    </button>
                </form>

                {gmailMessage && (
                    <div className={`mt-3 p-3 rounded-md text-sm text-center font-medium ${gmailMessage.includes('success') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {gmailMessage}
                    </div>
                )}
            </div>
        </div>
    );
}

export default Setup;