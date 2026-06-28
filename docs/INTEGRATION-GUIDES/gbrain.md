# G-Brain Adapter Guide

This guide covers integrating Decision Core with G-Brain. Decision Core uses
G-Brain in two ways:

- as a context source for retrieval before or during policy evaluation
- as an evidence sink for storing decision and execution records

Decision Core does not talk to G-Brain through ad hoc helper methods. The
current integration model is:

```text
Decision Core
  -> GBrainTransport
  -> GBrainClient
  -> GBrainContextAdapter / GBrainStoreAdapter / GBrainDecisionEvidenceSink
  -> G-Brain
```

## Install

```bash
npm install @blockbrainlabs/decision-core
```

## Transport Layer

Decision Core talks to G-Brain through a `GBrainTransport`. Two transports are
available.

### HTTP transport

The HTTP transport is the recommended path when G-Brain HTTP is running. It uses
MCP-over-HTTP plus OAuth 2.1 client credentials.

```typescript
import { GBrainClient, GBrainHttpTransport } from '@blockbrainlabs/decision-core';

const transport = new GBrainHttpTransport({
  baseUrl: 'http://127.0.0.1:3131',
  clientId: process.env.DECISION_CORE_GBRAIN_CLIENT_ID!,
  clientSecret: process.env.DECISION_CORE_GBRAIN_CLIENT_SECRET!,
  scopes: 'read write',
  timeoutMs: 10_000,
});

const client = new GBrainClient({ transport });
```

The HTTP transport:

- exchanges `client_credentials` at `POST /token`
- caches and refreshes the access token
- sends MCP tool calls to `POST /mcp`
- supports both JSON and SSE responses

#### Register an OAuth client

Before using the HTTP transport, register a client with G-Brain.

```bash
# Stop G-Brain HTTP first — PGLite allows only one process to hold the DB lock.
sudo systemctl stop gbrain

sudo -iu gbrain env PATH=/srv/gbrain/.bun/bin:$PATH \
  gbrain auth register-client \
  --name "decision-core-evidence" \
  --scope "read write"

sudo systemctl start gbrain
```

Save the resulting `client_id` and `client_secret`. Decision Core uses those in
its evidence-sink configuration.

### Production Notes For PGLite-Backed G-Brain

The verified Decision Core pilot used G-Brain over HTTP with a PGLite-backed
store. The operational lessons were:

- prefer the HTTP transport whenever G-Brain HTTP is running against the live
  PGLite store
- treat the CLI transport as a fallback for offline or non-HTTP cases only
- pin Bun conservatively; the verified deployment used Bun `1.2.15` after a
  `1.3.x` regression caused PGLite/WASM shutdown and recovery problems
- give the service time to stop cleanly on reboot, otherwise stale PID files or
  mid-write shutdowns can leave the store in a bad state

For systemd-managed deployments, add a graceful shutdown drop-in similar to:

```ini
[Service]
TimeoutStopSec=15
KillSignal=SIGTERM
KillMode=mixed
ExecStartPre=/bin/bash -c "rm -f /srv/gbrain/.gbrain/brain.pglite/postmaster.pid"
```

If your install is repo-local rather than globally linked, the service may start
G-Brain with an explicit Bun entrypoint such as:

```ini
ExecStart=/srv/gbrain/.bun/bin/bun run /srv/gbrain/gbrain/src/cli.ts -- serve --http --port 3131
```

That is equivalent to using the `gbrain` wrapper as long as the binary path is
explicit and the service environment includes Bun on `PATH`.

### CLI transport

The CLI transport shells out to the `gbrain` CLI for each operation.

```typescript
import { GBrainCliTransport, GBrainClient } from '@blockbrainlabs/decision-core';

const transport = new GBrainCliTransport({
  binPath: '/srv/gbrain/.bun/bin/gbrain',
  cwd: '/srv/gbrain/brain',
});

const client = new GBrainClient({ transport });
```

CLI transport is a legacy fallback. Do not use it while G-Brain HTTP is running
against the same PGLite-backed store. The HTTP server holds the single-process
lock and CLI calls will hang or time out.

## Transport Selection In `decision-core serve`

When `decision-core serve` is configured with the G-Brain evidence sink, it
selects the transport from environment variables:

| Variables present | Transport |
| --- | --- |
| `DECISION_CORE_GBRAIN_URL` + `DECISION_CORE_GBRAIN_CLIENT_ID` + `DECISION_CORE_GBRAIN_CLIENT_SECRET` | HTTP |
| `DECISION_CORE_GBRAIN_BIN` without the HTTP set above | CLI |

