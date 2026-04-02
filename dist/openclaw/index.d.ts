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
export declare const CLAW_MESH_TOOL: ClawMeshToolDefinition;
export declare function createClawMeshRunner(mesh: Mesh): (args: Record<string, unknown>) => Promise<string>;
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
        runTool: ReturnType<typeof createClawMeshRunner>;
    }>;
}
export declare function createOpenClawMeshPlugin(config: ClawMeshConfig): OpenClawPlugin;
//# sourceMappingURL=index.d.ts.map