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
        <Route path="/demo" element={<Navigate to="/demo/dash" replace />} />
        <Route path="/demo/:route" element={<ScopeProvider demo><Shell /></ScopeProvider>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
