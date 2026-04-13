import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface CurrentWindowState {
  isWindowMaximized: boolean;
  windowSize: {
    width: number;
    height: number;
  } | null;
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
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeCurrentWindow() {
  await getCurrentWindow().toggleMaximize();
}

export async function closeCurrentWindow() {
  await getCurrentWindow().close();
}
