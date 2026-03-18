import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import logo from './assets/logo.png';

function App() {
    const { user, loading, signOut } = useAuth();

    if (loading) {
        return <div className="flex w-full h-full items-center justify-center bg-slate-50"><div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent"></div></div>;
    }

    if (!user) {
        return <Login />;
    }

    return (
        <div className="flex flex-col h-screen w-full bg-white overflow-hidden text-slate-800">
            {/* Header */}
            <header className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-1 flex items-center justify-between shadow-sm z-10 w-full">
                <div className="flex items-center gap-2">
                    <a href="https://auto-reach-ext.vercel.app" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
                        <img src={`${logo}?v=1.0.2`} alt="AutoReach" className="h-10 w-auto object-contain" />
                    </a>
                </div>
                <button onClick={signOut} className="text-xs text-slate-500 hover:text-slate-800 font-medium px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 transition-colors">
                    Sign Out
                </button>
            </header>

            {/* Main scrollable content area */}
            <main className="flex-1 overflow-y-auto bg-slate-50 pb-[64px] w-full items-start">
                <Outlet />
            </main>

            {/* Bottom Navigation */}
            <nav className="fixed bottom-0 bg-white border-t border-slate-200 px-2 py-2 flex justify-between w-full h-[64px] z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <div className="grid grid-cols-5 w-full gap-1 items-center">
                    <NavItem to="/" icon="Home" label="Home" exact />
                    <NavItem to="/recruiters" icon="Database" label="DB" />
                    <NavItem to="/templates" icon="PenTool" label="Templates" />
                    <NavItem to="/send" icon="Send" label="Send" />
                    <NavItem to="/setup" icon="Settings" label="Setup" />
                </div>
            </nav>
        </div>
    );
}

function NavItem({ to, icon, label, exact }) {
    return (
        <NavLink
            to={to}
            end={exact}
            className={({ isActive }) =>
                `flex flex-col items-center justify-center p-2 rounded-lg transition-colors cursor-pointer ${isActive
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`
            }
        >
            <div className="flex flex-col items-center">
                {getIcon(icon)}
                <span className="text-[10px] sm:text-xs font-medium mt-[2px]">{label}</span>
            </div>
        </NavLink>
    );
}

function getIcon(name) {
    const icons = {
        Home: <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
        Database: <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>,
        PenTool: <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>,
        Send: <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>,
        Settings: <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    };
    return icons[name] || icons.Home;
}

export default App;
