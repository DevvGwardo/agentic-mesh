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
export declare const MESH_TOOL_SCHEMA: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            operation: {
                type: string;
                enum: string[];
                description: string;
            };
            content: {
                type: string;
                description: string;
            };
            type: {
                type: string;
                enum: string[];
                description: string;
            };
            tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            importance: {
                type: string;
                minimum: number;
                maximum: number;
                description: string;
            };
            ttl_seconds: {
                type: string;
                description: string;
            };
            id: {
                type: string;
                description: string;
            };
            filter_type: {
                type: string;
                description: string;
            };
            filter_agent: {
                type: string;
                description: string;
            };
            filter_tags: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            filter_search: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            instruction: {
                type: string;
                description: string;
            };
            target_runtime: {
                type: string;
                enum: string[];
                description: string;
            };
            patch_content: {
                type: string;
                description: string;
            };
            patch_ttl_seconds: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function buildMeshToolHandler(mesh: Mesh): (args: Record<string, unknown>) => Promise<string>;
export interface HermesMeshConfig {
    meshId: string;
    meshDir?: string;
    hubUrl?: string;
    agentName?: string;
    agentId?: string;
    agentVersion?: string;
}
export declare function createHermesMeshPlugin(config: HermesMeshConfig): {
    name: string;
    version: string;
    onInit(hermes: {
        getAgentId: () => string;
        getAgentName: () => string;
        getVersion: () => string;
    }): Promise<{
        mesh: Mesh;
        toolHandler: ReturnType<typeof buildMeshToolHandler>;
    }>;
};
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
export declare function runMeshCron(mesh: Mesh): Promise<string>;
//# sourceMappingURL=index.d.ts.map