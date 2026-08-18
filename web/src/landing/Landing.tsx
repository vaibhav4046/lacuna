import { Header } from './Header';
import { Hero } from './Hero';
import { Real } from './Real';
import { Gap } from './Gap';
import { Core } from './Core';
import { Arch } from './Arch';
import { Funnel } from './Funnel';
import { Rot } from './Rot';
import { Org } from './Org';
import { Temporal } from './Temporal';
import { Contra } from './Contra';
import { Void } from './Void';
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
 * Twenty-seven scenes and a footer, in the design's order.
 *
 * The order is load bearing rather than editorial: the canvas reads
 * [data-scene] off whichever section owns the viewport, so moving a scene
 * moves the constellation with it. Nothing here is arranged by preference.
 */
export default function Landing() {
  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      <Header />
      <Hero />
      <Real />
      <Gap />
      <Core />
      <Arch />
      <Funnel />
      <Rot />
      <Org />
      <Temporal />
      <Contra />
      <Void />
      <Pack />
      <Speed />
      <Any />
      <Harness />
      <Hand />
      <Route />
      <Voice />
      <Conn />
      <Mcp />
      <Sdk />
      <Cli />
      <DashPreview />
      <Hydra />
      <Evals />
      <Faq />
      <Final />
      <Footer />
    </div>
  );
}
