import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface CurrentWindowState {
  isWindowMaximized: boolean;
  windowSize: {
    width: number;
    height: number;
  } | null;
}

const FALLBACK_WINDOW_STATE: CurrentWindowState = {
  isWindowMaximized: false,
  windowSize: null,
};

function hasTauriWindowRuntime() {
  const target = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };

  return typeof window !== "undefined" && Boolean(target.__TAURI_INTERNALS__ || target.__TAURI__);
}

async function readCurrentWindowState(window: Window): Promise<CurrentWindowState> {
  const [isWindowMaximized, size] = await Promise.all([
    window.isMaximized(),
    window.innerSize(),
  ]);

  return {
    isWindowMaximized,
    windowSize: {
      width: size.width,
      height: size.height,
    },
  };
}

export async function subscribeCurrentWindowState(
  onChange: (state: CurrentWindowState) => void,
) {
  if (!hasTauriWindowRuntime()) {
    onChange(FALLBACK_WINDOW_STATE);
    return () => undefined;
  }

  const currentWindow = getCurrentWindow();

  const emitState = async () => {
    onChange(await readCurrentWindowState(currentWindow));
  };

  await emitState();

  const unlisteners: UnlistenFn[] = [];
  unlisteners.push(await currentWindow.onResized(() => void emitState()));

  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}

export async function minimizeCurrentWindow() {
  if (!hasTauriWindowRuntime()) {
    return;
  }

  await getCurrentWindow().minimize();
}

export async function toggleMaximizeCurrentWindow() {
  if (!hasTauriWindowRuntime()) {
    return;
  }

  await getCurrentWindow().toggleMaximize();
}

export async function closeCurrentWindow() {
  if (!hasTauriWindowRuntime()) {
    return;
  }

  await getCurrentWindow().close();
}
