import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { MeshStorage } from './storage.js';
import type { MeshContext, AgentInfo } from './types.js';

const TEST_MESH_ID = 'test-mesh';

function makeTempDir(): string {
  const dir = join('/tmp', `mesh-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeContext(overrides: Partial<MeshContext> = {}): MeshContext {
  const now = Date.now();
  return {
    id: randomUUID(),
    meshId: TEST_MESH_ID,
    agentId: 'test-agent',
    agentName: 'TestAgent',
    runtime: 'hermes',
    type: 'finding',
    content: 'test content',
    tags: ['test'],
    importance: 2,
    ttlSeconds: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  const now = Date.now();
  return {
    id: randomUUID(),
    name: 'TestAgent',
    runtime: 'hermes',
    version: '1.0.0',
    meshId: TEST_MESH_ID,
    capabilities: {
      canReadContext: true,
      canWriteContext: true,
      canOrchestrate: true,
      canDelegate: true,
      maxContextBytes: 100_000,
    },
    status: 'active',
    registeredAt: now,
    lastSeen: now,
    ...overrides,
  };
}

describe('MeshStorage', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ─── Context write / read / delete ─────────────────────────────────────────

  describe('contexts', () => {
    it('writes and reads a context', () => {
      const storage = new MeshStorage(dir);
      const ctx = makeContext({ content: 'hello world' });
      storage.writeContext(ctx);

      const found = storage.readContext(ctx.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(ctx.id);
      expect(found!.content).toBe('hello world');
    });

    it('readContext returns null for unknown id', () => {
      const storage = new MeshStorage(dir);
      expect(storage.readContext('nonexistent')).toBeNull();
    });

    it('deletes a context and removes it from cache', () => {
      const storage = new MeshStorage(dir);
      const ctx = makeContext();
      storage.writeContext(ctx);

      const ok = storage.deleteContext(ctx.id);
      expect(ok).toBe(true);
      expect(storage.readContext(ctx.id)).toBeNull();
    });

    it('deleteContext returns false for unknown id', () => {
      const storage = new MeshStorage(dir);
      expect(storage.deleteContext('nonexistent')).toBe(false);
    });

    it('update overwrites content and resets updatedAt', async () => {
      const storage = new MeshStorage(dir);
      const ctx = makeContext();
      storage.writeContext(ctx);

      const updated: MeshContext = {
        ...ctx,
        content: 'updated content',
        updatedAt: Date.now() + 1000,
      };
      storage.writeContext(updated);

      const found = storage.readContext(ctx.id);
      expect(found!.content).toBe('updated content');
      expect(found!.updatedAt).toBe(updated.updatedAt);
    });

    it('expires contexts on read when ttlSeconds > 0', () => {
      const storage = new MeshStorage(dir);
      const ctx = makeContext({ ttlSeconds: 1, expiresAt: Date.now() - 500 });
      storage.writeContext(ctx);

      // warm cache first
      storage.queryContexts({}, 10);
      expect(storage.readContext(ctx.id)).toBeNull();
    });
  });

  // ─── Context query ─────────────────────────────────────────────────────────

  describe('queryContexts', () => {
    it('returns all contexts with no filter', () => {
      const storage = new MeshStorage(dir);
      for (let i = 0; i < 5; i++) storage.writeContext(makeContext({ content: `ctx ${i}` }));
      const { contexts, total, hasMore } = storage.queryContexts({}, 10);
      expect(total).toBe(5);
      expect(contexts).toHaveLength(5);
      expect(hasMore).toBe(false);
    });

    it('filters by meshId', () => {
      const storage = new MeshStorage(dir);
      storage.writeContext(makeContext({ meshId: 'mesh-a' }));
      storage.writeContext(makeContext({ meshId: 'mesh-b' }));

      const { contexts } = storage.queryContexts({ meshId: 'mesh-a' }, 10);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].meshId).toBe('mesh-a');
    });

    it('filters by type', () => {
      const storage = new MeshStorage(dir);
      storage.writeContext(makeContext({ type: 'finding' }));
      storage.writeContext(makeContext({ type: 'task' }));
      storage.writeContext(makeContext({ type: 'task' }));

      const { contexts } = storage.queryContexts({ type: 'task' }, 10);
      expect(contexts).toHaveLength(2);
      expect(contexts.every(c => c.type === 'task')).toBe(true);
    });

    it('filters by multiple types as array', () => {
      const storage = new MeshStorage(dir);
      storage.writeContext(makeContext({ type: 'finding' }));
      storage.writeContext(makeContext({ type: 'task' }));
      storage.writeContext(makeContext({ type: 'note' }));

      const { contexts } = storage.queryContexts({ type: ['finding', 'note'] }, 10);
      expect(contexts).toHaveLength(2);
    });

    it('filters by tags (OR match)', () => {
      const storage = new MeshStorage(dir);
      storage.writeContext(makeContext({ tags: ['bug', 'auth'] }));
      storage.writeContext(makeContext({ tags: ['bug'] }));
      storage.writeContext(makeContext({ tags: ['perf'] }));

      const { contexts } = storage.queryContexts({ tags: ['bug'] }, 10);
      expect(contexts).toHaveLength(2);
    });

    it('filters by importance', () => {
      const storage = new MeshStorage(dir);
      storage.writeContext(makeContext({ importance: 1 }));
      storage.writeContext(makeContext({ importance: 3 }));

      const { contexts } = storage.queryContexts({ importance: 3 }, 10);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].importance).toBe(3);
    });

    it('filters by search (case-insensitive substring)', () => {
      const storage = new MeshStorage(dir);
      storage.writeContext(makeContext({ content: 'Race condition in OAuth' }));
      storage.writeContext(makeContext({ content: 'Memory leak in session' }));

      const { contexts } = storage.queryContexts({ search: 'race' }, 10);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].content).toContain('Race');
    });

    it('filters by since / until timestamp', () => {
      const storage = new MeshStorage(dir);
      const now = Date.now();
      storage.writeContext(makeContext({ createdAt: now - 10_000 }));
      storage.writeContext(makeContext({ createdAt: now - 60_000 }));
      storage.writeContext(makeContext({ createdAt: now - 120_000 }));

      const { contexts } = storage.queryContexts({ since: now - 90_000 }, 10);
      expect(contexts).toHaveLength(2);
    });

    it('sorts by createdAt descending (newest first)', () => {
      const storage = new MeshStorage(dir);
      storage.writeContext(makeContext({ content: 'oldest', createdAt: 1000 }));
      storage.writeContext(makeContext({ content: 'newest', createdAt: 3000 }));
      storage.writeContext(makeContext({ content: 'middle', createdAt: 2000 }));

      const { contexts } = storage.queryContexts({}, 10);
      expect(contexts[0].content).toBe('newest');
      expect(contexts[1].content).toBe('middle');
      expect(contexts[2].content).toBe('oldest');
    });

    it('paginates with limit and offset', () => {
      const storage = new MeshStorage(dir);
      for (let i = 0; i < 10; i++) storage.writeContext(makeContext({ content: `ctx ${i}` }));

      const page1 = storage.queryContexts({ offset: 0 }, 4);
      expect(page1.contexts).toHaveLength(4);
      expect(page1.hasMore).toBe(true);
      expect(page1.total).toBe(10);

      const page2 = storage.queryContexts({ offset: 4 }, 4);
      expect(page2.contexts).toHaveLength(4);
      expect(page2.hasMore).toBe(true);

      const page3 = storage.queryContexts({ offset: 8 }, 4);
      expect(page3.contexts).toHaveLength(2);
      expect(page3.hasMore).toBe(false);
    });

    it('filters by agentId', () => {
      const storage = new MeshStorage(dir);
      storage.writeContext(makeContext({ agentId: 'agent-a' }));
      storage.writeContext(makeContext({ agentId: 'agent-b' }));

      const { contexts } = storage.queryContexts({ agentId: 'agent-a' }, 10);
      expect(contexts).toHaveLength(1);
      expect(contexts[0].agentId).toBe('agent-a');
    });
  });

  // ─── Agent registry ────────────────────────────────────────────────────────

  describe('agents', () => {
    it('registers and lists agents', () => {
      const storage = new MeshStorage(dir);
      const agent = makeAgent({ id: 'agent-1', name: 'Alpha' });
      storage.registerAgent(agent);

      const agents = storage.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('Alpha');
    });

    it('registers a second agent without overwriting the first', () => {
      const storage = new MeshStorage(dir);
      storage.registerAgent(makeAgent({ id: 'agent-1' }));
      storage.registerAgent(makeAgent({ id: 'agent-2' }));

      const agents = storage.listAgents();
      expect(agents).toHaveLength(2);
    });

    it('updates lastSeen on re-registration', () => {
      const storage = new MeshStorage(dir);
      const agent = makeAgent({ id: 'agent-1', lastSeen: 1000 });
      storage.registerAgent(agent);

      const updated = makeAgent({ id: 'agent-1', lastSeen: 2000 });
      storage.registerAgent(updated);

      const agents = storage.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].lastSeen).toBe(2000);
    });

    it('unregisters an agent', () => {
      const storage = new MeshStorage(dir);
      const agent = makeAgent({ id: 'agent-1' });
      storage.registerAgent(agent);

      storage.unregisterAgent('agent-1');
      expect(storage.listAgents()).toHaveLength(0);
    });

    it('filters agents by meshId', () => {
      const storage = new MeshStorage(dir);
      storage.registerAgent(makeAgent({ id: 'a', meshId: 'mesh-a' }));
      storage.registerAgent(makeAgent({ id: 'b', meshId: 'mesh-b' }));

      const agents = storage.listAgents({ meshId: 'mesh-a' });
      expect(agents).toHaveLength(1);
      expect(agents[0].meshId).toBe('mesh-a');
    });

    it('filters agents by status', () => {
      const storage = new MeshStorage(dir);
      storage.registerAgent(makeAgent({ id: 'a', status: 'active' }));
      storage.registerAgent(makeAgent({ id: 'b', status: 'offline' }));

      const active = storage.listAgents({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].status).toBe('active');
    });

    it('filters agents by runtime', () => {
      const storage = new MeshStorage(dir);
      storage.registerAgent(makeAgent({ id: 'a', runtime: 'hermes' }));
      storage.registerAgent(makeAgent({ id: 'b', runtime: 'openclaw' }));

      const openclaw = storage.listAgents({ runtime: 'openclaw' });
      expect(openclaw).toHaveLength(1);
      expect(openclaw[0].runtime).toBe('openclaw');
    });
  });

  // ─── Delegation tasks ──────────────────────────────────────────────────────

  describe('delegation tasks', () => {
    it('writes and reads a delegation task', () => {
      const storage = new MeshStorage(dir);
      const task = {
        id: randomUUID(),
        instruction: 'do the thing',
        priority: 2 as const,
      };
      storage.writeDelegationTask(task);

      const found = storage.readDelegationTask(task.id);
      expect(found).toBeDefined();
      expect(found!.instruction).toBe('do the thing');
    });

    it('lists pending delegation tasks', () => {
      const storage = new MeshStorage(dir);
      storage.writeDelegationTask({ id: 't1', instruction: 'task 1', priority: 2 });
      storage.writeDelegationTask({ id: 't2', instruction: 'task 2', priority: 3 });

      const tasks = storage.listDelegationTasks(true);
      expect(tasks).toHaveLength(2);
    });

    it('deletes a delegation task', () => {
      const storage = new MeshStorage(dir);
      storage.writeDelegationTask({ id: 't1', instruction: 'task 1', priority: 2 });
      storage.deleteDelegationTask('t1');

      const tasks = storage.listDelegationTasks(true);
      expect(tasks).toHaveLength(0);
    });
  });

  // ─── Cache lifecycle ────────────────────────────────────────────────────────

  describe('cache lifecycle', () => {
    it('cache starts cold and is warmed by queryContexts', () => {
      const storage = new MeshStorage(dir);
      // Write a context without going through queryContexts
      const ctx = makeContext({ content: 'uncached' });
      storage.writeContext(ctx);

      // Cache should be cold
      expect((storage as unknown as { contextsCache: Map<string, MeshContext> }).contextsCache.size).toBe(0);

      // Query warms it
      storage.queryContexts({}, 10);
      expect((storage as unknown as { contextsCache: Map<string, MeshContext> }).contextsCache.size).toBe(1);
    });

    it('writeContext marks cache dirty', () => {
      const storage = new MeshStorage(dir);
      storage.queryContexts({}, 10); // warm cache
      expect((storage as unknown as { cacheDirty: boolean }).cacheDirty).toBe(false);

      storage.writeContext(makeContext());
      expect((storage as unknown as { cacheDirty: boolean }).cacheDirty).toBe(true);
    });

    it('warmContextCache clears stale entries and sets cacheDirty to false', () => {
      const storage = new MeshStorage(dir);
      // Write an expired context
      const expired = makeContext({ id: 'expired', expiresAt: Date.now() - 1000 });
      storage.writeContext(expired);

      // Cache is dirty from write
      expect((storage as unknown as { cacheDirty: boolean }).cacheDirty).toBe(true);

      // warmContextCache is called internally by queryContexts
      storage.queryContexts({}, 10);

      // Expired entry should be gone, cacheDirty should be false
      expect((storage as unknown as { contextsCache: Map<string, MeshContext> }).contextsCache.has('expired')).toBe(false);
      expect((storage as unknown as { cacheDirty: boolean }).cacheDirty).toBe(false);
    });
  });

  // ─── purgeStale ─────────────────────────────────────────────────────────────

  describe('purgeStale', () => {
    it('purges expired contexts from disk', () => {
      const storage = new MeshStorage(dir);
      const expired = makeContext({ id: 'expired', expiresAt: Date.now() - 500 });
      storage.writeContext(expired);

      const { purgedContexts } = storage.purgeStale(86_400_000);
      expect(purgedContexts).toBe(1);
      expect(storage.readContext('expired')).toBeNull();
    });

    it('purges stale agents past cutoff', () => {
      const storage = new MeshStorage(dir);
      const stale = makeAgent({ id: 'stale', lastSeen: Date.now() - 86_400_000 - 1000 });
      const fresh = makeAgent({ id: 'fresh', lastSeen: Date.now() });
      storage.registerAgent(stale);
      storage.registerAgent(fresh);

      const { purgedAgents } = storage.purgeStale(86_400_000);
      expect(purgedAgents).toBe(1);

      const agents = storage.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('fresh');
    });

    it('purges nothing when nothing is stale', () => {
      const storage = new MeshStorage(dir);
      storage.writeContext(makeContext());
      storage.registerAgent(makeAgent());

      const { purgedContexts, purgedAgents } = storage.purgeStale(86_400_000);
      expect(purgedContexts).toBe(0);
      expect(purgedAgents).toBe(0);
    });
  });
});
