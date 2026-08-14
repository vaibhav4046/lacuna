/**
 * The MCP surface: four read-only tools over the same retrieval path the web
 * server uses, on either stdio or Streamable HTTP.
 */

export {
  type AskResult,
  askResult,
  describeNode,
  type EvidenceItem,
  type ExplainResult,
  explainResult,
  type HealthResult,
  type HydraIdentity,
  lastReadEpoch,
  MAX_EVIDENCE_ITEMS,
  type NodeIdentity,
  type QueryItem,
  renderJson,
  type ResultStatus,
  type RevisionItem,
  type TimelineResult,
  timelineResult,
} from './result';

export {
  ASK_TOOL,
  EXPLAIN_TOOL,
  HEALTH_TOOL,
  TIMELINE_TOOL,
  TOOLS,
} from './tools';

export {
  callTool,
  createMcpServer,
  health,
  readQuestion,
  SERVER_NAME,
  SERVER_VERSION,
  TOOL_TIMEOUT_MS,
  type ToolContext,
} from './server';

export {
  createMcpListener,
  type HttpOptions,
  isLoopbackOrigin,
  MCP_PATH,
} from './http';
