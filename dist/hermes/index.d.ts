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
        toolHandler: (args: Record<string, unknown>) => Promise<string>;
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