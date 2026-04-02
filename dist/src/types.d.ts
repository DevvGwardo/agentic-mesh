/**
 * agentic-mesh — shared types for cross-agent collaboration
 *
 * Design goals:
 * - Works with both Hermes (MCP) and OpenClaw (native tools)
 * - Hub is optional — mesh works peer-to-peer when agents share a filesystem
 * - Structured messages compose naturally into agent context windows
 */
export type AgentRuntime = 'hermes' | 'openclaw' | 'unknown';
export interface AgentInfo {
    id: string;
    name: string;
    runtime: AgentRuntime;
    version: string;
    meshId: string;
    capabilities: AgentCapabilities;
    status: AgentStatus;
    registeredAt: number;
    lastSeen: number;
    hubUrl?: string;
}
export type AgentStatus = 'active' | 'idle' | 'busy' | 'offline';
export interface AgentCapabilities {
    canReadContext: boolean;
    canWriteContext: boolean;
    canOrchestrate: boolean;
    canDelegate: boolean;
    maxContextBytes: number;
}
export interface MeshContext {
    id: string;
    meshId: string;
    agentId: string;
    agentName: string;
    runtime: AgentRuntime;
    type: ContextType;
    content: string;
    tags: string[];
    importance: 1 | 2 | 3;
    ttlSeconds: number;
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
    parentId?: string;
}
export type ContextType = 'task' | 'finding' | 'code' | 'log' | 'note' | 'plan' | 'result' | 'message' | 'system';
export type MeshOp = {
    op: 'publish';
    context: Omit<MeshContext, 'id' | 'createdAt' | 'updatedAt' | 'expiresAt'>;
} | {
    op: 'query';
    filter: ContextFilter;
    limit?: number;
} | {
    op: 'read';
    id: string;
} | {
    op: 'update';
    id: string;
    patch: Partial<Pick<MeshContext, 'content' | 'tags' | 'importance' | 'ttlSeconds'>>;
} | {
    op: 'delete';
    id: string;
} | {
    op: 'agents';
    filter?: Partial<Pick<AgentInfo, 'meshId' | 'runtime' | 'status'>>;
} | {
    op: 'delegate';
    task: DelegationTask;
} | {
    op: 'join';
    meshId: string;
} | {
    op: 'leave';
    meshId: string;
} | {
    op: 'ping';
};
export interface ContextFilter {
    meshId?: string;
    agentId?: string;
    agentName?: string;
    runtime?: AgentRuntime;
    type?: ContextType | ContextType[];
    tags?: string[];
    since?: number;
    until?: number;
    importance?: 1 | 2 | 3;
    search?: string;
    limit?: number;
    offset?: number;
}
export interface DelegationTask {
    id: string;
    instruction: string;
    targetRuntime?: AgentRuntime;
    priority?: 1 | 2 | 3;
    contextIds?: string[];
}
export interface MeshResult {
    ok: boolean;
    op: MeshOp['op'];
    data?: unknown;
    error?: string;
    ms: number;
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
export type HubMessage = {
    type: 'hub:hello';
    payload: {
        agentId: string;
        meshId: string;
    };
} | {
    type: 'hub:join';
    payload: {
        meshId: string;
        info: AgentInfo;
    };
} | {
    type: 'hub:leave';
    payload: {
        meshId: string;
    };
} | {
    type: 'hub:context:new';
    payload: {
        context: MeshContext;
    };
} | {
    type: 'hub:context:del';
    payload: {
        id: string;
    };
} | {
    type: 'hub:ping';
    payload: {
        agents: AgentInfo[];
    };
} | {
    type: 'hub:delegate';
    payload: DelegationTask;
} | {
    type: 'hub:delegate:result';
    payload: {
        taskId: string;
        result: MeshContext;
    };
} | {
    type: 'mesh:op';
    payload: MeshOp;
} | {
    type: 'mesh:result';
    payload: MeshResult;
} | {
    type: 'agent:status';
    payload: {
        status: AgentStatus;
    };
} | {
    type: 'agent:context';
    payload: {
        contexts: MeshContext[];
    };
} | {
    type: 'error';
    payload: {
        message: string;
    };
};
export interface LLMCompletionOptions {
    system?: string;
    messages: {
        role: 'user' | 'assistant' | 'system';
        content: string;
    }[];
    temperature?: number;
    maxTokens?: number;
    model?: string;
}
export interface LLMClient {
    complete(opts: LLMCompletionOptions): Promise<{
        content: string;
    }>;
}
//# sourceMappingURL=types.d.ts.map