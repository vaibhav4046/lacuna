import { Navigate, Route, Routes } from 'react-router-dom';
import { MemoryField } from './canvas/MemoryField';
import { SessionProvider } from './api/session';
import Landing from './landing/Landing';

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
