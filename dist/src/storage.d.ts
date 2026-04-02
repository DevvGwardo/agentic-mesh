/**
 * storage.ts — File-based mesh storage engine
 *
 * Provides persistent, filesystem-based context storage so agents can
 * collaborate without a Hub. Each agent writes JSON files to a shared
 * mesh directory. This is the "peer-to-peer" mode.
 *
 * Directory layout:
 *   {meshDir}/
 *     agents.json          — registered agent list
 *     contexts/
 *       {uuid}.json        — individual context documents
 *     delegation/
 *       {uuid}.json         — pending delegation tasks
 */
import type { AgentInfo, MeshContext, ContextFilter, DelegationTask } from './types.js';
export declare class MeshStorage {
    private meshDir;
    private contextsDir;
    private delegationDir;
    private agentsCache;
    private contextsCache;
    private cacheDirty;
    constructor(meshDir: string);
    private ensureDirs;
    registerAgent(info: AgentInfo): void;
    unregisterAgent(agentId: string): void;
    listAgents(filter?: Partial<Pick<AgentInfo, 'meshId' | 'runtime' | 'status'>>): AgentInfo[];
    private writeAgents;
    private applyAgentFilter;
    writeContext(ctx: MeshContext): void;
    readContext(id: string): MeshContext | null;
    deleteContext(id: string): boolean;
    queryContexts(filter: ContextFilter, limit?: number): {
        contexts: MeshContext[];
        total: number;
        hasMore: boolean;
    };
    private warmContextCache;
    writeDelegationTask(task: DelegationTask): void;
    readDelegationTask(id: string): DelegationTask | null;
    listDelegationTasks(pendingOnly?: boolean): DelegationTask[];
    deleteDelegationTask(id: string): boolean;
    getMeshDir(): string;
    /** Remove contexts and agents for agents that haven't been seen in `staleMs` */
    purgeStale(staleMs: number): {
        purgedContexts: number;
        purgedAgents: number;
    };
}
//# sourceMappingURL=storage.d.ts.map