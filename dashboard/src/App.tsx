import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { configureApi } from './lib/api';
import { useAuth } from './lib/auth';
import { Login } from './pages/Login';

const Overview = lazy(() => import('./pages/Overview'));
const Recruiters = lazy(() => import('./pages/Recruiters'));
const Opportunities = lazy(() => import('./pages/Opportunities'));
const OpportunityPage = lazy(() => import('./pages/OpportunityPage'));
const Outreach = lazy(() => import('./pages/Outreach'));
const Composer = lazy(() => import('./pages/Composer'));
const MessagePage = lazy(() => import('./pages/MessagePage'));
const FollowUps = lazy(() => import('./pages/FollowUps'));
const Analytics = lazy(() => import('./pages/Analytics'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Onboarding = lazy(() => import('./pages/Onboarding'));

export function App() {
  const auth = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    configureApi({
      getToken: auth.getToken,
      refresh: auth.refresh,
      onUnauthenticated: () => {
        qc.clear();
        void auth.signOut();
      },
    });
  }, [auth, qc]);

  if (!auth.ready) return <div className="p-8"><Spinner label="Starting" /></div>;
  if (!auth.signedIn) return <Login />;

  return (
    <Suspense fallback={<div className="p-8"><Spinner /></div>}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="recruiters" element={<Recruiters />} />
          <Route path="opportunities" element={<Opportunities />} />
          <Route path="opportunities/:id" element={<OpportunityPage />} />
          <Route path="outreach" element={<Outreach />} />
          <Route path="outreach/new" element={<Composer />} />
          <Route path="outreach/:id" element={<MessagePage />} />
          <Route path="followups" element={<FollowUps />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
