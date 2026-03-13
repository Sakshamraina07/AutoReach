import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

function SendEmails() {
    const [stats, setStats] = useState({ sentToday: 0 });
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [message, setMessage] = useState('');

    const fetchStats = async () => {
        try {
            const response = await api.get('/email/status');
            setStats(response.data);
        } catch (error) {
            console.error('Failed to fetch stats', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
        // Poll status every 10 seconds while sending could be active
        const interval = setInterval(fetchStats, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleStart = async () => {
        setSending(true);
        setMessage('');
        try {
            const res = await api.post('/email/send');
            setMessage(res.data.message || 'Background queue started successfully.');
            setTimeout(() => setMessage(''), 5000);
        } catch (error) {
            if (error.response?.status === 429) {
                setMessage('Error: Too many requests. Please wait a minute.');
            } else {
                setMessage('Error starting queue. Please check console.');
            }
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-6 tracking-tight">Send Campaigns</h2>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 flex flex-col items-center text-center space-y-6">
                
                <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-2">
                    <svg className="w-10 h-10 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                </div>

                <div>
                    <h3 className="text-lg font-bold text-slate-800">Automated Outreach</h3>
                    <p className="text-sm text-slate-500 mt-2 max-w-xs mx-auto">
                        Emails are sent to your pending database with 30-90 second delays to avoid spam detection.
                    </p>
                </div>

                <div className="w-full bg-slate-50 rounded-lg p-4 border border-slate-100 flex justify-between items-center text-left">
                    <div>
                        <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Emails Sent Today</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-bold text-slate-900">{stats.sentToday || 0}</span>
                            <span className="text-sm font-medium text-slate-400">/ Limit</span>
                        </div>
                    </div>
                </div>

                <div className="w-full pt-4">
                    <button 
                        onClick={handleStart} 
                        disabled={loading || sending}
                        className="w-full py-3 px-4 flex items-center justify-center gap-2 border border-transparent rounded-lg shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-all"
                    >
                        {sending ? (
                            <><div className="animate-spin h-4 w-4 border-2 border-white rounded-full border-t-transparent"></div> Activating Queue...</>
                        ) : (
                            <><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Start Sending</>
                        )}
                    </button>
                </div>
            </div>

            {message && (
                <div className={`mt-4 p-3 rounded-lg text-sm text-center border font-medium ${message.includes('Error') ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}>
                    {message}
                </div>
            )}
            
            <p className="text-xs text-center text-slate-400 mt-6 mt-auto">
                Ensure extensions are fully configured before starting. Background workers will process pending recruiters sequentially.
            </p>
        </div>
    );
}

export default SendEmails;
