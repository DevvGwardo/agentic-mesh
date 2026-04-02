/**
 * OpenClaw integration for agentic-mesh
 *
 * OpenClaw has a native tool plugin system. This module provides:
 *  1. ClawMeshTool — a tool definition for the OpenClaw tool registry
 *  2. ClawMesh — the mesh instance bound to the OpenClaw runtime
 *
 * Setup in OpenClaw config (~/.openclaw/config.yaml):
 *
 *   plugins:
 *     agentic-mesh:
 *       meshId: clawborators
 *       meshDir: ~/.openclaw/mesh
 *       hubUrl: ws://localhost:8765  # optional
 *
 * OpenClaw agents can then call:
 *   tool: mesh
 *   args:
 *     operation: publish
 *     type: finding
 *     content: "Found a bug in the auth module..."
 *     tags: [bug, auth]
 *     importance: 3
 */

import { Mesh } from '../src/mesh.js';
import type { AgentCapabilities, AgentRuntime, MeshContext } from '../src/types.js';

// ─── OpenClaw tool definition ────────────────────────────────────────────────

export interface ClawMeshConfig {
  meshId: string;
  meshDir?: string;
  hubUrl?: string;
  agentName?: string;
  agentId?: string;
  agentVersion?: string;
}

export interface ClawMeshToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const CLAW_MESH_TOOL: ClawMeshToolDefinition = {
  name: 'mesh',
  description: 'Cross-agent collaboration: publish findings, query peer activity, delegate tasks, and collaborate with Hermes or OpenClaw agents in your mesh.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['publish', 'query', 'read', 'update', 'delete', 'agents', 'delegate', 'ping', 'summarize', 'context'],
        description: 'The mesh operation',
      },
      content: { type: 'string', description: 'Content to publish (publish op)' },
      type: {
        type: 'string',
        enum: ['task', 'finding', 'code', 'log', 'note', 'plan', 'result', 'message', 'system'],
        description: 'Context type (publish op)',
      },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags (publish op)' },
      importance: { type: 'integer', minimum: 1, maximum: 3, description: '1=low, 2=medium, 3=high' },
      ttl_seconds: { type: 'integer', description: 'TTL in seconds, 0=forever (publish op)' },
      id: { type: 'string', description: 'Context ID (read/update/delete ops)' },
      filter_type: { type: 'string', description: 'Filter by type (query op)' },
      filter_agent: { type: 'string', description: 'Filter by agent name (query op)' },
      filter_tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (query op, OR match)' },
      filter_search: { type: 'string', description: 'Text search in content (query op)' },
      limit: { type: 'integer', description: 'Max results (query op, default 20)' },
      instruction: { type: 'string', description: 'Task instruction (delegate op)' },
      target_runtime: { type: 'string', enum: ['hermes', 'openclaw'], description: 'Preferred target (delegate op)' },
      patch_content: { type: 'string', description: 'New content (update op)' },
      patch_ttl_seconds: { type: 'integer', description: 'New TTL (update op)' },
    },
    required: ['operation'],
  },
};

// ─── OpenClaw tool runner ─────────────────────────────────────────────────────

export function createClawMeshRunner(mesh: Mesh) {
  return async function runMeshTool(args: Record<string, unknown>): Promise<string> {
    const op = args.operation as string;

    switch (op) {
      case 'publish': {
        if (!args.content || !args.type) {
          return JSON.stringify({ ok: false, error: 'content and type required for publish' });
        }
        const result = await mesh.publish({
          content: String(args.content),
          type: String(args.type) as MeshContext['type'],
          tags: (args.tags as string[]) ?? [],
          importance: (args.importance as 1 | 2 | 3) ?? 2,
          ttlSeconds: (args.ttl_seconds as number) ?? 0,
        });
        return JSON.stringify(result);
      }

      case 'query': {
        const qr = await mesh.query({
          type: args.filter_type as import('../src/types.js').ContextType | import('../src/types.js').ContextType[] | undefined,
          agentName: args.filter_agent as string | undefined,
          tags: args.filter_tags as string[] | undefined,
          search: args.filter_search as string | undefined,
          limit: (args.limit as number) ?? 20,
        });
        return JSON.stringify({ ok: true, contexts: qr.data.contexts, total: qr.data.total, hasMore: qr.data.hasMore });
      }

      case 'read': {
        if (!args.id) return JSON.stringify({ ok: false, error: 'id required for read' });
        const result = await mesh.op({ op: 'read', id: String(args.id) });
        return JSON.stringify(result);
      }

      case 'update': {
        if (!args.id) return JSON.stringify({ ok: false, error: 'id required for update' });
        const patch: Record<string, unknown> = {};
        if (args.patch_content) patch.content = args.patch_content;
        if (args.patch_ttl_seconds !== undefined) patch.ttlSeconds = args.patch_ttl_seconds;
        const result = await mesh.op({ op: 'update', id: String(args.id), patch: patch as Parameters<typeof mesh.op>[0] extends { op: 'update'; patch: infer P } ? { patch: P } : never });
        return JSON.stringify(result);
      }

      case 'delete': {
        if (!args.id) return JSON.stringify({ ok: false, error: 'id required for delete' });
        const result = await mesh.op({ op: 'delete', id: String(args.id) });
        return JSON.stringify(result);
      }

      case 'agents': {
        const result = await mesh.listPeers();
        return JSON.stringify(result);
      }

      case 'delegate': {
        if (!args.instruction) return JSON.stringify({ ok: false, error: 'instruction required for delegate' });
        const result = await mesh.delegate(String(args.instruction));
        return JSON.stringify(result);
      }

      case 'ping': {
        const stats = mesh.getStats();
        const result = await mesh.op({ op: 'ping' });
        return JSON.stringify({ stats, ...result });
      }

      case 'summarize': {
        const digest = await mesh.summarizeActivity();
        return JSON.stringify({ ok: true, digest });
      }

      case 'context': {
        const ctx = await mesh.buildMeshContext();
        return JSON.stringify({ ok: true, context: ctx });
      }

      default:
        return JSON.stringify({ ok: false, error: `Unknown operation: ${op}` });
    }
  };
}

// ─── OpenClaw plugin bootstrap ───────────────────────────────────────────────

export interface OpenClawPlugin {
  name: string;
  version: string;
  tools: ClawMeshToolDefinition[];
  onInit: (ctx: { agentId: string; agentName: string; version: string }) => Promise<{
    mesh: Mesh;
    runTool: ReturnType<typeof createClawMeshRunner>;
  }>;
}

export function createOpenClawMeshPlugin(config: ClawMeshConfig): OpenClawPlugin {
  return {
    name: 'agentic-mesh',
    version: '0.1.0',
    tools: [CLAW_MESH_TOOL],

    async onInit(ctx) {
      const mesh = await Mesh.create({
        meshId: config.meshId,
        meshDir: config.meshDir ?? `${process.env.OPENCLAW_HOME ?? '~/.openclaw'}/mesh`,
        hubUrl: config.hubUrl,
        agentInfo: {
          id: config.agentId ?? ctx.agentId,
          name: config.agentName ?? ctx.agentName,
          runtime: 'openclaw' as AgentRuntime,
          version: config.agentVersion ?? ctx.version,
          capabilities: {
            canReadContext: true,
            canWriteContext: true,
            canOrchestrate: true,
            canDelegate: true,
            maxContextBytes: 100_000,
          } as AgentCapabilities,
        },
      });

      const runTool = createClawMeshRunner(mesh);
      return { mesh, runTool };
    },
  };
}
