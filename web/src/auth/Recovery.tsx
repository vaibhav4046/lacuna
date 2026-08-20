import { useState } from 'react';

import { MONO } from '../design/mark';

/**
 * The recovery code, on the only screen it will ever appear on.
 *
 * It is generated on the server and stored as a hash, so this render is the
 * single moment it exists anywhere readable. That is worth being blunt about
 * rather than softening: a person who clicks past this has no way back into
 * their account if they forget the password, and there is no second channel
 * here to prove who they are, because nothing in this deployment sends email.
 *
 * So the continue button is disabled until they say they have saved it. Not as
 * a dark pattern in reverse, but because the alternative is somebody losing an
 * account to a button they pressed without reading, and this is the one screen
 * where that is unrecoverable.
 */
export function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard permission refused, or an insecure context. The code is on
      // screen either way, so this is not worth an error message.
      setCopied(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '46ch' }}>
      <h1 style={{ fontSize: 'clamp(30px, 3.4vw, 46px)', fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.03em', margin: 0, color: '#FFFFFF' }}>
        Save this code.
      </h1>
      <p style={{ fontSize: '15.5px', color: '#BDBDBD', margin: 0, lineHeight: 1.7 }}>
        It is the only way back into your account if you forget your password. Nothing here sends
        email, so nobody can send it to you again, and it is stored as a hash so nobody here can
        read it either. Write it down.
      </p>

      <div style={{ border: '1px solid rgba(128,82,255,0.5)', borderRadius: '10px', padding: '18px 20px', background: 'rgba(128,82,255,0.05)' }}>
        <div style={{ fontFamily: MONO, fontSize: 'clamp(16px, 2.4vw, 22px)', letterSpacing: '0.14em', color: '#FFFFFF', wordBreak: 'break-all', lineHeight: 1.6 }}>
          {code}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          className="hv-text"
          type="button"
          onClick={() => void copy()}
          style={{ background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '8px 13px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', border: '1px solid rgba(255,255,255,0.18)', color: '#BDBDBD' }}
        >{copied ? 'COPIED' : 'COPY'}</button>
        <button
          className="hv-text"
          type="button"
          onClick={() => {
            const blob = new Blob([`Lacuna recovery code\n\n${code}\n\nUse it at /forgot with your email to set a new password.\nIt works once. A new one is issued when you use it.\n`], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'lacuna-recovery-code.txt';
            link.click();
            URL.revokeObjectURL(url);
          }}
          style={{ background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '8px 13px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', border: '1px solid rgba(255,255,255,0.18)', color: '#BDBDBD' }}
        >DOWNLOAD</button>
      </div>

      <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer', fontSize: '14.5px', color: '#BDBDBD', lineHeight: 1.6 }}>
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          style={{ marginTop: '4px', accentColor: '#8052FF', width: '15px', height: '15px', flexShrink: 0 }}
        />
        <span>I have saved this code somewhere I can find it.</span>
      </label>

      <button
        className="hv-violet"
        type="button"
        disabled={!saved}
        onClick={onDone}
        style={{
          background: saved ? '#8052FF' : 'rgba(128,82,255,0.25)',
          border: 'none', borderRadius: '8px', padding: '13px 18px',
          cursor: saved ? 'pointer' : 'not-allowed',
          color: saved ? '#FFFFFF' : '#8A8A8A', fontSize: '15px',
        }}
      >Continue</button>
    </div>
  );
}
