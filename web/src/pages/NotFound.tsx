import { Link } from 'react-router-dom';

import { MONO } from '../design/mark';

/**
 * A page that says the address is wrong, rather than the front page pretending
 * it was right.
 *
 * The catch-all used to redirect to `/`, so a mistyped or stale link showed the
 * landing page and a reader had no way to tell they had gone somewhere that
 * does not exist. That is also how a broken link in somebody else's write-up
 * stays broken without anybody noticing.
 */

const label = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.18em', color: '#7A7A7A' } as const;

export default function NotFound() {
  return (
    <main style={{ background: '#000000', minHeight: '100vh', color: '#FFFFFF', padding: '64px 24px', display: 'flex', alignItems: 'center' }}>
      <div style={{ maxWidth: '620px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <span style={label}>404 · NOTHING HERE</span>
        <h1 style={{ fontSize: 'clamp(30px, 5vw, 46px)', fontWeight: 300, letterSpacing: '-0.02em', margin: 0 }}>
          That address does not exist.
        </h1>
        <p style={{ color: '#9A9A9A', fontSize: '16px', lineHeight: 1.6, margin: 0, maxWidth: '58ch' }}>
          It was either mistyped or it moved. Nothing was logged and nothing was recorded.
        </p>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', paddingTop: '6px' }}>
          <Link to="/" style={{ ...label, color: '#9A9A9A', textDecoration: 'none' }}>LACUNA</Link>
          <Link to="/judge" style={{ ...label, color: '#9A9A9A', textDecoration: 'none' }}>SEE IT ANSWER</Link>
          <Link to="/explore/dash" style={{ ...label, color: '#9A9A9A', textDecoration: 'none' }}>OPEN THE PRODUCT</Link>
        </div>
      </div>
    </main>
  );
}
