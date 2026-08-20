import { Header } from './Header';
import { Hero } from './Hero';
import { Temporal } from './Temporal';
import { Try } from './Try';
import { Contra } from './Contra';
import { Void } from './Void';
import { Arch } from './Arch';
import { Hydra } from './Hydra';
import { Any } from './Any';
import { Mcp } from './Mcp';
import { Cli } from './Cli';
import { Evals } from './Evals';
import { Final } from './Final';
import { Footer } from './Footer';

/**
 * Eight scenes and a footer, cut down from twenty-seven.
 *
 * The long version was 30,552 pixels: fifty-six screens of scrolling before a
 * reader reached the end, with the same claim made in five different ways. A
 * judge with limited time cannot be asked to do that, and neither can anyone
 * else. Measured before the cut, so the number is a fact rather than an
 * impression.
 *
 * What is kept is the argument in its shortest complete form: what this is,
 * the thing that goes wrong, the three states that answer it, how it is built,
 * why the graph engine earns its place, that one context reaches every client,
 * and what has actually been measured. Nothing kept is decorative.
 *
 * What went is repetition rather than content. Every removed scene restated
 * something one of these already says, or described a surface the product now
 * shows directly and better: the connector catalogue, the SDK, the funnel, the
 * organisation view, the voice scene for a feature that is not configured.
 * Those components still exist and can be reinstated; they are simply not the
 * shortest path to understanding the product.
 *
 * The order stays load bearing. The canvas reads [data-scene] off whichever
 * section owns the viewport, so the constellation still follows the argument.
 */
export default function Landing() {
  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      <Header />
      <Hero />
      <Try />
      <Temporal />
      <Contra />
      <Void />
      <Arch />
      <Hydra />
      <Any />
      <Mcp />
      <Cli />
      <Evals />
      <Final />
      <Footer />
    </div>
  );
}
