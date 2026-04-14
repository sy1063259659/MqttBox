import type { ModeHandler, ModeHandlerDeps, ModeInput } from "../types.js";

export class ChatModeHandler implements ModeHandler {
  constructor(private readonly deps: ModeHandlerDeps) {}

  async respond(input: ModeInput): Promise<string> {
    const systemPrompt = this.deps.promptRegistry.getSystemPrompt("chat", input.capabilityId);
    const response = await this.deps.modelClient.generate({
      mode: "chat",
      systemPrompt,
      userMessage: input.message,
      attachments: input.attachments,
      onDelta: input.onDelta,
    });
    return response.content;
  }
}
