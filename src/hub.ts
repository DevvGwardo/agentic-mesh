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

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import type {
  AgentInfo,
  MeshContext,
  DelegationTask,
  MeshOp,
  HubMessage,
  MeshResult,
} from './types.js';
import { MeshStorage } from './storage.js';

interface ConnectedAgent {
  ws: WebSocket;
  info: AgentInfo;
  lastPong: number;
}

export interface HubConfig {
  port?: number;
  meshDir?: string;     // storage dir (default: ./mesh-store)
  purgeIntervalMs?: number;  // how often to purge stale entries
  staleMaxAgeMs?: number;
  heartbeatTimeoutMs?: number;  // consider agent dead if no pong in this time
}

const DEFAULT_CONFIG: Required<HubConfig> = {
  port: 8765,
  meshDir: './mesh-store',
  purgeIntervalMs: 60_000,
  staleMaxAgeMs: 86_400_000,
  heartbeatTimeoutMs: 90_000,
};

export class MeshHub {
  private config: Required<HubConfig>;
  private storage: MeshStorage;
  private agents = new Map<string, ConnectedAgent>();  // agentId → ConnectedAgent
  private wss: WebSocketServer;
  private purgeTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: HubConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = new MeshStorage(this.config.meshDir);
    this.wss = new WebSocketServer({ port: this.config.port });
  }

  start(): void {
    const { port, meshDir, purgeIntervalMs, staleMaxAgeMs } = this.config;

    console.log(`[hub] Starting agentic-mesh Hub`);
    console.log(`[hub] Listening on ws://0.0.0.0:${port}`);
    console.log(`[hub] Storage: ${meshDir}`);

    this.wss.on('connection', (ws: WebSocket) => {
      let agentId: string | null = null;
      let meshId: string | null = null;

      const pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30_000);

      ws.on('pong', () => {
        if (agentId) {
          const agent = this.agents.get(agentId);
          if (agent) agent.lastPong = Date.now();
        }
      });

      ws.on('message', (data: Buffer) => {
        let msg: HubMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        switch (msg.type) {
          case 'hub:hello':
            // Pre-registration ping — just acknowledge
            ws.send(JSON.stringify({ type: 'hub:ping', payload: { agents: [] } }));
            break;

          case 'hub:join':
            agentId = msg.payload.info.id;
            meshId = msg.payload.info.meshId;
            this.storage.registerAgent(msg.payload.info);
            this.agents.set(agentId, {
              ws,
              info: msg.payload.info,
              lastPong: Date.now(),
            });
            console.log(`[hub] Agent joined: ${msg.payload.info.name} (${agentId}) in mesh "${meshId}"`);
            // Broadcast to all other agents in the same mesh
            this.broadcastToMesh(meshId!, { type: 'hub:ping', payload: { agents: this.meshAgents(meshId!) } }, agentId);
            break;

          case 'hub:leave':
            if (agentId) {
              this.agents.delete(agentId);
              this.storage.unregisterAgent(agentId);
              console.log(`[hub] Agent left: ${agentId}`);
            }
            break;

          case 'hub:context:new':
            // Persist and broadcast to peers
            this.storage.writeContext(msg.payload.context);
            this.broadcastToMesh(msg.payload.context.meshId, msg, agentId ?? undefined);
            break;

          case 'hub:context:del':
            this.storage.deleteContext(msg.payload.id);
            this.broadcast({ type: 'hub:context:del', payload: { id: msg.payload.id } }, agentId ?? undefined);
            break;

          case 'mesh:op': {
            const result = this.handleMeshOp(msg.payload as MeshOp & { id?: string });
            ws.send(JSON.stringify({ type: 'mesh:result', payload: result }));
            break;
          }

          case 'agent:status':
            if (agentId) {
              const agent = this.agents.get(agentId);
              if (agent) {
                agent.info.status = msg.payload.status;
                this.storage.registerAgent(agent.info);
              }
            }
            break;

          default:
            // Unknown message type
            ws.send(JSON.stringify({ type: 'error', payload: { message: `Unknown message type: ${msg.type}` } }));
        }
      });

      ws.on('close', () => {
        clearInterval(pingTimer);
        if (agentId) {
          this.agents.delete(agentId);
          // Mark offline in storage
          const info = this.storage.listAgents().find(a => a.id === agentId);
          if (info) {
            info.status = 'offline';
            info.lastSeen = Date.now();
            this.storage.registerAgent(info);
          }
          console.log(`[hub] Agent disconnected: ${agentId}`);
        }
      });

      ws.on('error', (err) => {
        console.error(`[hub] WebSocket error for ${agentId}:`, err.message);
      });
    });

    // Periodic stale purge
    this.purgeTimer = setInterval(() => {
      const { purgedContexts, purgedAgents } = this.storage.purgeStale(staleMaxAgeMs);
      if (purgedContexts > 0 || purgedAgents > 0) {
        console.log(`[hub] Purged ${purgedContexts} stale contexts, ${purgedAgents} stale agents`);
      }
    }, purgeIntervalMs);

    // Heartbeat check — disconnect dead agents
    this.heartbeatCheckTimer = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatTimeoutMs;
      for (const [id, agent] of this.agents) {
        if (now - agent.lastPong > timeout) {
          console.warn(`[hub] Agent ${id} heartbeat timeout — disconnecting`);
          agent.ws.close();
          this.agents.delete(id);
        }
      }
    }, 30_000);

    console.log(`[hub] Ready`);
  }

  // ─── Message handling ─────────────────────────────────────────────────────

  private handleMeshOp(op: MeshOp & { id?: string }): MeshResult {
    const start = Date.now();

    try {
      switch (op.op) {
        case 'publish': {
          const ctx: MeshContext = {
            ...op.context,
            id: randomUUID(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            expiresAt: op.context.ttlSeconds > 0 ? Date.now() + op.context.ttlSeconds * 1000 : undefined,
          };
          this.storage.writeContext(ctx);
          // Broadcast to all peers in the same mesh
          this.broadcastToMesh(ctx.meshId, { type: 'hub:context:new', payload: { context: ctx } });
          return { ok: true, op: 'publish', data: { id: ctx.id }, ms: Date.now() - start };
        }

        case 'query': {
          const { contexts, total, hasMore } = this.storage.queryContexts(op.filter ?? {}, op.limit ?? 50);
          return {
            ok: true, op: 'query', ms: Date.now() - start,
            data: { contexts, total, hasMore },
          };
        }

        case 'read': {
          const ctx = this.storage.readContext(op.id);
          if (!ctx) return { ok: false, op: 'read', error: `Context ${op.id} not found`, ms: Date.now() - start };
          return { ok: true, op: 'read', data: ctx, ms: Date.now() - start };
        }

        case 'update': {
          const existing = this.storage.readContext(op.id);
          if (!existing) return { ok: false, op: 'update', error: `Context ${op.id} not found`, ms: Date.now() - start };
          const updated: MeshContext = {
            ...existing,
            ...op.patch,
            id: existing.id,
            updatedAt: Date.now(),
          };
          if (op.patch.ttlSeconds !== undefined) {
            updated.expiresAt = op.patch.ttlSeconds > 0 ? Date.now() + op.patch.ttlSeconds * 1000 : undefined;
          }
          this.storage.writeContext(updated);
          return { ok: true, op: 'update', data: updated, ms: Date.now() - start };
        }

        case 'delete': {
          const ok = this.storage.deleteContext(op.id);
          if (ok) {
            this.broadcast({ type: 'hub:context:del', payload: { id: op.id } });
          }
          return { ok, op: 'delete', error: ok ? undefined : 'Not found', ms: Date.now() - start };
        }

        case 'agents': {
          const agents = this.storage.listAgents(op.filter ?? {});
          return { ok: true, op: 'agents', data: { agents, total: agents.length }, ms: Date.now() - start };
        }

        case 'delegate': {
          this.storage.writeDelegationTask(op.task);
          // Try to route to a capable agent immediately
          const agent = this.findBestAgent(op.task);
          if (agent) {
            // Send directly to that agent
            if (agent.ws.readyState === WebSocket.OPEN) {
              agent.ws.send(JSON.stringify({ type: 'hub:delegate', payload: op.task }));
            }
            return {
              ok: true, op: 'delegate', ms: Date.now() - start,
              data: { taskId: op.task.id, assignedTo: agent.info, queued: false },
            };
          }
          return { ok: true, op: 'delegate', data: { taskId: op.task.id, queued: true }, ms: Date.now() - start };
        }

        case 'join': {
          // Already handled at connection time
          return { ok: true, op: 'join', ms: Date.now() - start };
        }

        case 'leave': {
          // No-op — agents are removed on disconnect via hub:leave message
          return { ok: true, op: 'leave', ms: Date.now() - start };
        }

        case 'ping': {
          return {
            ok: true, op: 'ping', ms: Date.now() - start,
            data: {
              agents: this.storage.listAgents(),
              storage: { contexts: this.storage.queryContexts({}, 0).total },
            },
          };
        }

        default:
          return { ok: false, op: (op as MeshOp).op, error: 'Unknown op', ms: Date.now() - start };
      }
    } catch (err) {
      return { ok: false, op: op.op, error: String(err), ms: Date.now() - start };
    }
  }

  // ─── Routing ───────────────────────────────────────────────────────────────

  private findBestAgent(task: DelegationTask): ConnectedAgent | undefined {
    const candidates = Array.from(this.agents.values()).filter(a => {
      if (!a.info.capabilities.canDelegate) return false;
      if (a.info.status === 'busy') return false;
      if (task.targetRuntime && a.info.runtime !== task.targetRuntime) return false;
      return true;
    });
    // Pick lowest priority number (highest priority) then random
    candidates.sort((a, b) => (a.info.status === 'idle' ? 0 : 1) - (b.info.status === 'idle' ? 0 : 1));
    return candidates[0];
  }

  private meshAgents(meshId: string): AgentInfo[] {
    return Array.from(this.agents.values())
      .filter(a => a.info.meshId === meshId)
      .map(a => a.info);
  }

  /** Broadcast to all agents in a mesh, optionally excluding one */
  broadcastToMesh(meshId: string, msg: HubMessage, excludeAgentId?: string): void {
    for (const agent of this.agents.values()) {
      if (agent.info.meshId === meshId && agent.info.id !== excludeAgentId) {
        if (agent.ws.readyState === WebSocket.OPEN) {
          agent.ws.send(JSON.stringify(msg));
        }
      }
    }
  }

  /** Broadcast to all connected agents */
  broadcast(msg: HubMessage, excludeAgentId?: string): void {
    for (const agent of this.agents.values()) {
      if (agent.info.id !== excludeAgentId) {
        if (agent.ws.readyState === WebSocket.OPEN) {
          agent.ws.send(JSON.stringify(msg));
        }
      }
    }
  }

  // ─── Shutdown ──────────────────────────────────────────────────────────────

  stop(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    if (this.heartbeatCheckTimer) clearInterval(this.heartbeatCheckTimer);
    for (const agent of this.agents.values()) {
      agent.ws.close();
    }
    this.wss.close();
    console.log('[hub] Stopped');
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT ?? '8765', 10);
  const meshDir = process.env.MESH_DIR ?? './mesh-store';
  const hub = new MeshHub({ port, meshDir });
  hub.start();

  process.on('SIGINT', () => {
    console.log('\n[hub] Shutting down...');
    hub.stop();
    process.exit(0);
  });
}
