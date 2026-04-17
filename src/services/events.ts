import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { AgentEventPayload, ConnectionEventPayload } from "./tauri";
import type { MessageRecordDto } from "@/features/messages/types";

function hasTauriEventRuntime() {
  const target = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };

  return typeof window !== "undefined" && Boolean(target.__TAURI_INTERNALS__ || target.__TAURI__);
}

function registerListener<TPayload>(
  eventName: string,
  onEvent: (payload: TPayload) => void,
): Promise<UnlistenFn> {
  if (!hasTauriEventRuntime()) {
    return Promise.resolve(() => undefined);
  }

  return listen<TPayload>(eventName, (event) => {
    onEvent(event.payload);
  }).catch(() => () => undefined);
}

export function registerConnectionEvents(
  onEvent: (payload: ConnectionEventPayload) => void,
) {
  return registerListener("connection://status", onEvent);
}

export function registerMessageEvents(onEvent: (payload: MessageRecordDto) => void) {
  return registerListener("message://received", onEvent);
}

export function registerAgentEvents(onEvent: (payload: AgentEventPayload) => void) {
  return registerListener("agent://status", onEvent);
}

export async function unregisterListeners(unlisteners: Array<Promise<UnlistenFn>>) {
  const resolved = await Promise.all(unlisteners);
  resolved.forEach((unlisten) => unlisten());
}
