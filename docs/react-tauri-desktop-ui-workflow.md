# React + Tauri Desktop UI Workflow

## Summary

This document captures the current project workflow and the preferred skills/process for MqttBox.

- Desktop-first UI
- React + TypeScript frontend
- Tauri + Rust backend
- Settings, theme, and locale managed as application settings
- MQTT workflow remains the primary product focus

## Recommended Skills

Use these skills when they are directly relevant to the task:

- `desktop-app`
  For desktop application structure and desktop UX decisions.
- `tauri-development`
  For Tauri-specific project wiring and desktop behavior.
- `integrating-tauri-js-frontends`
  For React/Vite/Tauri integration concerns.
- `configuring-tauri-permissions`
  For capabilities, permissions, and desktop security boundaries.
- `calling-rust-from-tauri-frontend`
  For new frontend-to-Rust command flows.
- `testing-tauri-apps`
  For desktop integration and smoke coverage.
- `zustand-state-management`
  For shared UI and app state changes.
- `react-hook-form-zod`
  For validated forms, especially connection and settings flows.
- `vitest`
  For frontend unit tests.

## Skill Usage Rules

- Use only the 2 to 4 skills that are directly relevant to the task.
- Do not bring in Tauri permission or backend-integration skills for pure styling work.
- Do not bring in test skills during early visual-only sketching.
- Do not introduce global state when local state is enough for a small isolated interaction.
- Prefer desktop-tool UX over marketing-page or dashboard-page patterns.

## UI Defaults

- The main window should feel like a focused desktop tool, not a website inside a shell.
- Avoid duplicated actions and duplicated status display across titlebar, sidebars, overlays, and content panes.
- Keep the main workspace centered on the MQTT workflow:
  connect, subscribe, inspect messages, publish, export.
- Agent features remain secondary until V2.