HTTP takes priority. Optional CLI-only support values:

| Variable | Description |
| --- | --- |
| `DECISION_CORE_GBRAIN_BIN` | Path to the `gbrain` CLI |
| `DECISION_CORE_GBRAIN_CWD` | Optional working directory for CLI calls |

## Evidence Sink

Decision Core can write policy-evaluation and post-tool-execution evidence into
G-Brain as pages under the `decisions/` namespace.

### Configuration

For the Decision Core server:

| Variable | Required | Description |
| --- | --- | --- |
| `DECISION_CORE_EVIDENCE_SINK` | Yes | Set to `gbrain` |
| `DECISION_CORE_GBRAIN_URL` | Yes for HTTP | G-Brain HTTP endpoint |
| `DECISION_CORE_GBRAIN_CLIENT_ID` | Yes for HTTP | OAuth client id |
| `DECISION_CORE_GBRAIN_CLIENT_SECRET` | Yes for HTTP | OAuth client secret |
| `DECISION_CORE_GBRAIN_BIN` | Yes for CLI | CLI path if using CLI transport |
| `DECISION_CORE_GBRAIN_CWD` | No | CLI working directory |

### Behavior

- `/evaluate` records evidence in fire-and-forget mode. The verdict response is
  returned without waiting for the write to finish.
- `/record-execution` records post-tool execution evidence after a tool call.
- Evidence sink failures are logged and do not weaken policy verdicts.
- Written pages use slugs like `decisions/{tenantId}/{surfaceId}/{decisionId}`.

## Programmatic Usage

### Create A Client And Adapters

```typescript
import {
  GBrainClient,
  GBrainContextAdapter,
  GBrainHttpTransport,
  GBrainStoreAdapter,
} from '@blockbrainlabs/decision-core';

const transport = new GBrainHttpTransport({
  baseUrl: 'http://127.0.0.1:3131',
  clientId: process.env.DECISION_CORE_GBRAIN_CLIENT_ID!,
  clientSecret: process.env.DECISION_CORE_GBRAIN_CLIENT_SECRET!,
});

const client = new GBrainClient({ transport });
const contextAdapter = new GBrainContextAdapter({ client, maxResults: 5 });
const storeAdapter = new GBrainStoreAdapter({ client });
```

### Retrieve Context

`GBrainContextAdapter` searches prior decision pages under
`decisions/{tenantId}/`.

```typescript
const context = await contextAdapter.getContext(
  'my-org',
  'hermes',
  'finance.read_ledger',
);

for (const page of context.pages) {
  console.log(page.slug, page.title);
}
```

You can also query directly with `client.search()`:

```typescript
const pages = await client.search({
  query: 'finance.read_ledger allow',
  slugPrefix: 'decisions/my-org/',
  limit: 10,
});
```

### Store A Decision

Use `GBrainStoreAdapter` for structured writes:

```typescript
const stored = await storeAdapter.storeDecision(
  'my-org',
  'hermes',
  'corr-123',
  {
    surface: 'hermes',
    toolName: 'finance.read_ledger',
    status: 'allowed',
    agentId: 'finance-agent',
  },
  {
    correlationId: 'corr-123',
    matchedPolicies: ['finance-read-rule'],
  },
  ['finance-agent', 'finance.read_ledger', 'hermes'],
);

console.log(stored.slug);
```

### Read Back A Page

```typescript
const page = await client.getPage('decisions/my-org/hermes/corr-123');
```

## Slug Rules

Decision Core write paths are intentionally narrow:

- all writes are validated against the hard-coded `decisions/` prefix
- the `slugPrefix` option on `GBrainClient` affects search defaults, not the
  write namespace
- environment separation should use tenant, surface, and decision ids inside
  the `decisions/` tree

This means examples such as `dc-prod/...` or `decision-core/...` are not valid
write slugs for the current adapter implementation.

## Strategic Context

`GBrainContextAdapter` also exposes `getStrategicContext(tenantId)`, which
searches the `strategy/` namespace for OKRs and planning material:

```typescript
const strategy = await contextAdapter.getStrategicContext('my-org');
```

That is a read-only search path. It does not change the write-side `decisions/`
namespace restriction.

## Related Documentation

- [Hermes Integration](./hermes.md) — HTTP bridge and plugin behavior
- [HTTP Integration](./http.md) — Decision Core HTTP surface
- [Evidence Chain Guide](../EVIDENCE-CHAIN-GUIDE.md) — evidence model
- [Security](../SECURITY.md) — transport and credential handling
