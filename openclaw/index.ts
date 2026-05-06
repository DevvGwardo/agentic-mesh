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
import { MESH_TOOL_SCHEMA, runMeshTool } from '../src/tool.js';
import type { AgentCapabilities, AgentRuntime } from '../src/types.js';

// ─── OpenClaw tool definition ─────────────────────────────────────────────────

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

// Re-export the shared schema under the OpenClaw adapter's naming convention
export const CLAW_MESH_TOOL: ClawMeshToolDefinition = MESH_TOOL_SCHEMA;

// ─── OpenClaw plugin bootstrap ────────────────────────────────────────────────

export interface OpenClawPlugin {
  name: string;
  version: string;
  tools: ClawMeshToolDefinition[];
  onInit: (ctx: {
    agentId: string;
    agentName: string;
    version: string;
  }) => Promise<{
    mesh: Mesh;
    runTool: (args: Record<string, unknown>) => Promise<string>;
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

      const runTool = (args: Record<string, unknown>) => runMeshTool(mesh, args);
      return { mesh, runTool };
    },
  };
}
