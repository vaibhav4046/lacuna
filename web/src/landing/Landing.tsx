import { useEffect } from 'react';

import { Header } from './Header';
import { Hero } from './Hero';
import { Try } from './Try';
import { Journey } from './Journey';
import { Cli } from './Cli';
import { Evals } from './Evals';
import { Final } from './Final';
import { Footer } from './Footer';

/**
 * The landing is one continuous memory journey, not a stack of disconnected
 * product cards. Each step owns a different artifact and a real product route;
 * the open spiral remains visible while the artifact changes beside it. The
 * canvas still reads `data-scene`, now from the journey steps themselves.
 */
export default function Landing() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced || typeof IntersectionObserver === 'undefined') {
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
    <div style={{ position: 'relative', zIndex: 1 }}>
      <Header />
      <Hero />
      <Try />
      <Journey />
      <Cli />
      <Evals />
      <Final />
      <Footer />
    </div>
  );
}
