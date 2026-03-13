import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

function Template() {
    const [type, setType] = useState('initial');
    const [template, setTemplate] = useState({ subject: '', body: '' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [previewContent, setPreviewContent] = useState(null);

    const fetchTemplate = async (templateType) => {
        setLoading(true);
        try {
            const res = await api.get(`/email/template/${templateType}`);
            if (res.data.template) {
                setTemplate({ subject: res.data.template.subject, body: res.data.template.body });
            } else {
                setTemplate({ subject: '', body: '' });
            }
        } catch (error) {
            console.error('Failed to load template', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplate(type);
    }, [type]);

    const handleSave = async () => {
        setSaving(true);
        setMessage('');
        try {
            await api.post('/email/template', { type, ...template });
            setMessage('Template saved successfully!');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            setMessage('Failed to save template.');
        } finally {
            setSaving(false);
        }
    };

    const handlePreview = async () => {
        setSaving(true);
        try {
            // Provide dummy recruiter data for preview
            const res = await api.post('/email/preview', {
                templateType: type,
                recruiterData: {
                    hr_name: 'Jane Doe',
                    company: 'Acme Corp',
                    role: 'Recruiting Director'
                }
            });
            setPreviewContent(res.data);
            setShowPreview(true);
        } catch (error) {
            alert('Failed to generate preview. Make sure your profile is set up.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50">
            <div className="p-4 bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="flex justify-between items-center mb-3">
                    <h2 className="text-lg font-bold text-slate-800 tracking-tight">Templates</h2>
                    <div className="flex gap-2">
                        <button onClick={handlePreview} disabled={loading || !template.body} className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50">
                            Preview
                        </button>
                        <button onClick={handleSave} disabled={loading || saving} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-lg">
                    {['initial', 'followup_1', 'followup_2'].map(t => (
                        <button
                            key={t}
                            onClick={() => setType(t)}
                            className={`flex-1 text-[11px] font-medium py-1.5 rounded-md capitalize transition-all ${type === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            {t.replace('_', ' ')}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {message && <div className="text-xs bg-green-50 text-green-700 p-2 rounded text-center font-medium">{message}</div>}

                {loading ? (
                    <div className="flex justify-center p-8"><div className="animate-spin h-6 w-6 border-2 border-blue-500 rounded-full border-t-transparent"></div></div>
                ) : (
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Subject Line</label>
                            <input
                                value={template.subject}
                                onChange={(e) => setTemplate({ ...template, subject: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                                placeholder="e.g. Inquiry about {role} role at {company}"
                            />
                        </div>
                        <div>
                            <div className="flex justify-between items-end mb-1">
                                <label className="block text-xs font-semibold text-slate-700">Email Body</label>
                            </div>
                            <textarea
                                value={template.body}
                                onChange={(e) => setTemplate({ ...template, body: e.target.value })}
                                rows={10}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 font-mono text-[13px] leading-relaxed"
                                placeholder="Dear {name},&#10;&#10;I am reaching out regarding..."
                            />
                        </div>

                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                            <h4 className="text-[11px] font-semibold text-blue-800 uppercase tracking-wider mb-2">Available Variables</h4>
                            <div className="flex flex-wrap gap-1.5">
                                {['{name}', '{company}', '{role}', '{year}', '{degree}', '{location}', '{user_name}', '{contact}'].map(v => (
                                    <span key={v} className="bg-white border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer hover:bg-blue-100">
                                        {v}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Preview Modal */}
            {showPreview && previewContent && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800">Preview (Sample Data)</h3>
                            <button onClick={() => setShowPreview(false)} className="text-slate-400 hover:text-slate-600">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto flex-1 text-sm bg-slate-50 space-y-4">
                            <div className="bg-white p-3 rounded border border-slate-200 shadow-sm">
                                <span className="text-xs text-slate-500 font-semibold uppercase block mb-1">Subject</span>
                                <div className="text-slate-900 font-medium">{previewContent.subject || '(Empty)'}</div>
                            </div>
                            <div className="bg-white p-3 rounded border border-slate-200 shadow-sm">
                                <span className="text-xs text-slate-500 font-semibold uppercase block mb-2">Body</span>
                                <div className="text-slate-800 whitespace-pre-wrap">{previewContent.body || '(Empty)'}</div>
                            </div>
                            <div className="flex items-center text-xs text-slate-500 italic mt-4">
                                * Your resume will be automatically attached if uploaded. *
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Template;
