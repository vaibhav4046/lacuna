import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MemoryField } from './canvas/MemoryField';
import { SessionProvider } from './api/session';
import { RequireSession } from './app/RequireSession';
import { ScopeProvider } from './api/scope';
import { connectorAliasTarget } from './app/product-contracts';

const Landing = lazy(() => import('./landing/Landing'));
const SignIn = lazy(() => import('./auth/SignIn'));
const SignUp = lazy(() => import('./auth/SignUp'));
const Forgot = lazy(() => import('./auth/Forgot'));
const Onboarding = lazy(() => import('./onboarding/Onboarding'));
const Shell = lazy(() => import('./app/Shell'));
const Judge = lazy(() => import('./pages/Judge').then((module) => ({ default: module.Judge })));
const NotFound = lazy(() => import('./pages/NotFound'));
const LegacyDemo = lazy(() => import('./pages/LegacyDemo').then((module) => ({ default: module.LegacyDemo })));

function ConnectorAlias() {
  const location = useLocation();
  const target = connectorAliasTarget(location.pathname, location.hash);
  return <Navigate to={target ?? '/'} replace />;
}

/**
 * The canvas mounts once, above the router, the way it sits above every view
 * branch in the design. Routes are added as each surface is ported; a route
 * that does not exist yet is not stubbed, it is simply not routed.
 */
export default function App() {
  return (
    <SessionProvider>
      <MemoryField />
      <Suspense fallback={<div role="status" style={{ minHeight: '100vh', background: '#000000' }} />}>
        <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/judge" element={<Judge />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/onboarding" element={<RequireSession><Onboarding /></RequireSession>} />
        <Route path="/app" element={<Navigate to="/app/dash" replace />} />
        <Route path="/app/connectors" element={<ConnectorAlias />} />
        <Route path="/app/:route" element={<RequireSession><Shell /></RequireSession>} />
        <Route path="/explore" element={<Navigate to="/explore/dash" replace />} />
        <Route path="/explore/connectors" element={<ConnectorAlias />} />
        <Route path="/explore/:route" element={<ScopeProvider demo><Shell /></ScopeProvider>} />
        {/*
          The public workspace used to live under /demo. Those links are in
          documents, a social card and a video frame, and a link somebody else
          published is not ours to break.
        */}
        <Route path="/demo" element={<Navigate to="/explore/dash" replace />} />
        <Route path="/demo/:route" element={<LegacyDemo />} />
        {/*
          A real Not Found rather than a redirect to the front page. Sending a
          mistyped address to `/` shows a reader a working page and hides the
          fact that the link they followed is broken.
        */}
        <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </SessionProvider>
  );
}
