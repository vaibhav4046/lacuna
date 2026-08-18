export function Void() {
  return (
    <section data-scene="void" style={{ position: 'relative', height: '140vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div data-fx="void-a" style={{ position: 'absolute', top: '20%', left: 0, right: 0, textAlign: 'center', opacity: 0, padding: '0 20px' }}>
          <h2 style={{ fontSize: 'clamp(36px, 4vw, 68px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>No evidence means no answer.</h2>
        </div>
      </div>
    </section>
  );
}
