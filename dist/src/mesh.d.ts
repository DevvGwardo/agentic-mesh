/**
 * mesh.ts — Core agentic-mesh engine
 *
 * Runs inside each agent (Hermes/OpenClaw). Provides the tool interface
 * for all mesh operations. Can work in two modes:
 *
 *   DIRECT MODE (no Hub):
 *     Uses MeshStorage directly — reads/writes files in a shared mesh dir.
 *     All agents on the same machine share the same meshDir path.
 *
 *   HUB MODE (cross-machine):
 *     Connects to a Hub via WebSocket. The Hub maintains canonical storage
 *     and broadcasts events to all connected agents.
 *
 * Usage (agent startup):
 *   const mesh = await Mesh.create({ meshId: 'clawborators', agentInfo: {...} });
 *   mesh.registerTool(myAgentToolRegistry);
 *
 *   // Inside agent reasoning:
 *   const result = await mesh.op({ op: 'publish', context: {...} });
 */
import { WebSocket } from 'ws';
import type { AgentInfo, AgentStatus, MeshContext, ContextFilter, MeshOp, MeshResult, MeshQueryResult, MeshAgentsResult, MeshDelegationResult, LLMClient } from './types.js';
export interface MeshConfig {
    /** Logical mesh group (e.g. 'clawborators'). Agents with the same meshId can see each other. */
    meshId: string;
    /** This agent's info — id, name, runtime, version */
    agentInfo: Omit<AgentInfo, 'meshId' | 'status' | 'registeredAt' | 'lastSeen'>;
    /** Directory for file-based storage (omit to use Hub only) */
    meshDir?: string;
    /** Hub WebSocket URL (e.g. 'ws://localhost:8765'). If omitted, uses DIRECT mode. */
    hubUrl?: string;
    /** WebSocket constructor (injectable for testability) */
    wsImpl?: typeof WebSocket;
    /** LLM adapter for context summarization */
    llm?: LLMClient;
    /** How often to ping the Hub to maintain presence (ms) */
    heartbeatMs?: number;
    /** Purge stale entries older than this (ms). Default: 24h */
    staleMaxAgeMs?: number;
    /** Called when a new context arrives from the Hub */
    onContext?: (ctx: MeshContext) => void;
    /** Called when a delegation result arrives */
    onDelegationResult?: (taskId: string, result: MeshContext) => void;
    /** Called when peer agent status changes */
    onAgentUpdate?: (agent: AgentInfo) => void;
}
interface MeshStats {
    opsReceived: number;
    opsOk: number;
    opsError: number;
    bytesPublished: number;
    bytesRead: number;
    contextCount: number;
    lastActivity: number | null;
}
export declare class Mesh {
    private config;
    private storage;
    private ws;
    private agentInfo;
    private stats;
    private heartbeatTimer;
    private connected;
    private pendingRequests;
    static create(config: MeshConfig): Promise<Mesh>;
    constructor(config: MeshConfig);
    private init;
    private connectHub;
    private handleHubMessage;
    private send;
    private requestOp;
    /**
     * Execute a mesh operation.
     *
     * In DIRECT mode (no Hub): runs synchronously against local storage.
     * In HUB mode: sends to Hub and waits for response.
     */
    op(operation: MeshOp): Promise<MeshResult>;
    private opLocal;
    /** Publish a context — the most common write operation */
    publish(params: {
        content: string;
        type: MeshContext['type'];
        tags?: string[];
        importance?: 1 | 2 | 3;
        ttlSeconds?: number;
        parentId?: string;
    }): Promise<MeshResult>;
    /** Query contexts with a natural filter object */
    query(filter?: ContextFilter): Promise<MeshQueryResult>;
    /** List active peers in this mesh */
    listPeers(): Promise<MeshAgentsResult>;
    /** Delegate a task to another agent (writes to delegation queue, Hub handles routing) */
    delegate(instruction: string, priority?: number): Promise<MeshDelegationResult>;
    /** Summarize recent mesh activity as a readable digest */
    summarizeActivity(hours?: number): Promise<string>;
    /** Build a mesh-aware system prompt addition with recent context */
    buildMeshContext(prefix?: string): Promise<string>;
    setStatus(status: AgentStatus): void;
    destroy(): Promise<void>;
    getStats(): Readonly<MeshStats> & {
        agentInfo: AgentInfo;
    };
    getAgentInfo(): AgentInfo;
    isConnected(): boolean;
}
export {};
//# sourceMappingURL=mesh.d.ts.map