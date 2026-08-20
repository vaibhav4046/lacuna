import { useNavigate } from 'react-router-dom';

import { Mark } from '../design/mark';

export function Hero() {
  const go = useNavigate();

  return (
    <section id="top" data-scene="hero" className="landing-hero">
      <div className="hero-stage">
        <div className="hero-copy" data-shield>
          <span className="landing-kicker hero-kicker"><i /> CONTEXT FOR LONG-RUNNING AGENTS</span>
          <h1>Memory that knows<br /><em>what changed.</em></h1>
          <p>Lacuna gives every model, tool and agent the same evidence-bearing memory. It keeps the history, resolves what is current, exposes disagreement and stops when the answer is missing.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => go('/explore/dash')}>Open live workspace <span aria-hidden="true">↗</span></button>
            <button className="secondary-action" onClick={() => go('/judge')}>Run the judge proof</button>
            <a href="#journey">Follow a memory <span aria-hidden="true">↓</span></a>
          </div>
          <div className="hero-contract" aria-label="Lacuna product contract">
            <span>HYDRADB GRAPH STATE</span>
            <span>EVIDENCE ATTACHED</span>
            <span>ABSTAINS WHEN MISSING</span>
          </div>
        </div>

        <div className="hero-aperture" data-shield aria-label="Lacuna keeps current, historical and conflicting memory distinct">
          <div className="hero-aperture-grid" aria-hidden="true" />
          <div className="hero-mark-wrap" aria-hidden="true">
            <span className="hero-orbit hero-orbit-one" />
            <span className="hero-orbit hero-orbit-two" />
            <span className="hero-mark-motion"><Mark size={222} className="hero-mark" /></span>
          </div>
          <div className="hero-memory-card">
            <div><span>MEMORY FIELD</span><span>LIVE ROUTE</span></div>
            <strong>Current is not the same as latest.</strong>
            <ul>
              <li><i data-tone="violet" />Current claim <span>resolves</span></li>
              <li><i />Historical claim <span>stays</span></li>
              <li><i data-tone="amber" />Conflict <span>abstains</span></li>
            </ul>
          </div>
          <span className="hero-aperture-note">THE CENTRE NEVER CLOSES</span>
        </div>
      </div>
    </section>
  );
}
