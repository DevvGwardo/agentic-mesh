/**
 * tool.ts — Shared mesh tool handler for all agent runtimes
 *
 * Both Hermes and OpenClaw adapters use this for their mesh tool.
 * The switch-case logic is identical; only the Mesh instance differs.
 */

import type { Mesh } from './mesh.js';
import type { ContextType, MeshContext } from './types.js';

// ─── Tool schema (MCP-compatible) ────────────────────────────────────────────

export const MESH_TOOL_SCHEMA = {
  name: 'mesh',
  description:
    'Cross-agent collaboration: publish findings, query peer activity, delegate tasks, and collaborate with Hermes or OpenClaw agents in your mesh.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: [
          'publish',
          'query',
          'read',
          'update',
          'delete',
          'agents',
          'delegate',
          'ping',
          'summarize',
          'context',
        ],
        description: 'The mesh operation to perform',
      },
      // publish
      content: {
        type: 'string',
        description: 'Content to publish (publish op)',
      },
      type: {
        type: 'string',
        enum: [
          'task',
          'finding',
          'code',
          'log',
          'note',
          'plan',
          'result',
          'message',
          'system',
        ],
        description: 'Context type (publish op)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization (publish op)',
      },
      importance: {
        type: 'integer',
        minimum: 1,
        maximum: 3,
        description: '1=low, 2=medium, 3=high importance (publish op)',
      },
      ttl_seconds: {
        type: 'integer',
        description:
          'TTL in seconds — context auto-expires after this (0=forever, default=0)',
      },
      // read / update / delete
      id: {
        type: 'string',
        description: 'Context ID (read / update / delete ops)',
      },
      // query filters
      filter_type: {
        type: 'string',
        description: 'Filter by context type (query op)',
      },
      filter_agent: {
        type: 'string',
        description: 'Filter by agent name (query op)',
      },
      filter_tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags — OR match (query op)',
      },
      filter_search: {
        type: 'string',
        description: 'Substring search in content (query op)',
      },
      limit: {
        type: 'integer',
        description: 'Max results to return (query op, default=20)',
      },
      // delegate
      instruction: {
        type: 'string',
        description: 'Task instruction (delegate op)',
      },
      target_runtime: {
        type: 'string',
        enum: ['hermes', 'openclaw'],
        description: 'Preferred target runtime (delegate op)',
      },
      // update patch
      patch_content: {
        type: 'string',
        description: 'Replacement content (update op)',
      },
      patch_tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Replacement tags (update op)',
      },
      patch_importance: {
        type: 'integer',
        minimum: 1,
        maximum: 3,
        description: 'Replacement importance (update op)',
      },
      patch_ttl_seconds: {
        type: 'integer',
        description: 'Replacement TTL in seconds (update op)',
      },
    },
    required: ['operation'],
  },
} as const;

// ─── Tool runner ─────────────────────────────────────────────────────────────

export type MeshToolArgs = Record<string, unknown>;

/**
 * Shared handler for all mesh tool operations.
 * Used by both Hermes and OpenClaw adapters.
 */
export async function runMeshTool(mesh: Mesh, args: MeshToolArgs): Promise<string> {
  const op = args.operation as string;

  switch (op) {
    case 'publish': {
      if (!args.content || !args.type) {
        return JSON.stringify({ ok: false, error: 'content and type are required for publish' });
      }
      const result = await mesh.publish({
        content: String(args.content),
        type: String(args.type) as ContextType,
        tags: (args.tags as string[]) ?? [],
        importance: (args.importance as 1 | 2 | 3) ?? 2,
        ttlSeconds: (args.ttl_seconds as number) ?? 0,
      });
      return JSON.stringify(result);
    }

    case 'query': {
      const qr = await mesh.query({
        type: args.filter_type as ContextType | ContextType[] | undefined,
        agentName: args.filter_agent as string | undefined,
        tags: args.filter_tags as string[] | undefined,
        search: args.filter_search as string | undefined,
        limit: (args.limit as number) ?? 20,
      });
      return JSON.stringify({
        ok: true,
        contexts: qr.data.contexts,
        total: qr.data.total,
        hasMore: qr.data.hasMore,
      });
    }

    case 'read': {
      if (!args.id) return JSON.stringify({ ok: false, error: 'id is required for read' });
      const result = await mesh.op({ op: 'read', id: String(args.id) });
      return JSON.stringify(result);
    }

    case 'update': {
      if (!args.id) return JSON.stringify({ ok: false, error: 'id is required for update' });
      const patch: Partial<Pick<MeshContext, 'content' | 'tags' | 'importance' | 'ttlSeconds'>> = {};
      if (args.patch_content !== undefined) patch.content = String(args.patch_content);
      if (args.patch_tags !== undefined) patch.tags = args.patch_tags as string[];
      if (args.patch_importance !== undefined)
        patch.importance = args.patch_importance as 1 | 2 | 3;
      if (args.patch_ttl_seconds !== undefined)
        patch.ttlSeconds = Number(args.patch_ttl_seconds);
      const result = await mesh.op({ op: 'update', id: String(args.id), patch });
      return JSON.stringify(result);
    }

    case 'delete': {
      if (!args.id) return JSON.stringify({ ok: false, error: 'id is required for delete' });
      const result = await mesh.op({ op: 'delete', id: String(args.id) });
      return JSON.stringify(result);
    }

    case 'agents': {
      const result = await mesh.listPeers();
      return JSON.stringify(result);
    }

    case 'delegate': {
      if (!args.instruction) {
        return JSON.stringify({ ok: false, error: 'instruction is required for delegate' });
      }
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
}
