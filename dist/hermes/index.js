/**
 * Hermes integration for agentic-mesh
 *
 * Provides:
 *  1. MeshTool — a tool the agent calls directly (tool-calling interface)
 *  2. MeshCron — a cron-driven job that keeps the mesh warm and summarizes activity
 *
 * Setup in Hermes profile config (~/.hermes/profiles/<profile>/config.yaml):
 *
 *   plugins:
 *     - path: ~/agentic-mesh/hermes
 *       config:
 *         meshId: clawborators
 *         meshDir: ~/.hermes/mesh
 *         hubUrl: ws://localhost:8765   # optional
 *
 * Or use the MeshCron skill for easier cron management.
 */
import { Mesh } from '../src/mesh.js';
// ─── Tool schema (MCP-style) ─────────────────────────────────────────────────
export const MESH_TOOL_SCHEMA = {
    name: 'mesh',
    description: 'Interact with the agentic-mesh — publish findings, query peer activity, delegate tasks, and collaborate with other agents (Hermes or OpenClaw) in your mesh.',
    inputSchema: {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['publish', 'query', 'read', 'update', 'delete', 'agents', 'delegate', 'ping', 'summarize', 'context'],
                description: 'The mesh operation to perform',
            },
            // publish
            content: {
                type: 'string',
                description: 'Content to publish (for publish operation)',
            },
            type: {
                type: 'string',
                enum: ['task', 'finding', 'code', 'log', 'note', 'plan', 'result', 'message', 'system'],
                description: 'Context type (for publish)',
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorization (for publish)',
            },
            importance: {
                type: 'integer',
                minimum: 1,
                maximum: 3,
                description: '1=low, 2=medium, 3=high importance (for publish)',
            },
            ttl_seconds: {
                type: 'integer',
                description: 'TTL in seconds — context auto-expires after this (0=forever, default=0)',
            },
            // query/read/delete
            id: {
                type: 'string',
                description: 'Context ID (for read/update/delete)',
            },
            // query filters
            filter_type: {
                type: 'string',
                description: 'Filter by context type (for query)',
            },
            filter_agent: {
                type: 'string',
                description: 'Filter by agent name (for query)',
            },
            filter_tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by tags (OR match, for query)',
            },
            filter_search: {
                type: 'string',
                description: 'Text search in content (for query)',
            },
            limit: {
                type: 'integer',
                description: 'Max results (for query, default=20)',
            },
            // delegate
            instruction: {
                type: 'string',
                description: 'Task instruction (for delegate)',
            },
            target_runtime: {
                type: 'string',
                enum: ['hermes', 'openclaw'],
                description: 'Preferred target runtime (for delegate)',
            },
            // update
            patch_content: {
                type: 'string',
                description: 'New content (for update)',
            },
            patch_ttl_seconds: {
                type: 'integer',
                description: 'New TTL in seconds (for update)',
            },
        },
        required: ['operation'],
    },
};
// ─── Tool handler ────────────────────────────────────────────────────────────
export function buildMeshToolHandler(mesh) {
    return async function handleMeshTool(args) {
        const op = args.operation;
        switch (op) {
            case 'publish': {
                if (!args.content || !args.type) {
                    return JSON.stringify({ ok: false, error: 'content and type required for publish' });
                }
                const result = await mesh.publish({
                    content: String(args.content),
                    type: String(args.type),
                    tags: args.tags ?? [],
                    importance: args.importance ?? 2,
                    ttlSeconds: args.ttl_seconds ?? 0,
                });
                return JSON.stringify(result);
            }
            case 'query': {
                const qr = await mesh.query({
                    type: args.filter_type,
                    agentName: args.filter_agent,
                    tags: args.filter_tags,
                    search: args.filter_search,
                    limit: args.limit ?? 20,
                });
                return JSON.stringify({ ok: true, contexts: qr.data.contexts, total: qr.data.total, hasMore: qr.data.hasMore });
            }
            case 'read': {
                if (!args.id)
                    return JSON.stringify({ ok: false, error: 'id required for read' });
                const result = await mesh.op({ op: 'read', id: String(args.id) });
                return JSON.stringify(result);
            }
            case 'update': {
                if (!args.id)
                    return JSON.stringify({ ok: false, error: 'id required for update' });
                const patch = {};
                if (args.patch_content)
                    patch.content = args.patch_content;
                if (args.patch_ttl_seconds !== undefined)
                    patch.ttlSeconds = args.patch_ttl_seconds;
                const result = await mesh.op({
                    op: 'update',
                    id: String(args.id),
                    patch: patch,
                });
                return JSON.stringify(result);
            }
            case 'delete': {
                if (!args.id)
                    return JSON.stringify({ ok: false, error: 'id required for delete' });
                const result = await mesh.op({ op: 'delete', id: String(args.id) });
                return JSON.stringify(result);
            }
            case 'agents': {
                const result = await mesh.listPeers();
                return JSON.stringify(result);
            }
            case 'delegate': {
                if (!args.instruction)
                    return JSON.stringify({ ok: false, error: 'instruction required for delegate' });
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
export function createHermesMeshPlugin(config) {
    return {
        name: 'agentic-mesh',
        version: '0.1.0',
        async onInit(hermes) {
            const mesh = await Mesh.create({
                meshId: config.meshId,
                meshDir: config.meshDir ?? `${process.env.HERMES_HOME ?? '~/.hermes'}/mesh`,
                hubUrl: config.hubUrl,
                agentInfo: {
                    id: config.agentId ?? hermes.getAgentId(),
                    name: config.agentName ?? hermes.getAgentName(),
                    runtime: 'hermes',
                    version: config.agentVersion ?? hermes.getVersion(),
                    capabilities: {
                        canReadContext: true,
                        canWriteContext: true,
                        canOrchestrate: true,
                        canDelegate: true,
                        maxContextBytes: 100_000,
                    },
                },
            });
            const toolHandler = buildMeshToolHandler(mesh);
            return { mesh, toolHandler };
        },
    };
}
// ─── MeshCron skill (for Hermes cron jobs) ───────────────────────────────────
/**
 * MeshCron — run inside a Hermes cron job to:
 *  1. Publish a heartbeat/system context
 *  2. Summarize recent mesh activity
 *  3. Process any pending delegation tasks
 *
 * Cron setup:
 *   /cron add "mesh-pulse" --every 15m --skill mesh_cron
 *
 * The cron prompt calls runMeshCron() with the mesh directory.
 */
export async function runMeshCron(mesh) {
    const lines = [];
    // 1. Publish a heartbeat
    const agentInfo = mesh.getAgentInfo();
    const { contexts: recent } = (await mesh.query({ limit: 5 })).data;
    await mesh.publish({
        type: 'system',
        content: JSON.stringify({
            event: 'heartbeat',
            agent: agentInfo.name,
            status: agentInfo.status,
            recentActivity: recent.length,
        }),
        tags: ['heartbeat', 'system'],
        importance: 1,
        ttlSeconds: 300, // 5 min TTL
    });
    lines.push(`[mesh-cron] Heartbeat published at ${new Date().toISOString()}`);
    // 2. Check for pending delegation tasks
    // (In a full implementation, this would poll a delegation queue)
    // 3. Summarize activity
    const digest = await mesh.summarizeActivity(1);
    lines.push(digest);
    return lines.join('\n');
}
//# sourceMappingURL=index.js.map