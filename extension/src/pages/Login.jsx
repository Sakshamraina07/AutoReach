import React from 'react';
import { useAuth } from '../contexts/AuthContext';

function Login() {
    const { signInWithGoogle } = useAuth();

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
            <div className="w-full max-w-sm bg-white rounded-xl shadow-lg overflow-hidden flex flex-col items-center p-8 space-y-6 text-center border border-slate-100">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-inner mb-2">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                    </svg>
                </div>

                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">AutoReach</h1>
                    <p className="text-slate-500 mt-2 text-sm leading-relaxed">Cold email automation designed for students and recruiters.</p>
                </div>

                <div className="w-full space-y-3 pt-4">
                    <button
                        onClick={signInWithGoogle}
                        className="w-full relative flex items-center justify-center py-3.5 px-4 border border-slate-300 rounded-lg shadow-sm bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
                    >
                        <svg className="w-5 h-5 absolute left-4" viewBox="0 0 48 48">
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                        </svg>
                        Continue with Google
                    </button>

                    <p className="text-xs text-slate-400 mt-6">
                        By continuing, you acknowledge that you are using this tool responsibly.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default Login;
