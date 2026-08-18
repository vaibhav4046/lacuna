import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postJson } from '../api/client';
import { hydraState, useHealth, UNCHECKED } from '../api/health';
import { useSession } from '../api/session';
import { icStyle } from '../design/icons';
import { MONO, Mark } from '../design/mark';

/**
 * Five steps, and the spiral gains a layer at each one.
 *
 * Two things here are checked rather than stated. The HydraDB line reads what
 * the doctor says, so a step that claims a connection only claims it when
 * there is one. The model list is a choice, not a status: a filled dot means
 * the person picked it, and nothing on this screen says the model answered.
 */

const STEPS = [
  { l: 'CREATE WORKSPACE', t: 'Name your workspace.', b: 'One workspace holds the memory for a project or a team.' },
  { l: 'CONNECT HYDRADB', t: 'Connect HydraDB.', b: 'The context substrate. Memory, knowledge, relationships and history live here.' },
  { l: 'CHOOSE MODEL', t: 'Choose a model.', b: 'The worker. You can change it any time without losing memory.' },
  { l: 'ADD CONTEXT', t: 'Add context.', b: 'Connect a source or paste something worth remembering.' },
  { l: 'ASK SOMETHING', t: 'Ask something.', b: 'The first answer comes with its evidence attached. The spiral completes when the loop does.' },
] as const;

const MODELS = ['claude · anthropic · cloud', 'qwen2.5 · ollama · local', 'compatible endpoint · custom'] as const;

const label = { fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.2em' } as const;
const chip = { border: '1px solid rgba(255,255,255,0.16)', borderRadius: '7px', padding: '8px 12px', color: '#BDBDBD' } as const;

export default function Onboarding() {
  const go = useNavigate();
  const { refresh } = useSession();
  const health = useHealth();
  const [step, setStep] = useState(0);
  const [workspace, setWorkspace] = useState('');
  const [model, setModel] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hydra = hydraState(health);
  const current = STEPS[step] ?? STEPS[0];

  async function next() {
    if (step < 4) { setStep(step + 1); return; }
    setBusy(true);
    setProblem(null);
    const result = await postJson('/api/workspace', { workspace: workspace.trim() === '' ? 'workspace' : workspace.trim() });
    setBusy(false);
    if (!result.ok) { setProblem('Connection failed.'); return; }
    refresh();
    go('/app/dash');
    window.scrollTo(0, 0);
  }

  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 'clamp(40px, 6vw, 110px)', flexWrap: 'wrap', padding: '80px clamp(24px, 6vw, 110px)' }}>
      <div style={{ width: 'min(300px, 100%)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '26px' }}>
          <Mark size={19} />
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#FFFFFF' }}>Lacuna</span>
        </div>
        {STEPS.map((s, i) => (
          <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {i === step ? (
              <>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#8052FF', flexShrink: 0 }}></span>
                <span style={{ ...label, color: '#FFFFFF' }}>{s.l}</span>
              </>
            ) : i < step ? (
              <>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#15846E', flexShrink: 0 }}></span>
                <span style={{ ...label, color: '#71717A' }}>{s.l}</span>
              </>
            ) : (
              <>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)', flexShrink: 0 }}></span>
                <span style={{ ...label, color: '#71717A' }}>{s.l}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 'min(420px, 90vw)', maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: 'clamp(32px, 3.6vw, 56px)', fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.035em', margin: 0, color: '#FFFFFF' }}>{current.t}</h1>
        <p style={{ fontSize: '17px', lineHeight: 1.75, color: '#9A9A9A', margin: 0, maxWidth: '46ch' }}>{current.b}</p>

        {step === 0 ? (
          <input
            className="fv-violet"
            type="text"
            placeholder="acme / backend"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.16)', borderRadius: '8px', padding: '13px 14px', color: '#FFFFFF', fontSize: '15px', outline: 'none', width: 'min(340px, 100%)' }}
          />
        ) : null}

        {step === 1 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontFamily: MONO, fontSize: '11px', letterSpacing: '0.12em' }}>
            <span style={{ color: '#9A9A9A' }}>ENDPOINT · {hydra === UNCHECKED ? UNCHECKED : hydra === 'NOT CONFIGURED' ? 'not configured' : 'configured'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={icStyle('HydraDB', 13)}></span>
              <span style={{ color: '#BDBDBD' }}>HYDRADB {hydra}</span>
            </span>
          </div>
        ) : null}

        {step === 2 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: MONO, fontSize: '11.5px', letterSpacing: '0.1em' }}>
            {MODELS.map((name, i) => (
              <button key={name} type="button" onClick={() => setModel(i)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', color: model === i ? '#FFFFFF' : '#71717A' }}>
                {model === i ? '●' : '○'} {name}
              </button>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.14em' }}>
            <span style={chip}>CONNECT GITHUB</span>
            <span style={chip}>CONNECT SLACK</span>
            <span style={chip}>PASTE A NOTE</span>
          </div>
        ) : null}

        {step === 4 ? (
          <div style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', padding: '14px 18px', fontFamily: MONO, fontSize: '13px', color: '#FFFFFF' }}>Where does session state live now?</div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginTop: '8px' }}>
          <button className="hv-violet" type="button" disabled={busy} onClick={() => void next()} style={{ background: '#8052FF', border: 'none', cursor: 'pointer', color: '#FFFFFF', fontSize: '14.5px', fontWeight: 500, padding: '12px 22px', borderRadius: '8px' }}>{step < 4 ? 'Continue' : 'Open Lacuna'}</button>
          {step > 0 ? (
            <button className="hv-text" type="button" onClick={() => setStep(Math.max(0, step - 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9A9A9A', fontSize: '14px', padding: 0 }}>Back</button>
          ) : null}
        </div>
        {problem === null ? null : (
          <span role="alert" style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#BDBDBD' }}>{problem}</span>
        )}
      </div>
    </div>
  );
}
