/**
 * agentic-mesh — Cross-agent collaboration for Hermes and OpenClaw
 *
 * Usage:
 *   import { Mesh } from 'agentic-mesh';
 *
 *   const mesh = await Mesh.create({
 *     meshId: 'clawborators',
 *     agentInfo: { id: 'hermes-main', name: 'Hermes', runtime: 'hermes', version: '1.x', capabilities: {...} },
 *     meshDir: '~/.hermes/mesh',      // file-based (same machine)
 *     hubUrl: 'ws://localhost:8765', // optional Hub (cross-machine)
 *   });
 *
 *   // Publish a finding
 *   await mesh.publish({ type: 'finding', content: '...', tags: ['research'] });
 *
 *   // Query what's happening
 *   const { contexts } = await mesh.query({ type: 'task', limit: 10 });
 *
 *   // Get a digest for your system prompt
 *   const meshContext = await mesh.buildMeshContext();
 */
export * from './types.js';
export { Mesh, type MeshConfig } from './mesh.js';
export { MeshStorage } from './storage.js';
export { MeshHub, type HubConfig } from './hub.js';
//# sourceMappingURL=index.d.ts.map