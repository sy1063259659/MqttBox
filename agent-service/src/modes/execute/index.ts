import type { ModeHandler, ModeHandlerDeps, ModeInput } from "../types.js";

export class ExecuteModeHandler implements ModeHandler {
  constructor(private readonly deps: ModeHandlerDeps) {}

  async respond(input: ModeInput): Promise<string> {
    const systemPrompt = this.deps.promptRegistry.getSystemPrompt("execute", input.capabilityId);
    const response = await this.deps.modelClient.generate({
      mode: "execute",
      systemPrompt,
      userMessage: input.message,
      attachments: input.attachments,
      onDelta: input.onDelta,
    });
    return response.content;
  }
}
