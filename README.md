# MqttBox

MqttBox is a desktop MQTT debugging client built with `React + TypeScript + Tauri + Rust`, focused on broker management, topic subscriptions, message history, and payload parsing.

The current app already includes:

- broker connection management
- folder-based connection organization
- topic subscription management
- publish and receive workflows
- message history, export, theme, and locale settings
- custom desktop window shell and modern workspace UI

## Project Docs

- Roadmap: [docs/roadmap.md](./docs/roadmap.md)
- UI and workflow guidance: [docs/react-tauri-desktop-ui-workflow.md](./docs/react-tauri-desktop-ui-workflow.md)

## Development

```bash
npm run dev
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
