import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

function Recruiters() {
    const [recruiters, setRecruiters] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);

    const fetchRecruiters = async () => {
        setLoading(true);
        try {
            const res = await api.get('/hr/list');
            setRecruiters(res.data.recruiters || []);
        } catch (error) {
            console.error('Error fetching recruiters', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRecruiters();
    }, []);

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this recruiter?')) return;
        try {
            await api.delete(`/hr/${id}`);
            setRecruiters(recruiters.filter(r => r.id !== id));
        } catch (error) {
            alert('Failed to delete recruiter.');
        }
    };

    const StatusBadge = ({ status }) => {
        let colors = 'bg-slate-100 text-slate-600';
        if (status === 'Sent') colors = 'bg-green-100 text-green-700';
        if (status === 'Failed') colors = 'bg-red-100 text-red-700';
        return (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${colors}`}>
                {status}
            </span>
        );
    };

    return (
        <div className="flex flex-col h-full bg-slate-50">
            <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center sticky top-0 z-10">
                <h2 className="text-lg font-bold text-slate-800 tracking-tight">Recruiters</h2>
                <div className="flex gap-2">
                    <button onClick={() => setShowImportModal(true)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors shadow-sm">
                        Import CSV
                    </button>
                    <button onClick={() => setShowAddModal(true)} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors shadow-sm">
                        + Add
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 relative min-h-[300px]">
                {loading ? (
                    <div className="flex justify-center p-8"><div className="animate-spin h-6 w-6 border-2 border-blue-500 rounded-full border-t-transparent"></div></div>
                ) : recruiters.length === 0 ? (
                    <div className="text-center p-8 bg-white border border-slate-200 rounded-lg">
                        <p className="text-slate-500 text-sm">No recruiters added yet.</p>
                        <button onClick={() => setShowAddModal(true)} className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add your first recruiter</button>
                    </div>
                ) : (
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Contact</th>
                                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 text-center">Status</th>
                                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500"></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-100">
                                {recruiters.map(r => (
                                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-3 py-2 max-w-[150px] truncate">
                                            <div className="font-medium text-slate-900 truncate">{r.hr_name || r.company}</div>
                                            <div className="text-xs text-slate-500 truncate">{r.email}</div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[10px] text-slate-400 font-medium capitalize">{r.source}</span>
                                                {r.status === 'Sent' && r.followup_count > 0 && (
                                                    <span className="text-[10px] text-blue-500 font-medium">F/Up {r.followup_count}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-center whitespace-nowrap">
                                            <StatusBadge status={r.status} />
                                        </td>
                                        <td className="px-3 py-2 text-right whitespace-nowrap">
                                            <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-600 p-1">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {showAddModal && <AddModal onClose={() => setShowAddModal(false)} refresh={fetchRecruiters} />}
            {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} refresh={fetchRecruiters} />}
        </div>
    );
}

function AddModal({ onClose, refresh }) {
    const [form, setForm] = useState({ hr_name: '', company: '', email: '', role: '', source: 'manual' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            await api.post('/hr/add', form);
            refresh();
            onClose();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to add contact');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center p-4 border-b border-slate-100 sticky top-0 bg-white">
                    <h3 className="font-bold text-slate-800">Add Recruiter</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                </div>
                <form onSubmit={handleSubmit} className="p-4 space-y-3">
                    {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}
                    <div><label className="text-xs font-medium text-slate-600">Company *</label><input required className="w-full mt-1 px-3 py-2 border rounded-md text-sm border-slate-300 focus:ring-blue-500 focus:border-blue-500" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
                    <div><label className="text-xs font-medium text-slate-600">Name</label><input className="w-full mt-1 px-3 py-2 border rounded-md text-sm border-slate-300 focus:ring-blue-500 focus:border-blue-500" value={form.hr_name} onChange={(e) => setForm({ ...form, hr_name: e.target.value })} placeholder="e.g. John Doe" /></div>
                    <div><label className="text-xs font-medium text-slate-600">Email *</label><input type="email" required className="w-full mt-1 px-3 py-2 border rounded-md text-sm border-slate-300 focus:ring-blue-500 focus:border-blue-500" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                    <div><label className="text-xs font-medium text-slate-600">Role</label><input className="w-full mt-1 px-3 py-2 border rounded-md text-sm border-slate-300 focus:ring-blue-500 focus:border-blue-500" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g. University Recruiter" /></div>
                    <div>
                        <label className="text-xs font-medium text-slate-600">Source</label>
                        <select className="w-full mt-1 px-3 py-2 border rounded-md text-sm border-slate-300 focus:ring-blue-500" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                            <option value="manual">Manual Entry</option>
                            <option value="linkedin">LinkedIn</option>
                            <option value="company_site">Company Website</option>
                        </select>
                    </div>
                    <button disabled={loading} className="w-full py-2 bg-blue-600 text-white rounded-md text-sm font-medium mt-4 hover:bg-blue-700 disabled:opacity-50">
                        {loading ? 'Adding...' : 'Save Recruiter'}
                    </button>
                </form>
            </div>
        </div>
    );
}

function ImportModal({ onClose, refresh }) {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    const handleImport = async () => {
        if (!file) return;
        setLoading(true);
        setMessage('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await api.post('/hr/import', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setMessage(`Success: ${res.data.message}`);
            setTimeout(() => { refresh(); onClose(); }, 2000);
        } catch (err) {
            setMessage(`Error: ${err.response?.data?.error || 'Import failed'}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
                <div className="flex justify-between items-center p-4 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800">Import Contacts</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                </div>
                <div className="p-4 space-y-4">
                    <p className="text-xs text-slate-500">
                        Upload a CSV containing <code className="bg-slate-100 px-1 rounded text-pink-600">Company</code> and <code className="bg-slate-100 px-1 rounded text-pink-600">Email</code>. Optional: Name, Role. Generic/domain emails are filtered automatically.
                    </p>
                    <input type="file" accept=".csv" onChange={e => setFile(e.target.files[0])} className="text-sm block w-full file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />

                    {message && <div className={`text-xs p-2 rounded ${message.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{message}</div>}

                    <button onClick={handleImport} disabled={!file || loading} className="w-full py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {loading ? 'Importing...' : 'Upload CSV'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Recruiters;
