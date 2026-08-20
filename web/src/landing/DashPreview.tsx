import { useNavigate } from 'react-router-dom';

export function DashPreview() {
  const go = useNavigate();
  return (
    <section data-scene="quiet" style={{ position: 'relative', padding: '12vh clamp(20px, 4.4vw, 72px) 14vh' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '22px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 'clamp(38px, 4.4vw, 74px)', fontWeight: 400, lineHeight: 1.02, letterSpacing: '-0.04em', margin: 0, color: '#FFFFFF' }}>Simple on top.<br />Serious underneath.</h2>
        <p style={{ fontSize: '17px', lineHeight: 1.7, color: '#9A9A9A', margin: 0, maxWidth: '48ch' }}>Ask is the everyday surface. Memory, timeline, graph, agents and proof sit one level deeper.</p>
        <button className="hv-violet" onClick={() => go('/explore/dash')} style={{ background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '15px', fontWeight: 500, padding: '13px 24px', borderRadius: '8px', marginTop: '6px' }}>Open Lacuna</button>
      </div>
    </section>
  );
}
