# MqttBox

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB.svg)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)

MqttBox 是一个基于 React、TypeScript、Tauri 和 Rust 构建的桌面 MQTT 调试工具。

它面向日常调试和测试场景，提供更聚焦的桌面工作区，用于管理 broker、订阅主题、发布消息、查看消息历史，以及分析原始 payload 和解析结果。

## 功能特性

- 在桌面工作区中管理多个 MQTT broker 连接
- 通过文件夹组织连接，并快速切换当前活动连接
- 为当前连接创建、编辑、启停订阅主题
- 使用 topic、payload type、QoS、retain 等参数发布消息
- 查看接收与发送消息，支持历史记录、过滤和导出
- 面向二进制协议调试，查看原始 payload 与解析脚本转换结果
- 支持主题、语言和自定义桌面窗口工作区体验

## 为什么是 MqttBox

MqttBox 更关注 MQTT 日常调试工作流本身，而不是做成一个泛化的大而全面板。

- 更偏桌面工具的交互方式
- 连接、订阅、消息、发布职责划分更清楚
- 对原始 payload 和解析后的查看更友好
- 前后端边界清晰，便于后续继续迭代

## 技术栈

- 前端：React 19、TypeScript、Vite
- 桌面壳：Tauri 2
- 后端：Rust
- 状态管理：Zustand
- 表单与校验：React Hook Form + Zod
- 编辑器：Monaco Editor
- 存储：基于 `rusqlite` 的 SQLite

## 快速开始

### 环境要求

- Node.js 18+
- Rust toolchain
- 当前平台对应的 Tauri 开发依赖

如果本机环境还没准备好，可以先看：
[Tauri Prerequisites](https://tauri.app/start/prerequisites/)

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

## 开发

### 构建前端

```bash
npm run build
```

### 运行测试

```bash
npm test -- --run
```

### 构建桌面应用

```bash
npm run desktop:build
```

## 项目文档

- [路线图](./docs/roadmap.md)
- [UI 与工作流说明](./docs/react-tauri-desktop-ui-workflow.md)
- [Agent Harness / 解析脚本生成功能现状](./docs/agent-harness-parser-authoring-status.md)

## 当前范围

当前仓库主要聚焦于桌面 MQTT 核心工作流：

- broker 连接管理
- 主题订阅管理
- 发布与接收消息
- 消息历史与导出
- payload 查看与解析脚本调试支持
- 主题、语言与桌面工作区体验

此外，仓库里已经有一条实验性的 Agent Service + 解析脚本生成链路：

- execute 模式生成解析脚本草案
- 通过 approval 控制产物创建
- 一键把生成草案打开到 ParserLibrary 中继续编辑、测试、保存

这部分能力仍处于 contract / boundary 持续收敛阶段，当前差距请参考上面的专项状态文档。

后续能力扩展和产品方向以路线图为准。

## 推荐开发环境

- [VS Code](https://code.visualstudio.com/)
- [Tauri VS Code Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 路线图

当前路线图见 [docs/roadmap.md](./docs/roadmap.md)。

现阶段的默认方向是：

- 先把真实 broker 调试链路做稳
- 再加强专业调试与消息分析能力
- 最后扩展智能化或 Agent 辅助工作流

## License

本项目基于 [MIT License](./LICENSE) 开源。
