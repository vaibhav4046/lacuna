import type { RouteKey } from './routes';
import { Dashboard } from './routes/Dashboard';
import { Ask } from './routes/Ask';
import { Graph, Health, Memory, Timeline } from './routes/context';
import { Work } from './routes/work';
import { Tools } from './routes/tools';
import { Agents } from './routes/agents';
import { Models } from './routes/models';
import { VoiceRoute } from './routes/voice';
import { Cli, Mcp, Sdk } from './routes/developers';
import { ConnectorsRoute } from './routes/connectors';
import { Evaluations, HydraDb } from './routes/proof';
import { Settings } from './routes/system';

/**
 * One route body per key.
 *
 * The keys come from the design's own TITLES map, and every one of the
 * eighteen has a case. There is no default: a missing route is a type error
 * rather than a blank screen.
 */
export function RouteBody({ route }: { route: RouteKey }) {
  switch (route) {
    case 'dash': return <Dashboard />;
    case 'ask': return <Ask />;
    case 'memory': return <Memory />;
    case 'timeline': return <Timeline />;
    case 'graph': return <Graph />;
    case 'health': return <Health />;
    case 'work': return <Work />;
    case 'agents': return <Agents />;
    case 'tools': return <Tools />;
    case 'models': return <Models />;
    case 'voice': return <VoiceRoute />;
    case 'mcp': return <Mcp />;
    case 'sdk': return <Sdk />;
    case 'cli': return <Cli />;
    case 'conn': return <ConnectorsRoute />;
    case 'evals': return <Evaluations />;
    case 'hydra': return <HydraDb />;
    case 'settings': return <Settings />;
  }
}
