export function Core() {
  return (
    <section data-scene="core" style={{ position: 'relative', height: '150vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', alignItems: 'center', padding: '0 clamp(20px, 4.4vw, 72px)', boxSizing: 'border-box' }}>
        <div style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2 style={{ fontSize: 'clamp(42px, 5vw, 84px)', fontWeight: 400, lineHeight: 1.0, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Lacuna keeps the context.<br />Your agents use it.</h2>
          <p style={{ fontSize: '18px', lineHeight: 1.7, color: '#9A9A9A', margin: 0, maxWidth: '48ch', textWrap: 'pretty' }}>Connect your sources once. Lacuna keeps the useful state ready for whatever agent comes next.</p>
        </div>
      </div>
    </section>
  );
}
