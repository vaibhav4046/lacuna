import { Navigate, Route, Routes } from 'react-router-dom';
import { MemoryField } from './canvas/MemoryField';
import { SessionProvider } from './api/session';
import { RequireSession } from './app/RequireSession';
import Landing from './landing/Landing';
import SignIn from './auth/SignIn';
import SignUp from './auth/SignUp';
import Forgot from './auth/Forgot';
import Onboarding from './onboarding/Onboarding';
import Shell from './app/Shell';
import { Judge } from './pages/Judge';
import NotFound from './pages/NotFound';
import { LegacyDemo } from './pages/LegacyDemo';
import { ScopeProvider } from './api/scope';

/**
 * The canvas mounts once, above the router, the way it sits above every view
 * branch in the design. Routes are added as each surface is ported; a route
 * that does not exist yet is not stubbed, it is simply not routed.
 */
export default function App() {
  return (
    <SessionProvider>
      <MemoryField />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/judge" element={<Judge />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/onboarding" element={<RequireSession><Onboarding /></RequireSession>} />
        <Route path="/app" element={<Navigate to="/app/dash" replace />} />
        <Route path="/app/:route" element={<RequireSession><Shell /></RequireSession>} />
        <Route path="/explore" element={<Navigate to="/explore/dash" replace />} />
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
    </SessionProvider>
  );
}
