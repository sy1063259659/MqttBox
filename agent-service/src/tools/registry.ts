import type { ToolDescriptor } from "@agent-contracts";
import { toToolDescriptor, type ToolDefinition } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  list(): ToolDescriptor[] {
    return Array.from(this.tools.values(), (tool) => toToolDescriptor(tool));
  }
}
