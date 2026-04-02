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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
// ─── Storage engine ─────────────────────────────────────────────────────────
export class MeshStorage {
    meshDir;
    contextsDir;
    delegationDir;
    agentsCache = null;
    contextsCache = new Map();
    cacheDirty = false;
    constructor(meshDir) {
        this.meshDir = meshDir;
        this.contextsDir = join(meshDir, 'contexts');
        this.delegationDir = join(meshDir, 'delegation');
        this.ensureDirs();
    }
    ensureDirs() {
        mkdirSync(this.contextsDir, { recursive: true });
        mkdirSync(this.delegationDir, { recursive: true });
        mkdirSync(this.meshDir, { recursive: true });
    }
    // ─── Agents ───────────────────────────────────────────────────────────────
    registerAgent(info) {
        const agents = this.listAgents();
        const idx = agents.findIndex(a => a.id === info.id);
        if (idx >= 0) {
            agents[idx] = { ...info, lastSeen: Date.now() };
        }
        else {
            agents.push({ ...info, lastSeen: Date.now() });
        }
        this.writeAgents(agents);
        this.agentsCache = null;
    }
    unregisterAgent(agentId) {
        const agents = this.listAgents().filter(a => a.id !== agentId);
        this.writeAgents(agents);
        this.agentsCache = null;
    }
    listAgents(filter) {
        if (this.agentsCache) {
            return this.applyAgentFilter(this.agentsCache, filter);
        }
        const path = join(this.meshDir, 'agents.json');
        if (!existsSync(path))
            return [];
        try {
            const data = JSON.parse(readFileSync(path, 'utf-8'));
            this.agentsCache = data;
            return this.applyAgentFilter(data, filter);
        }
        catch {
            return [];
        }
    }
    writeAgents(agents) {
        const path = join(this.meshDir, 'agents.json');
        writeFileSync(path, JSON.stringify(agents, null, 2), 'utf-8');
        this.agentsCache = agents;
    }
    applyAgentFilter(agents, filter) {
        if (!filter)
            return agents;
        return agents.filter(a => {
            if (filter.meshId && a.meshId !== filter.meshId)
                return false;
            if (filter.runtime && a.runtime !== filter.runtime)
                return false;
            if (filter.status && a.status !== filter.status)
                return false;
            return true;
        });
    }
    // ─── Contexts ──────────────────────────────────────────────────────────────
    writeContext(ctx) {
        const path = join(this.contextsDir, `${ctx.id}.json`);
        writeFileSync(path, JSON.stringify(ctx, null, 2), 'utf-8');
        this.contextsCache.set(ctx.id, ctx);
        this.cacheDirty = true;
    }
    readContext(id) {
        // Check cache first
        if (this.contextsCache.has(id)) {
            return this.contextsCache.get(id);
        }
        const path = join(this.contextsDir, `${id}.json`);
        if (!existsSync(path))
            return null;
        try {
            const ctx = JSON.parse(readFileSync(path, 'utf-8'));
            this.contextsCache.set(id, ctx);
            return ctx;
        }
        catch {
            return null;
        }
    }
    deleteContext(id) {
        const path = join(this.contextsDir, `${id}.json`);
        if (!existsSync(path))
            return false;
        try {
            unlinkSync(path);
            this.contextsCache.delete(id);
            return true;
        }
        catch {
            return false;
        }
    }
    queryContexts(filter, limit = 50) {
        // Ensure cache is warm
        if (this.contextsCache.size === 0 || this.cacheDirty) {
            this.warmContextCache();
        }
        let results = Array.from(this.contextsCache.values());
        // Apply filters
        if (filter.meshId) {
            results = results.filter(c => c.meshId === filter.meshId);
        }
        if (filter.agentId) {
            results = results.filter(c => c.agentId === filter.agentId);
        }
        if (filter.runtime) {
            results = results.filter(c => c.runtime === filter.runtime);
        }
        if (filter.type) {
            const types = Array.isArray(filter.type) ? filter.type : [filter.type];
            results = results.filter(c => types.includes(c.type));
        }
        if (filter.tags && filter.tags.length > 0) {
            results = results.filter(c => filter.tags.some(t => c.tags.includes(t)));
        }
        if (filter.importance !== undefined) {
            results = results.filter(c => c.importance === filter.importance);
        }
        if (filter.search) {
            const q = filter.search.toLowerCase();
            results = results.filter(c => c.content.toLowerCase().includes(q));
        }
        if (filter.since !== undefined) {
            results = results.filter(c => c.createdAt >= filter.since);
        }
        if (filter.until !== undefined) {
            results = results.filter(c => c.createdAt <= filter.until);
        }
        // Sort by createdAt descending
        results.sort((a, b) => b.createdAt - a.createdAt);
        const total = results.length;
        const offset = filter.offset ?? 0;
        const limited = results.slice(offset, offset + limit);
        const hasMore = offset + limited.length < total;
        return { contexts: limited, total, hasMore };
    }
    warmContextCache() {
        this.contextsCache.clear();
        try {
            const files = readdirSync(this.contextsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const ctx = JSON.parse(readFileSync(join(this.contextsDir, file), 'utf-8'));
                    // Expire if TTL reached
                    if (ctx.expiresAt && Date.now() > ctx.expiresAt) {
                        unlinkSync(join(this.contextsDir, file));
                        continue;
                    }
                    this.contextsCache.set(ctx.id, ctx);
                }
                catch {
                    // Corrupted file — skip
                }
            }
        }
        catch {
            // Dir doesn't exist yet
        }
        this.cacheDirty = false;
    }
    // ─── Delegation ────────────────────────────────────────────────────────────
    writeDelegationTask(task) {
        const path = join(this.delegationDir, `${task.id}.json`);
        writeFileSync(path, JSON.stringify(task, null, 2), 'utf-8');
    }
    readDelegationTask(id) {
        const path = join(this.delegationDir, `${id}.json`);
        if (!existsSync(path))
            return null;
        try {
            return JSON.parse(readFileSync(path, 'utf-8'));
        }
        catch {
            return null;
        }
    }
    listDelegationTasks(pendingOnly = true) {
        try {
            const files = readdirSync(this.delegationDir).filter(f => f.endsWith('.json'));
            return files
                .map(f => {
                try {
                    return JSON.parse(readFileSync(join(this.delegationDir, f), 'utf-8'));
                }
                catch {
                    return null;
                }
            })
                .filter((t) => {
                if (!t)
                    return false;
                if (pendingOnly && t.completed)
                    return false;
                return true;
            });
        }
        catch {
            return [];
        }
    }
    deleteDelegationTask(id) {
        const path = join(this.delegationDir, `${id}.json`);
        if (!existsSync(path))
            return false;
        try {
            unlinkSync(path);
            return true;
        }
        catch {
            return false;
        }
    }
    // ─── Utility ───────────────────────────────────────────────────────────────
    getMeshDir() {
        return this.meshDir;
    }
    /** Remove contexts and agents for agents that haven't been seen in `staleMs` */
    purgeStale(staleMs) {
        const cutoff = Date.now() - staleMs;
        let purgedContexts = 0;
        let purgedAgents = 0;
        // Purge stale contexts
        const ctxFiles = readdirSync(this.contextsDir).filter(f => f.endsWith('.json'));
        for (const file of ctxFiles) {
            try {
                const ctx = JSON.parse(readFileSync(join(this.contextsDir, file), 'utf-8'));
                if (ctx.expiresAt && ctx.expiresAt < Date.now()) {
                    unlinkSync(join(this.contextsDir, file));
                    purgedContexts++;
                }
            }
            catch { }
        }
        // Purge stale agents
        const agents = this.listAgents();
        const active = agents.filter(a => a.lastSeen > cutoff);
        if (active.length < agents.length) {
            purgedAgents = agents.length - active.length;
            this.writeAgents(active);
        }
        return { purgedContexts, purgedAgents };
    }
}
//# sourceMappingURL=storage.js.map