# Providers

Decision Core supports multiple provider modes for model-assisted routing. The provider mode determines how (and whether) LLM calls are made during trust routing resolution.

## Provider Modes

### 1. `host` (Default)

The host application provides the model gateway. Decision Core delegates all LLM calls to the adapter supplied by the integrating system.

```typescript
import { quickStart } from '@decision-core/core';

const dc = await quickStart({
  providerMode: 'host',
  // Host application supplies modelGateway via adapter injection
});
```

**When to use:** Embedded in an agent framework (Hermes, OpenCLAW) that already manages model connections.

**Credential flow:** None — the host owns credential management entirely.

### 2. `disabled`

No model calls are made. All routing falls back to deterministic evaluation or safe_block.

```typescript
const dc = await quickStart({
  providerMode: 'disabled',
});
```

**When to use:** Deterministic-only deployments, testing, CI pipelines, or environments without LLM access.

**Credential flow:** None required.

### 3. `direct`

Decision Core calls the model provider API directly using configured credentials.

```typescript
const dc = await quickStart({
  providerMode: 'direct',
  // Credentials read from environment
});
```

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `DECISION_CORE_MODEL_PROVIDER` | Provider name (e.g., `anthropic`, `openai`) |
| `DECISION_CORE_MODEL_API_KEY` | API key for the provider |
| `DECISION_CORE_MODEL_ID` | Model identifier (e.g., `claude-sonnet-4-20250514`) |
| `DECISION_CORE_MODEL_BASE_URL` | Optional base URL override |

**When to use:** Standalone deployments where Decision Core manages its own model access.

**Credential flow:** API key read from environment → validated at startup → passed in request headers.

### 4. `local`

Routes model calls to a locally-running inference server (e.g., Ollama, llama.cpp, vLLM).

```typescript
const dc = await quickStart({
  providerMode: 'local',
});
```

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `DECISION_CORE_LOCAL_MODEL_URL` | Local server URL (default: `http://localhost:11434`) |
| `DECISION_CORE_LOCAL_MODEL_ID` | Model name on the local server |

**When to use:** Air-gapped environments, development, or privacy-sensitive deployments.

**Credential flow:** No external credentials. Local server must be running and accessible.

### 5. `router`

Multi-provider routing with fallback. Attempts providers in priority order; falls back on failure.

```typescript
const dc = await quickStart({
  providerMode: 'router',
});
```

**Configuration (JSON):**

```json
{
  "providers": [
    { "name": "anthropic", "priority": 1, "model": "claude-sonnet-4-20250514" },
    { "name": "openai", "priority": 2, "model": "gpt-4o" }
  ],
  "fallbackStrategy": "next_provider",
  "maxRetries": 2,
  "timeoutMs": 30000
}
```

**When to use:** Production deployments requiring high availability across multiple providers.

**Credential flow:** Each provider's credentials configured independently via environment variables with provider-name prefix (e.g., `DECISION_CORE_ANTHROPIC_API_KEY`, `DECISION_CORE_OPENAI_API_KEY`).

## Capability Profiles

Each provider mode exposes different capabilities:

| Capability | host | disabled | direct | local | router |
|-----------|------|----------|--------|-------|--------|
| Deterministic routing | yes | yes | yes | yes | yes |
| Model-assisted routing | yes | no | yes | yes | yes |
| Tribunal patterns | yes | no | yes | yes | yes |
| Streaming | depends | no | yes | depends | yes |
| Token counting | depends | no | yes | depends | yes |
| Cost tracking | no | no | yes | no | yes |

## Provider Conformance

Decision Core validates that providers meet safety requirements:

- **Response format:** Must return structured `ModelResponse` with `text`, `model`, `confidence`, `latency`.
- **Timeout handling:** Providers must respect configured timeout or Decision Core enforces it.
- **Error signaling:** Provider errors trigger fallback strategy (safe_block by default).
- **No secret logging:** Provider adapters must not log API keys or bearer tokens.

## Provider Doctor

The CLI includes a diagnostic command to verify provider configuration:

```bash
decision-core providers doctor
```

**Output:**

```
Provider Mode: direct
  ✓ API key configured (DECISION_CORE_MODEL_API_KEY)
  ✓ Model ID set: claude-sonnet-4-20250514
  ✓ Connection test: 200 OK (142ms)
  ✓ Response format valid

Trust Suite:
  ✓ 3 surfaces bound to model-assisted patterns
  ✓ Fallback strategy: safe_block

Warnings:
  ⚠ No cost limit configured (DECISION_CORE_MAX_COST_PER_DECISION)
```

The doctor checks:
1. Credential presence and format
2. Network connectivity to provider endpoint
3. Response format conformance
4. Trust suite compatibility with provider capabilities
5. Cost and rate limit configuration

## Configuration Reference

All provider configuration uses environment variables prefixed with `DECISION_CORE_`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DECISION_CORE_PROVIDER_MODE` | `host` | Provider mode selection |
| `DECISION_CORE_MODEL_PROVIDER` | — | Provider name for direct mode |
| `DECISION_CORE_MODEL_API_KEY` | — | API key for direct mode |
| `DECISION_CORE_MODEL_ID` | — | Model identifier |
| `DECISION_CORE_MODEL_BASE_URL` | — | Base URL override |
| `DECISION_CORE_LOCAL_MODEL_URL` | `http://localhost:11434` | Local inference URL |
| `DECISION_CORE_LOCAL_MODEL_ID` | — | Local model name |
| `DECISION_CORE_MODEL_TIMEOUT_MS` | `30000` | Request timeout |
| `DECISION_CORE_MAX_COST_PER_DECISION` | — | Optional cost cap |

## Safe Degradation

When a provider is unavailable:

1. **Deterministic routes** continue to function (no model needed).
2. **Model-assisted routes** check fallback strategy:
   - `safe_block`: Return safe_block verdict (default, fail-closed).
   - `downgrade_pattern`: Fall back to simpler pattern (e.g., tribunal → single_model).
   - `accept_primary`: Accept the primary model's partial result if available.
3. **Evidence chain** records the provider failure with operation type `route_decision`.
4. **Decision log** captures the safe_block with explanation.

This ensures Decision Core never silently allows an action when model evaluation was required but unavailable.

## Related Documentation

- [Architecture](./ARCHITECTURE.md) — System design overview
- [Trust Routing Guide](./TRUST-ROUTING-GUIDE.md) — How provider modes affect routing
- [Security](./SECURITY.md) — Credential isolation details
- [Integration Guides](./INTEGRATION-GUIDES/) — Provider setup per integration
