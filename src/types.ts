/**
 * agentic-mesh — shared types for cross-agent collaboration
 *
 * Design goals:
 * - Works with both Hermes (MCP) and OpenClaw (native tools)
 * - Hub is optional — mesh works peer-to-peer when agents share a filesystem
 * - Structured messages compose naturally into agent context windows
 */

// ─── Agent identity ───────────────────────────────────────────────────────────

export type AgentRuntime = 'hermes' | 'openclaw' | 'unknown';

export interface AgentInfo {
  id: string;            // unique per running instance (instance-id)
  name: string;           // "Hermes (main)" | "OpenClaw Evo" | etc.
  runtime: AgentRuntime;
  version: string;        // "1.x.x"
  meshId: string;         // logical group this agent belongs to (e.g. "clawborators")
  capabilities: AgentCapabilities;
  status: AgentStatus;
  registeredAt: number;   // unix ms
  lastSeen: number;       // unix ms
  hubUrl?: string;       // if connected to a Hub
}

export type AgentStatus = 'active' | 'idle' | 'busy' | 'offline';

export interface AgentCapabilities {
  canReadContext: boolean;    // can consume other agents' context
  canWriteContext: boolean;   // can publish context others can read
  canOrchestrate: boolean;    // can act as coordinator
  canDelegate: boolean;        // can spin up sub-agents
  maxContextBytes: number;     // soft limit before truncation
}

// ─── Shared context (the actual collaboration payload) ──────────────────────

export interface MeshContext {
  id: string;           // uuid — stable across edits
  meshId: string;       // matches AgentInfo.meshId
  agentId: string;      // author
  agentName: string;
  runtime: AgentRuntime;
  type: ContextType;
  content: string;      // the actual text / structured content
  tags: string[];       // e.g. ["task", "web", "research", "code"]
  importance: 1 | 2 | 3; // 1=low, 2=medium, 3=high
  ttlSeconds: number;   // 0 = until manually cleared
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;   // computed: createdAt + ttlSeconds * 1000
  parentId?: string;    // optional thread/reply chain
}

export type ContextType =
  | 'task'          // a task or goal description
  | 'finding'       // research result, discovered fact
  | 'code'          // code snippet or artifact
  | 'log'           // structured log / event
  | 'note'          // free-form note
  | 'plan'          // multi-step plan
  | 'result'        // final output / deliverable
  | 'message'       // direct message to another agent
  | 'system';       // system-level info (heartbeat, status)

// ─── Mesh operations (the tool interface) ───────────────────────────────────

export type MeshOp =
  | { op: 'publish';    context: Omit<MeshContext, 'id' | 'createdAt' | 'updatedAt' | 'expiresAt'> }
  | { op: 'query';      filter: ContextFilter; limit?: number }
  | { op: 'read';       id: string }
  | { op: 'update';     id: string; patch: Partial<Pick<MeshContext, 'content' | 'tags' | 'importance' | 'ttlSeconds'>> }
  | { op: 'delete';     id: string }
  | { op: 'agents';    filter?: Partial<Pick<AgentInfo, 'meshId' | 'runtime' | 'status'>> }
  | { op: 'delegate';  task: DelegationTask }
  | { op: 'join';      meshId: string }
  | { op: 'leave';     meshId: string }
  | { op: 'ping' };

export interface ContextFilter {
  meshId?: string;
  agentId?: string;
  agentName?: string;
  runtime?: AgentRuntime;
  type?: ContextType | ContextType[];
  tags?: string[];
  since?: number;        // unix ms lower bound
  until?: number;       // unix ms upper bound
  importance?: 1 | 2 | 3;
  search?: string;      // substring match in content
  limit?: number;
  offset?: number;
}

export interface DelegationTask {
  id: string;
  instruction: string;
  targetRuntime?: AgentRuntime;  // hint: prefer this runtime
  priority?: 1 | 2 | 3;
  contextIds?: string[];         // mesh context to attach
}

// ─── Mesh responses ───────────────────────────────────────────────────────────

export interface MeshResult {
  ok: boolean;
  op: MeshOp['op'];
  data?: unknown;
  error?: string;
  ms: number;           // server-side latency
}

export interface MeshQueryResult extends MeshResult {
  data: {
    contexts: MeshContext[];
    total: number;
    hasMore: boolean;
  };
}

export interface MeshAgentsResult extends MeshResult {
  data: {
    agents: AgentInfo[];
    total: number;
  };
}

export interface MeshDelegationResult extends MeshResult {
  data: {
    taskId: string;
    assignedTo?: AgentInfo;
    queued: boolean;
  };
}

// ─── Hub ↔ Agent protocol ────────────────────────────────────────────────────

export type HubMessage =
  | { type: 'hub:hello';        payload: { agentId: string; meshId: string } }
  | { type: 'hub:join';         payload: { meshId: string; info: AgentInfo } }
  | { type: 'hub:leave';       payload: { meshId: string } }
  | { type: 'hub:context:new'; payload: { context: MeshContext } }
  | { type: 'hub:context:del'; payload: { id: string } }
  | { type: 'hub:ping';         payload: { agents: AgentInfo[] } }
  | { type: 'hub:delegate';    payload: DelegationTask }
  | { type: 'hub:delegate:result'; payload: { taskId: string; result: MeshContext } }
  | { type: 'mesh:op';          payload: MeshOp }
  | { type: 'mesh:result';     payload: MeshResult }
  | { type: 'agent:status';   payload: { status: AgentStatus } }
  | { type: 'agent:context';  payload: { contexts: MeshContext[] } }
  | { type: 'error';           payload: { message: string } };

// ─── LLM adapter (compatible with agentic-primitives) ────────────────────────

export interface LLMCompletionOptions {
  system?: string;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface LLMClient {
  complete(opts: LLMCompletionOptions): Promise<{ content: string }>;
}
