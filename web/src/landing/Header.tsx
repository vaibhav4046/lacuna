import { useNavigate } from 'react-router-dom';

import { useSession } from '../api/session';
import { MONO, Mark } from '../design/mark';
import { landingAccountActions } from './account-actions';

const link = {
  color: '#9A9A9A',
  fontFamily: MONO,
  fontSize: '10.5px',
  fontWeight: 500,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
} as const;

const sectionLinks = [
  ['Product', '#product'],
  ['How it works', '#how'],
  ['Developers', '#dev'],
  ['Benchmarks', '#evals'],
  ['FAQ', '#faq'],
] as const;

/** The reference header stays visually quiet so the field remains the hero. */
export function Header() {
  const go = useNavigate();
  const { loaded } = useSession();
  const account = landingAccountActions(loaded);

  return (
    <header
      data-shield
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '24px',
        padding: '16px clamp(20px, 3.4vw, 44px)',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.88), rgba(0,0,0,0))',
        pointerEvents: 'none',
      }}
    >
      <a
        href="#top"
        aria-label="Lacuna home"
        style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#FFFFFF', pointerEvents: 'auto' }}
      >
        <Mark size={21} />
        <span style={{ fontSize: '15px', fontWeight: 500, letterSpacing: '0.01em' }}>Lacuna</span>
      </a>

      <nav
        data-navlinks="1"
        aria-label="Landing page"
        style={{ display: 'flex', alignItems: 'center', gap: 'clamp(18px, 2.3vw, 32px)', pointerEvents: 'auto' }}
      >
        {sectionLinks.map(([label, href]) => <a key={href} href={href} style={link}>{label}</a>)}
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'auto' }}>
        <button
          data-navwide="1"
          className="hv-text"
          onClick={() => go('/judge')}
          style={{ minHeight: '44px', background: 'none', border: 'none', cursor: 'pointer', color: '#BDBDBD', fontSize: '13px', padding: '9px 10px' }}
        >
          Judge proof
        </button>
        {account.state === 'guest' ? (
          <>
            <button
              data-navwide="1"
              className="hv-text"
              onClick={() => go(account.secondary.path)}
              style={{ minHeight: '44px', background: 'none', border: 'none', cursor: 'pointer', color: '#BDBDBD', fontSize: '14px', padding: '9px 12px' }}
            >
              {account.secondary.label}
            </button>
            <button
              className="hv-violet"
              onClick={() => go(account.primary.path)}
              style={{ minHeight: '44px', background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '14px', fontWeight: 500, padding: '9px 18px', borderRadius: '8px' }}
            >
              {account.primary.label}
            </button>
          </>
        ) : account.state === 'member' ? (
          <button
            className="hv-violet"
            onClick={() => go(account.primary.path)}
            style={{ minHeight: '44px', background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '14px', fontWeight: 500, padding: '9px 18px', borderRadius: '8px' }}
          >
            {account.primary.label}
          </button>
        ) : (
          <span data-navwide="1" role="status" style={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', color: '#7A7A7A', fontFamily: MONO, fontSize: '9px', letterSpacing: '0.14em' }}>CHECKING SESSION</span>
        )}
        <details data-navmenu="1" style={{ position: 'relative' }}>
          <summary
            aria-label="Open navigation menu"
            style={{
              minWidth: '44px',
              minHeight: '44px',
              boxSizing: 'border-box',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              color: '#BDBDBD',
              fontFamily: MONO,
              fontSize: '9px',
              letterSpacing: '0.14em',
              listStyle: 'none',
            }}
          >
            Menu
          </summary>
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 7px)',
              right: 0,
              width: 'min(300px, calc(100vw - 32px))',
              display: 'flex',
              flexDirection: 'column',
              padding: '8px 0',
              background: '#000000',
              borderTop: '1px solid rgba(255,255,255,0.2)',
              borderBottom: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            {sectionLinks.map(([label, href]) => (
              <a
                key={href}
                href={href}
                style={{ ...link, minHeight: '44px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: '0 14px' }}
                onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
              >
                {label}
              </a>
            ))}
            <span aria-hidden="true" style={{ height: '1px', margin: '5px 14px', background: 'rgba(255,255,255,0.12)' }} />
            <button
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                go('/judge');
              }}
              style={{ minHeight: '44px', display: 'flex', alignItems: 'center', padding: '0 14px', color: '#BDBDBD', background: 'none', border: 0, cursor: 'pointer', fontSize: '14px', textAlign: 'left' }}
            >
              Judge proof
            </button>
            {account.state === 'pending' ? (
              <span role="status" style={{ minHeight: '44px', display: 'flex', alignItems: 'center', padding: '0 14px', color: '#7A7A7A', fontFamily: MONO, fontSize: '9px', letterSpacing: '0.14em' }}>CHECKING SESSION</span>
            ) : account.links.map((item) => (
              <button
                key={item.path}
                onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open');
                  go(item.path);
                }}
                style={{ minHeight: '44px', display: 'flex', alignItems: 'center', padding: '0 14px', color: '#BDBDBD', background: 'none', border: 0, cursor: 'pointer', fontSize: '14px', textAlign: 'left' }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </details>
      </div>
    </header>
  );
}
