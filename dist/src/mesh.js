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
import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';
import { MeshStorage } from './storage.js';
// ─── Mesh ───────────────────────────────────────────────────────────────────
export class Mesh {
    config;
    storage = null;
    ws = null;
    agentInfo;
    stats = {
        opsReceived: 0,
        opsOk: 0,
        opsError: 0,
        bytesPublished: 0,
        bytesRead: 0,
        contextCount: 0,
        lastActivity: null,
    };
    heartbeatTimer = null;
    connected = false;
    pendingRequests = new Map();
    // ─── Factory ───────────────────────────────────────────────────────────────
    static async create(config) {
        const mesh = new Mesh(config);
        await mesh.init();
        return mesh;
    }
    constructor(config) {
        this.config = {
            wsImpl: WebSocket,
            heartbeatMs: 30_000,
            staleMaxAgeMs: 86_400_000,
            ...config,
        };
        this.agentInfo = {
            ...config.agentInfo,
            meshId: config.meshId,
            status: 'active',
            registeredAt: Date.now(),
            lastSeen: Date.now(),
        };
    }
    async init() {
        // File-based storage in DIRECT mode
        if (this.config.meshDir) {
            this.storage = new MeshStorage(this.config.meshDir);
            this.storage.registerAgent(this.agentInfo);
            // Purge stale on startup
            this.storage.purgeStale(this.config.staleMaxAgeMs);
        }
        // Hub connection
        if (this.config.hubUrl) {
            await this.connectHub();
        }
        else if (this.storage) {
            // DIRECT mode: register with local storage
            this.storage.registerAgent(this.agentInfo);
        }
    }
    // ─── Hub connection ───────────────────────────────────────────────────────
    async connectHub() {
        const { wsImpl, hubUrl, heartbeatMs } = this.config;
        return new Promise((resolve, reject) => {
            const ws = new wsImpl(hubUrl);
            this.ws = ws;
            ws.on('open', () => {
                this.connected = true;
                // Announce ourselves
                this.send({ type: 'hub:join', payload: { meshId: this.config.meshId, info: this.agentInfo } });
                // Start heartbeat
                this.heartbeatTimer = setInterval(() => {
                    if (ws.readyState === ws.OPEN) {
                        ws.ping();
                    }
                }, heartbeatMs);
                resolve();
            });
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this.handleHubMessage(msg);
                }
                catch { }
            });
            ws.on('close', () => {
                this.connected = false;
                this.agentInfo.status = 'offline';
                if (this.heartbeatTimer)
                    clearInterval(this.heartbeatTimer);
                // Reconnect after 5s
                setTimeout(() => this.connectHub().catch(() => { }), 5000);
            });
            ws.on('error', (err) => {
                // Already connected or connection failed
                if (!this.connected)
                    reject(err);
            });
            ws.on('pong', () => {
                // Heartbeat acknowledged
            });
            // Timeout for initial connection
            setTimeout(() => {
                if (!this.connected) {
                    ws.close();
                    reject(new Error('Hub connection timeout'));
                }
            }, 10_000);
        });
    }
    handleHubMessage(msg) {
        switch (msg.type) {
            case 'hub:ping':
                // Updated agent list from Hub
                if (msg.payload.agents && this.config.onAgentUpdate) {
                    for (const agent of msg.payload.agents) {
                        this.config.onAgentUpdate(agent);
                    }
                }
                break;
            case 'hub:context:new':
                this.config.onContext?.(msg.payload.context);
                break;
            case 'hub:delegate:result':
                this.config.onDelegationResult?.(msg.payload.taskId, msg.payload.result);
                break;
            case 'mesh:result': {
                const id = String(msg.payload.id ?? '');
                const req = this.pendingRequests.get(msg.payload.op + ':' + id);
                if (req) {
                    clearTimeout(req.timeout);
                    req.resolve(msg.payload);
                    this.pendingRequests.delete(msg.payload.op + ':' + id);
                }
                break;
            }
        }
    }
    send(msg) {
        if (this.ws && this.ws.readyState === this.ws.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }
    async requestOp(op, timeoutMs = 30_000) {
        const id = randomUUID().slice(0, 8);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(op.op + ':' + id);
                reject(new Error(`Mesh op ${op.op} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pendingRequests.set(op.op + ':' + id, { resolve, reject, timeout });
            this.send({ type: 'mesh:op', payload: { ...op, id } });
        });
    }
    // ─── Tool interface (the actual mesh operations) ────────────────────────────
    /**
     * Execute a mesh operation.
     *
     * In DIRECT mode (no Hub): runs synchronously against local storage.
     * In HUB mode: sends to Hub and waits for response.
     */
    async op(operation) {
        const start = Date.now();
        this.stats.opsReceived++;
        this.agentInfo.lastSeen = Date.now();
        try {
            let result;
            if (this.ws && this.connected) {
                // HUB mode
                result = await this.requestOp(operation);
            }
            else if (this.storage) {
                // DIRECT mode
                result = this.opLocal(operation);
            }
            else {
                throw new Error('No Hub URL and no meshDir configured — mesh is not initialized');
            }
            this.stats.opsOk++;
            this.stats.lastActivity = Date.now();
            result.ms = Date.now() - start;
            return result;
        }
        catch (err) {
            this.stats.opsError++;
            return { ok: false, op: operation.op, error: String(err), ms: Date.now() - start };
        }
    }
    opLocal(op) {
        switch (op.op) {
            case 'publish': {
                const ctx = {
                    ...op.context,
                    id: randomUUID(),
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    expiresAt: op.context.ttlSeconds > 0 ? Date.now() + op.context.ttlSeconds * 1000 : undefined,
                };
                this.storage.writeContext(ctx);
                this.stats.bytesPublished += ctx.content.length;
                this.stats.contextCount++;
                return { ok: true, op: 'publish', data: { id: ctx.id }, ms: 0 };
            }
            case 'query': {
                const { contexts, total, hasMore } = this.storage.queryContexts(op.filter ?? {}, op.limit ?? 50);
                for (const ctx of contexts) {
                    this.stats.bytesRead += ctx.content.length;
                }
                const result = {
                    ok: true, op: 'query', ms: 0,
                    data: { contexts, total, hasMore },
                };
                return result;
            }
            case 'read': {
                const ctx = this.storage.readContext(op.id);
                if (!ctx)
                    return { ok: false, op: 'read', error: `Context ${op.id} not found`, ms: 0 };
                return { ok: true, op: 'read', data: ctx, ms: 0 };
            }
            case 'update': {
                const existing = this.storage.readContext(op.id);
                if (!existing)
                    return { ok: false, op: 'update', error: `Context ${op.id} not found`, ms: 0 };
                const updated = {
                    ...existing,
                    ...op.patch,
                    id: existing.id,
                    agentId: existing.agentId,
                    updatedAt: Date.now(),
                };
                if (op.patch.ttlSeconds !== undefined) {
                    updated.expiresAt = op.patch.ttlSeconds > 0 ? Date.now() + op.patch.ttlSeconds * 1000 : undefined;
                }
                this.storage.writeContext(updated);
                return { ok: true, op: 'update', data: updated, ms: 0 };
            }
            case 'delete': {
                const ok = this.storage.deleteContext(op.id);
                return { ok, op: 'delete', error: ok ? undefined : 'Not found', ms: 0 };
            }
            case 'agents': {
                const agents = this.storage.listAgents(op.filter);
                return { ok: true, op: 'agents', data: { agents, total: agents.length }, ms: 0 };
            }
            case 'delegate': {
                this.storage.writeDelegationTask(op.task);
                return { ok: true, op: 'delegate', data: { taskId: op.task.id, queued: true }, ms: 0 };
            }
            case 'join': {
                this.storage?.registerAgent({ ...this.agentInfo, lastSeen: Date.now() });
                return { ok: true, op: 'join', ms: 0 };
            }
            case 'leave': {
                this.storage?.unregisterAgent(this.agentInfo.id);
                return { ok: true, op: 'leave', ms: 0 };
            }
            case 'ping': {
                return { ok: true, op: 'ping', data: { stats: this.stats, connected: this.connected }, ms: 0 };
            }
        }
    }
    // ─── High-level convenience methods ───────────────────────────────────────
    /** Publish a context — the most common write operation */
    async publish(params) {
        return this.op({
            op: 'publish',
            context: {
                meshId: this.config.meshId,
                agentId: this.agentInfo.id,
                agentName: this.agentInfo.name,
                runtime: this.agentInfo.runtime,
                content: params.content,
                type: params.type,
                tags: params.tags ?? [],
                importance: params.importance ?? 2,
                ttlSeconds: params.ttlSeconds ?? 0,
                parentId: params.parentId,
            },
        });
    }
    /** Query contexts with a natural filter object */
    async query(filter = {}) {
        return (await this.op({ op: 'query', filter, limit: 50 }));
    }
    /** List active peers in this mesh */
    async listPeers() {
        return (await this.op({ op: 'agents', filter: { meshId: this.config.meshId } }));
    }
    /** Delegate a task to another agent (writes to delegation queue, Hub handles routing) */
    async delegate(instruction, priority = 2) {
        const task = {
            id: randomUUID().slice(0, 8),
            instruction,
            priority: priority,
        };
        return (await this.op({ op: 'delegate', task }));
    }
    /** Summarize recent mesh activity as a readable digest */
    async summarizeActivity(hours = 4) {
        const since = Date.now() - hours * 3600 * 1000;
        const { contexts } = (await this.query({ since, limit: 20 })).data;
        if (contexts.length === 0)
            return 'No mesh activity in the last ${hours}h.';
        // Group by type
        const byType = new Map();
        for (const ctx of contexts) {
            if (!byType.has(ctx.type))
                byType.set(ctx.type, []);
            byType.get(ctx.type).push(ctx);
        }
        const lines = [`Mesh Activity (last ${hours}h) — ${contexts.length} items`];
        for (const [type, ctxs] of Array.from(byType.entries())) {
            lines.push(`\n## ${type} (${ctxs.length})`);
            for (const ctx of ctxs.slice(0, 5)) {
                const preview = ctx.content.slice(0, 120).replace(/\n/g, ' ');
                lines.push(`  [${ctx.agentName}] ${preview}${ctx.content.length > 120 ? '...' : ''}`);
            }
            if (ctxs.length > 5)
                lines.push(`  ... and ${ctxs.length - 5} more`);
        }
        return lines.join('\n');
    }
    /** Build a mesh-aware system prompt addition with recent context */
    async buildMeshContext(prefix = '## Mesh Context\n') {
        const { contexts } = (await this.query({ limit: 15 })).data;
        if (contexts.length === 0)
            return '';
        const lines = [prefix];
        for (const ctx of contexts) {
            const age = ctx.createdAt > 0 ? `${Math.round((Date.now() - ctx.createdAt) / 60000)}m ago` : '';
            lines.push(`**[${ctx.type}]** ${ctx.agentName} ${age}`);
            lines.push(ctx.content.slice(0, 300));
            lines.push('');
        }
        return lines.join('\n');
    }
    // ─── Status management ─────────────────────────────────────────────────────
    setStatus(status) {
        this.agentInfo.status = status;
        this.storage?.registerAgent({ ...this.agentInfo, lastSeen: Date.now() });
        if (this.ws && this.connected) {
            this.send({ type: 'agent:status', payload: { status } });
        }
    }
    // ─── Shutdown ──────────────────────────────────────────────────────────────
    async destroy() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        if (this.ws) {
            this.send({ type: 'hub:leave', payload: { meshId: this.config.meshId } });
            this.ws.close();
        }
        if (this.storage) {
            this.storage.unregisterAgent(this.agentInfo.id);
        }
    }
    // ─── Stats ─────────────────────────────────────────────────────────────────
    getStats() {
        return { ...this.stats, agentInfo: { ...this.agentInfo } };
    }
    getAgentInfo() {
        return { ...this.agentInfo };
    }
    isConnected() {
        return this.connected;
    }
}
//# sourceMappingURL=mesh.js.map