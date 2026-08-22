import { useEffect } from 'react';

import { Header } from './Header';
import { Hero } from './Hero';
import { Real } from './Real';
import { Gap } from './Gap';
import { Arch } from './Arch';
import { Funnel } from './Funnel';
import { Org } from './Org';
import { Temporal } from './Temporal';
import { Contra } from './Contra';
import { Pack } from './Pack';
import { Speed } from './Speed';
import { Any } from './Any';
import { Harness } from './Harness';
import { Hand } from './Hand';
import { Route } from './Route';
import { Voice } from './Voice';
import { Conn } from './Conn';
import { Mcp } from './Mcp';
import { Sdk } from './Sdk';
import { Cli } from './Cli';
import { DashPreview } from './DashPreview';
import { Hydra } from './Hydra';
import { Evals } from './Evals';
import { Faq } from './Faq';
import { Final } from './Final';
import { Footer } from './Footer';

/**
 * Production cut of the restored oracle. The chapter wrappers are deliberately
 * inert: MemoryField still reads the real data-scene sections and carries one
 * particle system through the entire story. They make the narrative legible to
 * people, tests and future edits without turning it into a card-based page.
 */
export default function Landing() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) {
      nodes.forEach((node) => { node.dataset.revealed = 'true'; });
      document.querySelectorAll<HTMLElement>('[data-fx]').forEach((node) => {
        node.style.opacity = '1';
        node.style.transform = 'none';
      });
      return undefined;
    }
    if (typeof IntersectionObserver === 'undefined') {
      nodes.forEach((node) => { node.dataset.revealed = 'true'; });
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        (entry.target as HTMLElement).dataset.revealed = 'true';
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="v10-landing" style={{ position: 'relative', zIndex: 1 }}>
      <a className="v10-skip-link" href="#main-content">Skip to content</a>
      <Header />
      <main id="main-content" tabIndex={-1}>
      <div className="v10-chapter" data-chapter="hero">
        <Hero />
      </div>
      <div className="v10-chapter" data-chapter="real-memory-failure">
        <Real />
        <Gap />
      </div>
      <div className="v10-chapter" data-chapter="architecture">
        <Arch />
      </div>
      <div className="v10-chapter" data-chapter="context-reduction">
        <Funnel />
        <Org />
      </div>
      <div className="v10-chapter" data-chapter="temporal-truth">
        <Temporal />
        <Contra />
      </div>
      <div className="v10-chapter" data-chapter="context-pack">
        <Pack />
        <Speed />
      </div>
      <div className="v10-chapter" data-chapter="client-neutral">
        <Any />
        <Route />
      </div>
      <div className="v10-chapter" data-chapter="agent-runtime">
        <Harness />
        <Hand />
      </div>
      <div className="v10-chapter" data-chapter="voice-connectors">
        <Voice />
        <Conn />
      </div>
      <div className="v10-chapter" data-chapter="developer-surfaces">
        <Mcp />
        <Sdk />
        <Cli />
      </div>
      <div className="v10-chapter" data-chapter="live-proof">
        <DashPreview />
        <Hydra />
        <Evals />
      </div>
      <div className="v10-chapter" data-chapter="trust">
        <Faq />
      </div>
      <div className="v10-chapter" data-chapter="close">
        <Final />
        <Footer />
      </div>
      </main>
    </div>
  );
}
