# PPL LLM Host Adapter 0.1.6 — Stable

A provider-neutral Stable Host between **PPL Profiles 0.2 Stable** and real LLMs. Version 0.1.6 incorporates the application-stage recovery, Independent-Judge contract, Host-owned response validation, and productized recoverable tool-mediated Agent lifecycle validated through RC10.

It turns a Profile state/policy into a model request, treats model output as an untrusted candidate, applies observer/judge/delivery gates, and only then allows deterministic Profile mutation.

## Core boundary

```text
PPL Profiles 0.2 Stable
        ↓ state/policy
PPL LLM Host Adapter
        ↓ candidate request
Agent LLM
        ↓ untrusted draft
Delivery Gate / Restricted Judges
        ↓ deliver only
Profile deterministic mutation
```

The Agent cannot directly patch mastery, evidence ledgers, conclusion state, or other durable Profile state.

## Install from this source kit

```bash
npm install --offline
npm test
```

The Profiles 0.2 Stable npm tarballs required for offline install are shipped under `vendor/npm/`.

## Reuse

```js
import {
  createCallbackTransport,
  createPplLlmHostAdapter,
} from './src/main.mjs'

const agentTransport = createCallbackTransport({
  identity: { provider: 'my-provider', model: 'agent-model', independenceGroup: 'agent-A' },
  invoke: async (request, context) => {
    // Call your real LLM here and return the structured PPL response.
  },
})

const judgeTransport = createCallbackTransport({
  identity: { provider: 'other-provider', model: 'judge-model', independenceGroup: 'judge-B' },
  invoke: async (request, context) => {
    // Restricted Judge invocation.
  },
})

const host = createPplLlmHostAdapter({
  agentTransport,
  judgeTransport,
  independenceMode: 'required',
})
```

## Stable surface

- callback transport;
- retry / timeout / abort;
- stream collection without partial durable mutation;
- Profile Session single writer;
- tool allowlist + schema + provenance + idempotency;
- Agent / Observer / Evidence Judge / Policy Judge authority separation;
- delivery-before-mutation transaction;
- required/preferred/disabled Agent-Judge independence policy.

## OpenAI Responses provider

`src/providers/openai-responses.mjs` is included as a provider Preview. It is protocol-tested locally but has not received a live API smoke test in this environment because no API key is available. See `docs/OPENAI_RESPONSES_PROVIDER.md`.

## Existing stable dependencies

This project does not modify:

- PPL Core 0.3.0 Stable/Frozen;
- PPL Runtime 0.1.0 Stable/Frozen;
- PPL Profiles 0.2.0 Stable;
- PPL APP Observatory 0.4.0 Stable.

## Portable npm bundle

The Source Kit uses local `file:vendor/npm/*.tgz` dependencies so it can be installed offline without a private registry.

For a single distributable npm tarball, run:

```bash
node scripts/build-bundled-npm.mjs ./dist
```

The build stage rewrites the four Profile dependencies to `0.2.0` and bundles them into the npm tarball. The released bundled tarball is isolated-install tested.

## Recoverable tool-mediated Agent turns (0.1.6 Stable)
Use `PplLlmHostAdapter.runRecoverableToolMediatedAgentTurn(...)`, or the standalone `runRecoverableToolMediatedAgentTurn(lifecycle, ...)` helper exported from `./recoverable-lifecycle`, with a durable turn store and Provider continuation builder to productize tool proposal, exactly-once execution, continuation, independent Judge, delivery, and commit. The lifecycle is exported from `./recoverable-lifecycle`; promotion evidence and the RC10 live certificate are shipped with the Stable promotion bundle, not required at runtime.
