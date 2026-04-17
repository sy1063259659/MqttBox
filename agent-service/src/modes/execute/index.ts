import type { ModeHandler, ModeHandlerDeps, ModeInput } from "../types.js";

export class ExecuteModeHandler implements ModeHandler {
  constructor(private readonly deps: ModeHandlerDeps) {}

  async respond(input: ModeInput) {
    const systemPrompt = this.deps.promptRegistry.getSystemPrompt("execute", input.capabilityId);
    return this.deps.deepAgentsAdapter.runExecute({
      sessionId: input.session.id,
      systemPrompt,
      userMessage: input.message,
      attachments: input.attachments,
      onDelta: input.onDelta,
      capabilityId: input.capabilityId,
      runId: input.runId,
      safetyLevel: input.session.safetyLevel,
      eventBus: input.eventBus,
      toolRunner: input.toolRunner,
      toolDefinitions: this.deps.toolRegistry.listDefinitions(),
      modelClient: this.deps.modelClient,
    });
  }
}
