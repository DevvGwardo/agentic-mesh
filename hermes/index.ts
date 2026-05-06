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
import { runMeshTool } from '../src/tool.js';
import type { AgentCapabilities, AgentRuntime } from '../src/types.js';

// ─── Hermes profile plugin ────────────────────────────────────────────────────

export interface HermesMeshConfig {
  meshId: string;
  meshDir?: string;
  hubUrl?: string;
  agentName?: string;
  agentId?: string;
  agentVersion?: string;
}

export function createHermesMeshPlugin(config: HermesMeshConfig) {
  return {
    name: 'agentic-mesh',
    version: '0.1.0',

    async onInit(hermes: {
      getAgentId: () => string;
      getAgentName: () => string;
      getVersion: () => string;
    }): Promise<{ mesh: Mesh; toolHandler: (args: Record<string, unknown>) => Promise<string> }> {
      const mesh = await Mesh.create({
        meshId: config.meshId,
        meshDir: config.meshDir ?? `${process.env.HERMES_HOME ?? '~/.hermes'}/mesh`,
        hubUrl: config.hubUrl,
        agentInfo: {
          id: config.agentId ?? hermes.getAgentId(),
          name: config.agentName ?? hermes.getAgentName(),
          runtime: 'hermes' as AgentRuntime,
          version: config.agentVersion ?? hermes.getVersion(),
          capabilities: {
            canReadContext: true,
            canWriteContext: true,
            canOrchestrate: true,
            canDelegate: true,
            maxContextBytes: 100_000,
          } as AgentCapabilities,
        },
      });

      const toolHandler = (args: Record<string, unknown>) => runMeshTool(mesh, args);
      return { mesh, toolHandler };
    },
  };
}

// ─── MeshCron skill (for Hermes cron jobs) ────────────────────────────────────

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
export async function runMeshCron(mesh: Mesh): Promise<string> {
  const lines: string[] = [];

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
