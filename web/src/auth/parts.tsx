import { useNavigate } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';
import { MONO, Mark } from '../design/mark';

/**
 * The three auth screens share their frame byte for byte: same page wrapper,
 * same brand button back to the landing page, same labelled input, same violet
 * primary button, same mono secondary links. Writing that markup once is not a
 * component the design does not have, it is the same markup once instead of
 * three times. What differs per screen, the headline and the copy, stays in
 * the screen.
 */

export const PAGE: CSSProperties = { position: 'relative', zIndex: 1, minHeight: '100vh', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '60px', flexWrap: 'wrap', padding: '80px clamp(24px, 6vw, 110px)' };
export const LEFT: CSSProperties = { maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '22px' };
export const FORM: CSSProperties = { margin: 0, width: 'min(360px, 100%)', display: 'flex', flexDirection: 'column', gap: '16px' };
export const LEAD: CSSProperties = { fontSize: '17px', lineHeight: 1.7, color: '#9A9A9A', margin: 0 };
export const PRIMARY: CSSProperties = { background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '15px', fontWeight: 500, padding: '13px 22px', borderRadius: '8px', marginTop: '6px' };
export const MINOR: CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: '#BDBDBD', padding: 0, fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em' };
export const MINOR_DIM: CSSProperties = { ...MINOR, color: '#7A7A7A' };

export function Brand() {
  const go = useNavigate();
  return (
    <button onClick={() => go('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', padding: 0, marginBottom: '18px' }}>
      <Mark size={20} />
      <span style={{ fontSize: '14px', fontWeight: 500, color: '#FFFFFF' }}>Lacuna</span>
    </button>
  );
}

export function Field({ label, type, placeholder, value, onChange, autoComplete }: {
  label: string;
  type: 'email' | 'password';
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#9A9A9A' }}>{label}</span>
      <input
        className="fv-violet"
        type={type}
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.16)', borderRadius: '8px', padding: '13px 14px', color: '#FFFFFF', fontSize: '15px', outline: 'none' }}
      />
    </label>
  );
}

/**
 * A form that can fail has to be able to say so. The design draws no error
 * state on these screens, so this is the design's own mono treatment carrying
 * the design's own error vocabulary, and nothing renders at all when there is
 * nothing to report.
 */
export function Problem({ children }: { children: ReactNode }) {
  if (children === null) return null;
  return (
    <span role="alert" style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#BDBDBD', lineHeight: 1.8 }}>{children}</span>
  );
}
