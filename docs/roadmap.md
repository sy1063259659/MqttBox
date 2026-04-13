# MqttBox Roadmap

## Summary

MqttBox is currently at the point where the core desktop workflow exists:

- connection management
- topic subscription
- publish and receive messages
- message history and export
- settings and language/theme preferences
- desktop-oriented window shell and workspace layout

The next iterations should prioritize reliability first, professional tooling second, and agent intelligence third.

The default delivery order is:

`V1.1 -> V1.2 -> V2`

## V1.1 Stable And Usable

This phase focuses on making the MQTT tool dependable for real broker usage.

- Implement real TLS handling in Rust:
  support custom CA, client certificate, client key, and passphrase loading and validation.
- Formalize real broker smoke coverage:
  plaintext connection, username/password auth, TLS connection, reconnect flow, subscription restore, publish echo.
- Add publish templates and recent publishes:
  connect the existing `publish_templates` table to frontend and backend flows.
- Improve failure feedback:
  distinguish auth errors, certificate errors, connect failures, subscribe failures, and publish failures.
- Improve message-history scalability:
  add first-stage pagination or chunked loading instead of always relying on full history reloads.

### Expected Public Interfaces

- New publish-template commands and DTOs:
  `list_publish_templates`
  `save_publish_template`
  `remove_publish_template`
  `list_recent_publishes`
- Extend the existing connection save/load flow to support real TLS material loading without redesigning the connection model.

### Acceptance

- A real broker can be connected with plaintext, password auth, and TLS.
- Publish templates can be saved and reused.
- Reconnect behavior is stable and visible.
- Error messages are specific enough to diagnose broker and certificate problems.

## V1.2 Professional Debugging

This phase turns MqttBox from usable into efficient for heavier daily debugging.

- Enhance the message workspace:
  stronger filter combinations, time-range filtering, and better large-history handling.
- Enhance message details:
  formatted JSON view, raw view, MQTT 5 properties display, and friendlier binary payload presentation.
- Improve topic management:
  batch enable/disable, reusable topic groups, import/export for topic presets.
- Improve connection management:
  duplicate connection, import/export connection profiles, recent error detail, health summary.
- Upgrade secret handling:
  move passwords and certificate secrets from local SQLite storage to platform-secure storage.
- Add desktop regression coverage:
  smoke/e2e checks for connect, subscribe, publish, settings persistence, and basic window behavior.

### Expected Public Interfaces

- Message history should evolve from the current full-load query model to pagination or cursor-based loading.
- Secret storage should gain a platform-storage-backed path while keeping the current data model stable for migration.

### Acceptance

- Larger message volumes remain usable.
- Message inspection becomes meaningfully richer than the current base detail panel.
- Sensitive values are no longer stored in plaintext in the app database.
- Basic desktop regression flows are automated.

## V2 Intelligent Workflow

This phase is where real agent capability starts.

- Connect a real model provider and tool-calling flow.
- Support safe read-only agent tools first, then guided write actions such as:
  subscription suggestions, publish draft generation, and connection diagnostics.
- Add message analysis features:
  topic frequency, JSON structure awareness, anomaly hints.
- Improve long-term data handling:
  richer export, archive flows, and storage/query optimization.
- Expand desktop capabilities where useful:
  tray integration, startup restore, command palette improvements, and possibly multi-connection workspaces.

### Expected Public Interfaces

- Agent interfaces should evolve from the current read-only `context/tools` model into a real `run / tool-result / confirmation` flow.

### Acceptance

- Agent suggestions are context-aware and useful.
- Tool execution boundaries are explicit and safe.
- No high-risk action is executed without a user-visible confirmation path.

## Assumptions

- MQTT usability remains the priority over agent features.
- The current stack stays in place:
  `React + TypeScript + Tauri + Rust + SQLite + Zustand`
- If only one next milestone is started immediately, default to:
  `V1.1 TLS + publish templates + real broker smoke validation`
