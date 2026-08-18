import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { MemoryFieldEngine } from './engine';
import type { EngineState } from './engine';

/**
 * The constellation canvas, and the one place the engine is driven from.
 *
 * In the design this element sits at the document root, outside every view
 * branch, so it mounts once and survives every navigation. Same here: it is
 * rendered above the router, never inside a route, which is what lets the
 * particle state persist while the page under it changes. The engine hides the
 * canvas itself when the view is the signed-in application, because a field
 * drifting behind a table is decoration rather than explanation.
 *
 * The engine keeps its own mutable state object rather than receiving props on
 * every frame. That is not a shortcut: it runs at sixty frames a second off a
 * requestAnimationFrame loop, and a React render per frame would be a second
 * scheduler fighting the first one.
 */

/** The design's own view names, derived from the URL rather than from state. */
function viewFor(pathname: string): EngineState['view'] {
  if (pathname === '/signin') return 'signin';
  if (pathname === '/signup') return 'signup';
  if (pathname === '/forgot') return 'forgot';
  if (pathname === '/onboarding') return 'onboard';
  if (pathname.startsWith('/app')) return 'app';
  return 'landing';
}

export function MemoryField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<MemoryFieldEngine | null>(null);
  const location = useLocation();
  const view = viewFor(location.pathname);

  useEffect(() => {
    const engine = new MemoryFieldEngine(canvasRef, {
      state: { view: viewFor(window.location.pathname), route: 'dash', obStep: 0, healthSel: -1, hoverRev: -1 },
    });
    engineRef.current = engine;
    try {
      engine.mount();
    } catch (error) {
      // A field that fails to start is a page without a field, not a page
      // without a product. The rest of the landing is real text and it renders.
      console.error('lacuna: the memory field did not start', error);
    }
    return () => {
      engineRef.current = null;
      engine.unmount();
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null) return;
    const previous = { view: engine.state.view };
    engine.state.view = view;
    engine.changed(engine.props, previous);
  }, [view]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
        display: 'block',
      }}
    />
  );
}
