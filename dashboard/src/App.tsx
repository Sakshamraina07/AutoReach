import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
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
const GmailCallback = lazy(() => import('./pages/GmailCallback'));
const JobNew = lazy(() => import('./pages/JobNew'));
const JobPage = lazy(() => import('./pages/JobPage'));
const CareerOps = lazy(() => import('./pages/CareerOps'));

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
        <Route path="/gmail/callback" element={<GmailCallback />} />
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="recruiters" element={<Recruiters />} />
          <Route path="opportunities" element={<Opportunities />} />
          <Route path="opportunities/:id" element={<OpportunityPage />} />
          <Route path="jobs/new" element={<JobNew />} />
          <Route path="jobs/:id" element={<JobPage />} />
          <Route path="career-ops" element={<CareerOps />} />
          <Route path="outreach" element={<Outreach />} />
          <Route path="outreach/new" element={<ComposerRoute />} />
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

/**
 * A fresh composer for every navigation to it (for example "Write email" for another
 * recruiter while one is open), but not for the URL updates the composer makes itself.
 */
function ComposerRoute() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [instance, setInstance] = useState({ key: location.key, seen: location.key });
  if (location.key !== instance.seen) {
    // Back/forward restores an older entry (its saved state included): always start fresh then.
    const internal = navigationType !== 'POP' && (location.state as { composerInternal?: boolean } | null)?.composerInternal === true;
    setInstance({ key: internal ? instance.key : location.key, seen: location.key });
  }
  return <Composer key={instance.key} />;
}
