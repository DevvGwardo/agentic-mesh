# agentic-mesh

> Cross-agent collaboration framework for **Hermes** and **OpenClaw** — shared context, peer discovery, task delegation, and structured orchestration.

[![MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

---

## What it does

`agentic-mesh` lets any number of Hermes and OpenClaw agents running on the same machine (or connected via a Hub):

1. **Publish** findings, tasks, code snippets, notes, and logs to a shared context store
2. **Query** what other agents have found or done
3. **Delegate** tasks to specific agent runtimes (e.g. "run this code search on OpenClaw")
4. **Orchestrate** multi-agent workflows with a structured coordinator pattern
5. **Discover** peer agents automatically and see their status

Agents don't need to be on the same machine — a **Hub** WebSocket service bridges them.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     agentic-mesh                           │
├──────────────┬─────────────────────┬───────────────────────┤
│   types.ts   │      storage.ts     │        mesh.ts        │
│  Interfaces  │  File-based storage  │  Core engine + Hub    │
│  + LLM I/F  │  (peer-to-peer mode) │  client               │
├──────────────┴─────────────────────┴───────────────────────┤
│                        hub.ts                              │
│           Optional WebSocket central coordinator           │
├──────────────────────────┬─────────────────────────────────┤
│    hermes/index.ts      │       openclaw/index.ts          │
│   MeshTool + MeshCron   │     ClawMeshTool + plugin        │
└──────────────────────────┴─────────────────────────────────┘
```

**Two operating modes:**

| Mode | How | Best for |
|------|-----|----------|
| **DIRECT** | Shared filesystem (`meshDir`) | Multiple agents on the same machine |
| **HUB** | WebSocket connection to `MeshHub` | Agents on different machines |

Both modes can be active simultaneously — the Hub is optional.

---

## Primitives

| Primitive | File | What it does |
|-----------|------|--------------|
| `Mesh` | `src/mesh.ts` | Core engine — publish, query, delegate, ping |
| `MeshStorage` | `src/storage.ts` | File-based context + agent registry |
| `MeshHub` | `src/hub.ts` | Optional WebSocket relay for cross-machine agents |
| `HermesMesh` | `hermes/index.ts` | Tool + cron integration for Hermes |
| `ClawMesh` | `openclaw/index.ts` | Tool plugin for OpenClaw |

---

## Installation

```bash
npm install agentic-mesh
```

For development:
```bash
git clone https://github.com/your-org/agentic-mesh.git
cd agentic-mesh
npm install
npm run build
```

---

## Quick Start

### 1. Start the Hub (optional — for cross-machine agents)

```bash
PORT=8765 MESH_DIR=./mesh-store npx ts-node/esm src/hub.ts
```

Or with Node (after `npm run build`):
```bash
PORT=8765 MESH_DIR=./mesh-store node dist/hub.js
```

### 2. Initialize mesh in your agent

**Hermes** (in your profile init script):
```typescript
import { Mesh } from 'agentic-mesh';

const mesh = await Mesh.create({
  meshId: 'clawborators',
  meshDir: '~/.hermes/mesh',       // DIRECT mode
  // hubUrl: 'ws://localhost:8765', // HUB mode
  agentInfo: {
    id: 'hermes-main',
    name: 'Hermes',
    runtime: 'hermes',
    version: '1.x.x',
    capabilities: {
      canReadContext: true,
      canWriteContext: true,
      canOrchestrate: true,
      canDelegate: true,
      maxContextBytes: 100_000,
    },
  },
});

// Publish a finding
await mesh.publish({
  type: 'finding',
  content: 'The OAuth flow has a race condition in the token refresh',
  tags: ['bug', 'auth', 'oauth'],
  importance: 3,
});

// Query what's happening
const { contexts } = await mesh.query({ tags: ['bug'], limit: 10 });

// Add mesh context to your system prompt
const meshContext = await mesh.buildMeshContext();
```

**OpenClaw** (as a tool plugin):
```yaml
# ~/.openclaw/config.yaml
plugins:
  agentic-mesh:
    meshId: clawborators
    meshDir: ~/.openclaw/mesh
    hubUrl: ws://localhost:8765
```

Then call the `mesh` tool:
```yaml
tool: mesh
args:
  operation: publish
  type: finding
  content: "Found a memory leak in the session manager..."
  tags: [memory, leak]
  importance: 3
```

### 3. Run the Hub CLI

```bash
# Start the hub
node dist/hub.js

# With custom port and storage dir
PORT=9000 MESH_DIR=/data/mesh node dist/hub.js
```

---

## Mesh Tool Operations

The `mesh` tool supports these operations:

### `publish` — Share context with the mesh

```typescript
await mesh.publish({
  type: 'finding',       // task | finding | code | log | note | plan | result | message | system
  content: '...',
  tags: ['research'],
  importance: 2,          // 1=low, 2=medium, 3=high
  ttlSeconds: 3600,       // auto-expire after 1h (0=forever)
  parentId: '...',        // optional thread/reply chain
});
```

### `query` — Search shared context

```typescript
const { contexts, total, hasMore } = await mesh.query({
  type: 'finding',
  agentName: 'OpenClaw Evo',
  tags: ['bug', 'research'],
  search: 'race condition',
  limit: 20,
});
```

### `read` — Get a specific context by ID

```typescript
const result = await mesh.op({ op: 'read', id: 'abc-123' });
```

### `update` — Edit a context

```typescript
await mesh.op({
  op: 'update',
  id: 'abc-123',
  patch: { content: 'updated content', ttlSeconds: 7200 },
});
```

### `delete` — Remove a context

```typescript
await mesh.op({ op: 'delete', id: 'abc-123' });
```

### `agents` — List active peers

```typescript
const { agents } = await mesh.listPeers();
// → [{ id, name, runtime, status, capabilities, ... }, ...]
```

### `delegate` — Assign a task to another agent

```typescript
const { taskId, assignedTo } = await mesh.delegate(
  'Search the codebase for memory leaks in session manager',
  2  // priority
);
```

### `ping` — Check mesh connectivity and stats

```typescript
const { stats, connected } = await mesh.op({ op: 'ping' });
```

### `summarize` — Get a human-readable digest of recent activity

```typescript
const digest = await mesh.summarizeActivity(4);  // last 4 hours
```

### `context` — Get mesh data formatted for a system prompt

```typescript
const ctx = await mesh.buildMeshContext();
// Returns a formatted string to prepend to your system prompt
```

---

## Context Types

| Type | When to use |
|------|-------------|
| `task` | A goal or work item |
| `finding` | Research result, discovered fact |
| `code` | Code snippet or artifact |
| `log` | Structured event or log entry |
| `note` | Free-form note |
| `plan` | Multi-step plan |
| `result` | Final output or deliverable |
| `message` | Direct message to another agent |
| `system` | Heartbeat, status update |

---

## Hermes Integration

### MeshTool (tool)

The `mesh` tool is available to the Hermes agent. The agent can call it like any other tool:

```
tool: mesh
args:
  operation: query
  filter_type: finding
  filter_search: race condition
  limit: 5
```

### MeshCron (cron job)

Schedule a periodic mesh pulse:

```bash
/cron add "mesh-pulse" --every 15m --skill mesh_cron
```

MeshCron:
1. Publishes a heartbeat to the mesh
2. Queries recent activity
3. Returns a digest that can be delivered to the user

---

## OpenClaw Integration

Register the plugin in your OpenClaw config:

```yaml
# ~/.openclaw/config.yaml
plugins:
  agentic-mesh:
    meshId: clawborators
    meshDir: ~/.openclaw/mesh
    hubUrl: ws://localhost:8765  # optional
```

The `mesh` tool is now available alongside OpenClaw's native tools.

---

## Hub API

The Hub speaks a simple JSON protocol over WebSocket.

### Inbound messages (agent → hub)

| Message type | Payload |
|-------------|---------|
| `hub:join` | `{ meshId, info: AgentInfo }` |
| `hub:leave` | `{ meshId }` |
| `hub:context:new` | `{ context: MeshContext }` |
| `hub:context:del` | `{ id }` |
| `mesh:op` | `MeshOp` |
| `agent:status` | `{ status }` |

### Outbound messages (hub → agent)

| Message type | Payload |
|-------------|---------|
| `hub:ping` | `{ agents: AgentInfo[] }` |
| `hub:context:new` | `{ context: MeshContext }` |
| `hub:context:del` | `{ id }` |
| `hub:delegate` | `DelegationTask` |
| `hub:delegate:result` | `{ taskId, result }` |
| `mesh:result` | `MeshResult` |
| `error` | `{ message }` |

---

## Storage Format

```
{meshDir}/
  agents.json           — registered agents (JSON array)
  contexts/
    {uuid}.json         — individual context documents
  delegation/
    {uuid}.json          — pending delegation tasks
```

Each context file:
```json
{
  "id": "abc-123",
  "meshId": "clawborators",
  "agentId": "hermes-main",
  "agentName": "Hermes",
  "runtime": "hermes",
  "type": "finding",
  "content": "...",
  "tags": ["bug"],
  "importance": 3,
  "ttlSeconds": 0,
  "createdAt": 1743612000000,
  "updatedAt": 1743612000000,
  "expiresAt": null
}
```

---

## Comparison with agentic-primitives

| Feature | agentic-primitives | agentic-mesh |
|---------|-------------------|--------------|
| Focus | Single-agent patterns | **Multi-agent collaboration** |
| Storage | Ephemeral | Persistent filesystem |
| Cross-agent context | No | **Yes** |
| Task delegation | Via Coordinator (LLM only) | **Direct to peer agents** |
| Peer discovery | No | **Yes** |
| Hub for cross-machine | No | **Yes (optional)** |
| Hermes support | Via cron only | **Tool + cron** |
| OpenClaw support | Indirect | **Native tool plugin** |

agentic-mesh and agentic-primitives are complementary — use `coordinator` from agentic-primitives for structured orchestration within a mesh context.

---

## License

MIT
