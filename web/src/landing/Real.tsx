import { MONO } from '../design/mark';

export function Real() {
  return (
    <section id="product" data-scene="real" style={{ position: 'relative', height: '250vh' }}>
      <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 'clamp(20px, 5.4vw, 84px)', top: 'max(12%, 96px)', maxWidth: '520px' }}>
          <h2 style={{ fontSize: 'clamp(34px, 3.7vw, 62px)', fontWeight: 400, lineHeight: 1.04, letterSpacing: '-0.035em', margin: 0, color: '#FFFFFF' }}>Your agent remembered everything.<br />That is the problem.</h2>
          <p style={{ fontSize: '17px', lineHeight: 1.75, color: '#9A9A9A', margin: '18px 0 0', maxWidth: '40ch', textWrap: 'pretty' }}>A README says Redis. A Slack thread proposes Postgres. A pull request migrates it. A runbook confirms it. All four are still in memory.</p>
        </div>
        <div data-fx="real-q" style={{ position: 'absolute', left: 'clamp(20px, 5.4vw, 84px)', bottom: '16%', opacity: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#9A9A9A' }}>Query</span>
          <div style={{ fontSize: 'clamp(22px, 2.1vw, 34px)', fontWeight: 400, letterSpacing: '-0.02em', color: '#FFFFFF', marginTop: '10px' }}>Where does session state live now?</div>
        </div>
        <div data-fx="real-a" style={{ position: 'absolute', left: 'min(64%, calc(100vw - 330px))', top: '42%', opacity: 0 }}>
          <div style={{ fontSize: 'clamp(30px, 3vw, 50px)', fontWeight: 400, letterSpacing: '-0.03em', color: '#FFFFFF' }}>Postgres</div>
          <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.15em', color: '#9A9A9A', marginTop: '10px', lineHeight: 2 }}>CURRENT STATE · 2 SUPPORTING SOURCES<br />REDIS PRESERVED IN HISTORY</div>
        </div>
      </div>
    </section>
  );
}
