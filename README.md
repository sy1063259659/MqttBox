# MqttBox

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB.svg)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)

MqttBox is a desktop MQTT debugging tool built with React, TypeScript, Tauri, and Rust.

It is designed for developers and testers who want a focused desktop workspace for broker management, topic subscriptions, publishing, message inspection, history browsing, and payload parsing.

## Features

- Manage multiple MQTT broker connections in a desktop-oriented workspace
- Organize connections with folders and switch active connections quickly
- Create, edit, enable, and disable topic subscriptions for the current connection
- Publish messages with topic, payload type, QoS, and retain controls
- Inspect incoming and outgoing messages with history, filters, and export support
- View raw payloads and parser-transformed results for debugging binary protocols
- Use theme and locale preferences in a custom desktop window shell

## Why MqttBox

MqttBox focuses on the core daily MQTT debugging workflow instead of trying to be a generic dashboard.

- Desktop-first interaction model
- Clear separation between connections, subscriptions, messages, and publishing
- Better visibility into raw payloads and parser-driven inspection
- A modern stack that keeps frontend and backend responsibilities clean

## Tech Stack

- Frontend: React 19, TypeScript, Vite
- Desktop shell: Tauri 2
- Backend: Rust
- State management: Zustand
- Forms and validation: React Hook Form + Zod
- Editor integration: Monaco Editor
- Storage: SQLite via `rusqlite`

## Getting Started

### Prerequisites

- Node.js 18+
- Rust toolchain
- Tauri development prerequisites for your platform

If your environment is not ready yet, check:
[Tauri Prerequisites](https://tauri.app/start/prerequisites/)

### Install Dependencies

```bash
npm install
```

### Run In Development

```bash
npm run dev
```

## Development

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test -- --run
```

### Build Desktop App

```bash
npm run desktop:build
```

## Project Docs

- [Roadmap](./docs/roadmap.md)
- [UI and workflow guidance](./docs/react-tauri-desktop-ui-workflow.md)

## Current Scope

The current repository focuses on the core MQTT desktop workflow:

- broker connection management
- topic subscription management
- publish and receive flows
- message history and export
- payload inspection and parser-based debugging support
- theme, locale, and workspace-level desktop UX

The roadmap remains the source of truth for upcoming features and larger product direction.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri VS Code Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Roadmap

See [docs/roadmap.md](./docs/roadmap.md) for the current roadmap.

The current direction is:

- stabilize real broker workflows first
- improve professional debugging and inspection capabilities next
- expand intelligent and agent-assisted workflows later

## License

This project is licensed under the [MIT License](./LICENSE).
