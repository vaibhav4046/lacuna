/**
 * The constellation canvas.
 *
 * In the design this element sits at the document root, outside every view
 * branch, so it mounts once and survives every navigation. Same here: it is
 * rendered above the router, never inside a route, which is what lets the
 * particle state persist while the page under it changes.
 *
 * The particle engine lands in its own step. The element and its position are
 * already exact so nothing below it has to move when the engine arrives.
 */

export function MemoryField() {
  return (
    <canvas
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
