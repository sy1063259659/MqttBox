# Agent Harness Parser Authoring Status

## Summary

MqttBox already includes an experimental agent harness + parser authoring loop, but it is still a **Phase 0/1 foundation**, not the fully frozen contract described in `.omx/plans/prd-agent-harness-parser-ui.md`.

This document captures:

- what exists today
- what is still incomplete
- how to verify the current slice

## What Exists Today

### Frontend

- `AgentPanel` supports:
  - chat / execute mode switching
  - image attachment selection
  - pending approval actions
  - artifact cards with “Open in parser library”
- `ParserLibrary` can:
  - accept an injected parser draft
  - edit the generated script
  - run a test payload
  - save or delete the parser
- `agent-store` already consumes:
  - session events
  - plan step events
  - approval events
  - artifact events

### Backend

- `agent-service` exposes:
  - `GET /health`
  - `GET /config`
  - `POST /config`
  - `POST /sessions`
  - `POST /sessions/:id/messages`
  - `POST /sessions/:id/messages/stream`
  - `POST /sessions/:id/approvals/:requestId`
- Execute mode currently resolves to the `parser-authoring` capability.
- The harness can:
  - emit session / plan / approval / artifact / assistant events
  - create a parser draft artifact
  - gate draft creation behind approval in confirm mode
  - persist artifacts and memories to the `agent-service/data/` directory

## Review Findings Against The Current PRD/Test Spec

The current implementation is useful, but it does **not** yet meet the full contract freeze described in the PRD.

### 1. Run lifecycle contract is still incomplete

Current state:

- `RunStatus` exists in `packages/agent-contracts`
- frontend state is still mostly inferred from:
  - `plan.ready`
  - `plan.step.*`
  - `approval.*`
  - `assistant.final`

Gap:

- `run.started`
- `run.status`
- `run.completed`

are not yet part of the contract, so the UI still reconstructs run state indirectly.

### 2. Artifact handoff payload is still the old flat shape

Current parser artifacts still expose a flat payload like:

- `name`
- `script`
- `notes`
- `suggestedTopicFilter`
- `sourceSampleSummary`

Gap:

The PRD expects a split payload:

- `editorPayload`
- `reviewPayload`

The current UI works, but it is not yet aligned with the frozen handoff contract.

### 3. Attachment limits/config exposure are not frozen yet

Current state:

- frontend accepts `image/*`
- backend accepts attachment DTOs as-is
- `GET /config` currently reports transport/runtime/model information only

Gap:

The following fields are still missing from the shared contract/config surface:

- `supportsImageInput`
- `supportsParserAuthoring`
- `supportsApproval`
- `maxAttachmentCount`
- `maxAttachmentBytes`
- `acceptedImageMimeTypes`

### 4. Harness still owns parser-specific behavior directly

`agent-service/src/harness/agent-harness.ts` still contains parser-specific helpers for:

- plan construction
- artifact construction
- execute prompt construction
- approval request construction

This means the minimal capability boundary from Phase 1 is not fully cut yet.

### 5. Approval restart semantics are only partially defined

Current state:

- pending approvals are stored in memory only
- after a restart, prior requests disappear

Gap:

The PRD expects a stable expired-approval semantic that the frontend can map to “approval expired, please retry”.
Right now the runtime behavior is closer to “request not found” than a frozen machine-readable expiration contract.

### 6. Frontend verification is still thinner than the target matrix

Current repository state does not yet include the recommended tests for:

- `src/stores/agent-store.test.ts`
- `src/components/features/agent-panel.test.tsx`
- `src/components/features/parser-library.test.tsx`

So the parser authoring UI loop exists, but the reducer/component evidence is not yet complete.

## Current Developer Verification

### Frontend

```bash
npm test -- --run
npm run build
```

### Agent service

```bash
cd agent-service
npm run typecheck
npm test
npm run build
```

## Current Verification Notes

- Frontend build is passing.
- The memory persistence test now resolves the same `agent-service/data/` path as production code, so repo-level Vitest runs no longer fail because of a mismatched test fixture path.
- There is still no dedicated frontend parser-authoring reducer/component test suite in this branch.

## Recommended Next Steps

1. Freeze the `run.*` contract before adding more UI state derivation.
2. Move parser-specific helpers out of `AgentHarness` into a parser-authoring boundary.
3. Upgrade artifact payloads to `editorPayload + reviewPayload`.
4. Expose attachment capabilities/limits through `GET /config` and validate them on both client and server.
5. Add the missing frontend reducer/component tests before expanding the feature surface again.
