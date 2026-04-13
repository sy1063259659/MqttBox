import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { AgentEventPayload, ConnectionEventPayload } from "./tauri";
import type { MessageRecordDto } from "@/features/messages/types";

export function registerConnectionEvents(
  onEvent: (payload: ConnectionEventPayload) => void,
) {
  return listen<ConnectionEventPayload>("connection://status", (event) => {
    onEvent(event.payload);
  });
}

export function registerMessageEvents(onEvent: (payload: MessageRecordDto) => void) {
  return listen<MessageRecordDto>("message://received", (event) => {
    onEvent(event.payload);
  });
}

export function registerAgentEvents(onEvent: (payload: AgentEventPayload) => void) {
  return listen<AgentEventPayload>("agent://status", (event) => {
    onEvent(event.payload);
  });
}

export async function unregisterListeners(unlisteners: Array<Promise<UnlistenFn>>) {
  const resolved = await Promise.all(unlisteners);
  resolved.forEach((unlisten) => unlisten());
}
