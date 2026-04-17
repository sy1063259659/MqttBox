import type { ModeHandler, ModeHandlerDeps, ModeInput } from "../types.js";

export class ChatModeHandler implements ModeHandler {
  constructor(private readonly deps: ModeHandlerDeps) {}

  async respond(input: ModeInput) {
    const systemPrompt = this.deps.promptRegistry.getSystemPrompt("chat", input.capabilityId);
    return this.deps.deepAgentsAdapter.runChat({
      sessionId: input.session.id,
      runId: input.runId ?? null,
      systemPrompt,
      userMessage: input.message,
      attachments: input.attachments,
      onDelta: input.onDelta,
      eventBus: input.eventBus,
      toolRunner: input.toolRunner,
      toolDefinitions: this.deps.toolRegistry.listDefinitions(),
      modelClient: this.deps.modelClient,
    });
  }
}
