import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

function Dashboard() {
    const [stats, setStats] = useState({ sentToday: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
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

        fetchStats();
    }, []);

    if (loading) {
        return <div className="p-6 flex justify-center items-center h-full"><div className="animate-spin h-6 w-6 border-2 border-blue-500 rounded-full border-t-transparent"></div></div>;
    }

    return (
        <div className="p-6 h-screen bg-slate-50 flex flex-col">
            <h2 className="text-xl font-bold text-slate-900 mb-6">Overview</h2>

            <div className="grid grid-cols-2 gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex flex-col items-center justify-center min-h-[120px]">
                    <span className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-2">Sent Today</span>
                    <div className="flex items-baseline space-x-1">
                        <span className="text-4xl font-bold text-slate-900">{stats.sentToday}</span>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-md p-5 flex flex-col items-center justify-center min-h-[120px] text-white">
                    <span className="text-blue-100 text-xs font-medium uppercase tracking-wider mb-2">Automated Queue</span>
                    <span className="text-lg font-semibold flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full border border-white animate-pulse"></div>
                        Active
                    </span>
                </div>
            </div>

            <div className="mt-8 bg-white rounded-xl border border-slate-100 p-5 flex-1 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-800 mb-4 border-b border-slate-50 pb-2">Recent Activity</h3>
                <div className="flex flex-col items-center justify-center h-48 text-center px-4">
                    <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3">
                        <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <p className="text-sm text-slate-500">Activity logs will appear here once emails start sending.</p>
                </div>
            </div>
        </div>
    );
}

export default Dashboard;
