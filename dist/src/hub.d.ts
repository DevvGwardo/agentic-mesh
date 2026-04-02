/**
 * hub.ts — Central Hub service for agentic-mesh
 *
 * Optional central coordinator for when agents run on different machines
 * or want guaranteed broadcast delivery. Hub maintains canonical storage
 * and relays messages between agents.
 *
 * Run:
 *   npx ts-node/esm src/hub.ts
 *   PORT=8765 node dist/hub.js
 */
import type { HubMessage } from './types.js';
export interface HubConfig {
    port?: number;
    meshDir?: string;
    purgeIntervalMs?: number;
    staleMaxAgeMs?: number;
    heartbeatTimeoutMs?: number;
}
export declare class MeshHub {
    private config;
    private storage;
    private agents;
    private wss;
    private purgeTimer;
    constructor(config?: HubConfig);
    start(): void;
    private handleMeshOp;
    private findBestAgent;
    private meshAgents;
    /** Broadcast to all agents in a mesh, optionally excluding one */
    broadcastToMesh(meshId: string, msg: HubMessage, excludeAgentId?: string): void;
    /** Broadcast to all connected agents */
    broadcast(msg: HubMessage, excludeAgentId?: string): void;
    stop(): void;
}
//# sourceMappingURL=hub.d.ts.map