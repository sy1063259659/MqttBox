import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { toast, Toaster } from "sonner";

import { AgentPanel } from "@/components/features/agent-panel";
import { AppTitlebar } from "@/components/features/app-titlebar";
import { ConnectionEditor } from "@/components/features/connection-editor";
import { ConnectionSidebar } from "@/components/features/connection-sidebar";
import {
  MessageTable,
  MessageWorkspaceToolbar,
} from "@/components/features/message-table";
import { OverlaySheet } from "@/components/features/overlay-sheet";
import { ParserLibrary } from "@/components/features/parser-library";
import { PublishComposer } from "@/components/features/publish-composer";
import { SubscriptionPanel } from "@/components/features/subscription-panel";
import { UtilityRail } from "@/components/features/utility-rail";
import { SettingsView } from "@/app/settings/settings-window";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PayloadViewMode } from "@/features/messages/payload";
import { useAgentStore } from "@/stores/agent-store";
import { useConnectionStore } from "@/stores/connection-store";
import { useMessageStore } from "@/stores/message-store";
import { useParserStore } from "@/stores/parser-store";
import { useSubscriptionStore } from "@/stores/subscription-store";
import { useUiStore } from "@/stores/ui-store";
import {
  registerAgentEvents,
  registerConnectionEvents,
  registerMessageEvents,
  unregisterListeners,
} from "@/services/events";
import {
  getAppSettings,
  getAgentSettings,
  getConnectionSecret,
  type AppSettingsDto,
} from "@/services/tauri";
import {
  closeCurrentWindow,
  minimizeCurrentWindow,
  subscribeCurrentWindowState,
  toggleMaximizeCurrentWindow,
} from "@/services/window";

const defaultSettings: AppSettingsDto = {
  activeConnectionId: null,
  messageHistoryLimitPerConnection: 5000,
  autoScrollMessages: true,
  timestampFormat: "datetime",
  theme: "graphite",
  locale: "system",
};

export function AppWorkbench() {
  const [settings, setSettings] = useState<AppSettingsDto>(defaultSettings);

  return (
    <I18nProvider localePreference={settings.locale}>
      <AppWorkbenchContent settings={settings} setSettings={setSettings} />
    </I18nProvider>
  );
}

function AppWorkbenchContent({
  settings,
  setSettings,
}: {
  settings: AppSettingsDto;
  setSettings: Dispatch<SetStateAction<AppSettingsDto>>;
}) {
  const { t } = useI18n();
  const connectionStore = useConnectionStore();
  const subscriptionStore = useSubscriptionStore();
  const messageStore = useMessageStore();
  const parserStore = useParserStore();
  const uiStore = useUiStore();
  const agentStore = useAgentStore();
  const {
    loadFolders,
    loadProfiles,
    hydrateActiveConnection,
    setRuntimeState,
    markConnectionPending,
    clearConnectionPending,
  } = connectionStore;
  const { loadSubscriptions } = subscriptionStore;
  const { loadMessages, handleIncoming } = messageStore;
  const { loadContext, loadTools, loadServiceHealth, loadServiceConfig, applyIncomingEvent } = agentStore;
  const {
    activeOverlay,
    closeOverlay,
    closeSettings,
    setAppReady,
    setBootstrapping,
    setPublishPanelHeight,
    setTheme,
    setWindowState,
    theme,
  } = uiStore;

  const activeConnection = useMemo(
    () =>
      connectionStore.profiles.find(
        (profile) => profile.id === connectionStore.activeConnectionId,
      ) ?? null,
    [connectionStore.activeConnectionId, connectionStore.profiles],
  );

  const [activeSecret, setActiveSecret] = useState<Awaited<
    ReturnType<typeof getConnectionSecret>
  > | null>(null);
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [editorFolderId, setEditorFolderId] = useState<string | null>(null);
  const [payloadViewMode, setPayloadViewMode] = useState<PayloadViewMode>("hex");
  const bootstrapStartedRef = useRef(false);
  const messageLoadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageConnectionIdRef = useRef<string | null>(null);
  const workspaceMainRef = useRef<HTMLElement | null>(null);
  const publishResizeRef = useRef<{
    startY: number;
    startHeight: number;
    maxHeight: number;
  } | null>(null);
  const [isResizingPublishPanel, setIsResizingPublishPanel] = useState(false);
  const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("toast.operationFailed");

  const editorProfile = useMemo(
    () =>
      isCreatingConnection
        ? undefined
        : connectionStore.profiles.find(
            (profile) => profile.id === (editingConnectionId ?? connectionStore.activeConnectionId),
          ),
    [connectionStore.activeConnectionId, connectionStore.profiles, editingConnectionId, isCreatingConnection],
  );
  const editorConnectionId = isCreatingConnection ? null : (editingConnectionId ?? connectionStore.activeConnectionId);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void subscribeCurrentWindowState((state) => {
      if (!disposed) {
        setWindowState(state);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setWindowState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (activeOverlay === "settings") {
          document.documentElement.dataset.theme = settings.theme;
          setTheme(settings.theme);
          closeSettings();
          return;
        }
        closeOverlay();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeOverlay, closeOverlay, closeSettings, setTheme, settings.theme]);

  useLayoutEffect(() => {
    const container = workspaceMainRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const maxHeight = Math.max(200, Math.floor(container.clientHeight * 0.45));
      const clampedHeight = Math.min(Math.max(uiStore.publishPanelHeight, 200), maxHeight);
      if (clampedHeight !== uiStore.publishPanelHeight) {
        setPublishPanelHeight(clampedHeight);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [setPublishPanelHeight, uiStore.publishPanelHeight]);

  useEffect(() => {
    if (!isResizingPublishPanel) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const state = publishResizeRef.current;
      if (!state) {
        return;
      }

      const nextHeight = Math.min(
        state.maxHeight,
        Math.max(200, state.startHeight + (state.startY - event.clientY)),
      );
      setPublishPanelHeight(nextHeight);
    };

    const stopResize = () => {
      publishResizeRef.current = null;
      setIsResizingPublishPanel(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
    };
  }, [isResizingPublishPanel, setPublishPanelHeight]);

  useEffect(() => {
    if (bootstrapStartedRef.current) {
      return;
    }

    bootstrapStartedRef.current = true;

    const bootstrap = async () => {
      setBootstrapping(true);
      try {
        const [loadedSettings] = await Promise.all([
          getAppSettings(),
          getAgentSettings(),
          loadFolders(),
          loadProfiles(),
          parserStore.loadParsers(),
        ]);

        setSettings(loadedSettings);
        setTheme(loadedSettings.theme);

        const storeState = useConnectionStore.getState();
        const nextActive =
          loadedSettings.activeConnectionId &&
          storeState.profiles.some((profile) => profile.id === loadedSettings.activeConnectionId)
            ? loadedSettings.activeConnectionId
            : storeState.activeConnectionId;

        if (nextActive) {
          hydrateActiveConnection(nextActive);
        }

        setAppReady(true);
        void loadTools().catch(() => undefined);
        void loadServiceHealth().catch(() => undefined);
        void loadServiceConfig().catch(() => undefined);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("toast.initFailed"));
      } finally {
        setAppReady(true);
        setBootstrapping(false);
      }
    };

    void bootstrap();
  }, [hydrateActiveConnection, loadFolders, loadProfiles, loadServiceConfig, loadServiceHealth, loadTools, parserStore, setAppReady, setBootstrapping, setSettings, setTheme, t]);

  useEffect(() => {
    if (!connectionStore.activeConnectionId) {
      setActiveSecret(null);
      setIsCreatingConnection(false);
      setEditingConnectionId(null);
      lastMessageConnectionIdRef.current = null;
      void loadSubscriptions(null);
      void loadMessages(null);
      return;
    }

    setIsCreatingConnection(false);
    void loadSubscriptions(connectionStore.activeConnectionId);
    void loadContext(connectionStore.activeConnectionId);
    void getConnectionSecret(connectionStore.activeConnectionId).then(setActiveSecret);
  }, [connectionStore.activeConnectionId, loadContext, loadMessages, loadSubscriptions]);

  useEffect(() => {
    if (!connectionStore.activeConnectionId) {
      return;
    }

    if (messageLoadDebounceRef.current) {
      clearTimeout(messageLoadDebounceRef.current);
    }

    const delay =
      lastMessageConnectionIdRef.current === connectionStore.activeConnectionId ? 180 : 0;

    messageLoadDebounceRef.current = setTimeout(() => {
      void loadMessages(connectionStore.activeConnectionId!);
      lastMessageConnectionIdRef.current = connectionStore.activeConnectionId;
    }, delay);

    return () => {
      if (messageLoadDebounceRef.current) {
        clearTimeout(messageLoadDebounceRef.current);
      }
    };
  }, [
    connectionStore.activeConnectionId,
    loadMessages,
    messageStore.filter.direction,
    messageStore.filter.keyword,
    messageStore.filter.topic,
  ]);

  useEffect(() => {
    if (!editorConnectionId) {
      setActiveSecret(null);
      return;
    }

    void getConnectionSecret(editorConnectionId).then(setActiveSecret);
  }, [editorConnectionId]);

  useEffect(() => {
    const listeners = [
      registerConnectionEvents((payload) => {
        const pendingConnect = useConnectionStore
          .getState()
          .pendingConnectionIds.includes(payload.connectionId);

        setRuntimeState(payload.connectionId, {
          status: payload.status as never,
          lastError: payload.message ?? null,
        });

        if (payload.status === "connected") {
          clearConnectionPending(payload.connectionId);
          if (pendingConnect) {
            toast.success(t("toast.connected"));
          }
        }

        if (payload.status === "disconnected" || payload.status === "error") {
          clearConnectionPending(payload.connectionId);
        }

        if (payload.message && payload.status === "error") {
          toast.error(payload.message);
        }
      }),
      registerMessageEvents((payload) => {
        handleIncoming(payload);
      }),
      registerAgentEvents((payload) => {
        applyIncomingEvent(payload);
      }),
    ];

    return () => {
      void unregisterListeners(listeners);
    };
  }, [applyIncomingEvent, handleIncoming, setRuntimeState]);

  const activeRuntime =
    (activeConnection && connectionStore.runtime[activeConnection.id]) ?? {
      status: "idle",
      lastError: null,
    };
  const hasActiveConnection = Boolean(connectionStore.activeConnectionId);
  const isActiveConnectionConnected = activeRuntime.status === "connected";
  const subscriptionActionsDisabled = !hasActiveConnection || !isActiveConnectionConnected;
  const publishActionsDisabled = !hasActiveConnection || !isActiveConnectionConnected;
  const messageActionsDisabled = !hasActiveConnection;

  return (
    <div
      className="app-shell"
      data-bootstrapping={uiStore.isBootstrapping}
      data-maximized={uiStore.isWindowMaximized}
    >
      <AppTitlebar
        onOpenSettings={uiStore.openSettings}
        onMinimize={minimizeCurrentWindow}
        onMaximize={toggleMaximizeCurrentWindow}
        onClose={closeCurrentWindow}
      />

      <div className="workspace-stage">
        {uiStore.isAppReady ? (
          <div
            className={cn(
              "workspace-shell",
              uiStore.connectionSidebarCollapsed && "is-connection-sidebar-collapsed",
            )}
          >
            <UtilityRail
              activeOverlay={uiStore.activeOverlay}
              onOpenParsers={() => uiStore.openOverlay("parsers")}
              onOpenAgent={() => uiStore.openOverlay("agent")}
            />

            <ConnectionSidebar
              collapsed={uiStore.connectionSidebarCollapsed}
              folders={connectionStore.folders}
              profiles={connectionStore.profiles}
              runtime={connectionStore.runtime}
              activeConnectionId={connectionStore.activeConnectionId}
              pendingConnectionIds={connectionStore.pendingConnectionIds}
              expandedFolderIds={connectionStore.expandedFolderIds}
              draggingState={connectionStore.draggingState}
              activeStatus={activeRuntime.status}
              onToggleCollapsed={uiStore.toggleConnectionSidebarCollapsed}
              onSelectConnection={(connectionId) => {
                setIsCreatingConnection(false);
                setEditingConnectionId(connectionId);
                void connectionStore.setActiveConnection(connectionId);
              }}
              onCreateConnection={(folderId) => {
                setIsCreatingConnection(true);
                setEditingConnectionId(null);
                setEditorFolderId(folderId ?? null);
                uiStore.openOverlay("connections");
              }}
              onEditConnection={(connectionId) => {
                setIsCreatingConnection(false);
                setEditingConnectionId(connectionId);
                setEditorFolderId(null);
                uiStore.openOverlay("connections");
              }}
              onRemoveConnection={async (connectionId) => {
                try {
                  await connectionStore.remove(connectionId);
                  toast.success(t("toast.connectionDeleted"));
                } catch (error) {
                  toast.error(getErrorMessage(error));
                }
              }}
              onConnectActive={async () => {
                if (!activeConnection) {
                  return;
                }
                try {
                  markConnectionPending(activeConnection.id);
                  toast.info(t("toast.connecting"));
                  await connectionStore.connect(activeConnection.id);
                } catch (error) {
                  clearConnectionPending(activeConnection.id);
                  toast.error(getErrorMessage(error));
                }
              }}
              onDisconnectActive={async () => {
                if (!activeConnection) {
                  return;
                }
                try {
                  toast.info(t("toast.disconnecting"));
                  await connectionStore.disconnect(activeConnection.id);
                  toast.success(t("toast.disconnected"));
                } catch (error) {
                  toast.error(getErrorMessage(error));
                }
              }}
              onCreateFolder={async (name) => {
                try {
                  await connectionStore.createFolder(name);
                  toast.success(t("toast.folderCreated"));
                } catch (error) {
                  toast.error(getErrorMessage(error));
                }
              }}
              onRenameFolder={async (folderId, name) => {
                try {
                  await connectionStore.renameFolder(folderId, name);
                  toast.success(t("toast.folderUpdated"));
                } catch (error) {
                  toast.error(getErrorMessage(error));
                }
              }}
              onRemoveFolder={async (folderId) => {
                try {
                  await connectionStore.removeFolder(folderId);
                  toast.success(t("toast.folderDeleted"));
                } catch (error) {
                  toast.error(getErrorMessage(error));
                }
              }}
              onToggleFolder={connectionStore.toggleFolderExpanded}
              onReorderFolders={connectionStore.reorderFolders}
              onReorderConnections={connectionStore.reorderConnections}
              onDragStart={connectionStore.setDraggingState}
              onDragEnd={connectionStore.clearDraggingState}
            />

          <main
            ref={workspaceMainRef}
            className={cn("workspace-main", isResizingPublishPanel && "is-resizing")}
          >
            <section className="workspace-topbar">
              <MessageWorkspaceToolbar
                filter={messageStore.filter}
                isPaused={messageStore.isPaused}
                payloadViewMode={payloadViewMode}
                actionsDisabled={messageActionsDisabled}
                onFilterChange={(filter) => {
                  messageStore.setFilter(filter);
                }}
                onPayloadViewModeChange={setPayloadViewMode}
                onTogglePause={messageStore.togglePause}
                onClear={async () => {
                  if (!connectionStore.activeConnectionId) {
                    return;
                  }
                  try {
                    await messageStore.clear(connectionStore.activeConnectionId);
                    toast.success(t("toast.historyCleared"));
                  } catch (error) {
                    toast.error(getErrorMessage(error));
                  }
                }}
                onExport={async () => {
                  if (!connectionStore.activeConnectionId) {
                    return;
                  }

                  const path = await save({
                    defaultPath: "mqttbox-messages.json",
                  });

                  if (!path) {
                    return;
                  }

                  try {
                    await messageStore.export({
                      connectionId: connectionStore.activeConnectionId,
                      format: path.endsWith(".csv") ? "csv" : "json",
                      path,
                    });
                    toast.success(t("toast.exported"));
                  } catch (error) {
                    toast.error(getErrorMessage(error));
                  }
                }}
              />
            </section>

            <div className="workspace-workbench">
              <section className="workspace-subscriptions workspace-subscriptions-panel">
                <SubscriptionPanel
                  connectionId={connectionStore.activeConnectionId}
                  connectionName={activeConnection?.name ?? null}
                  connectionStatus={activeRuntime.status}
                  items={subscriptionStore.items}
                  actionsDisabled={subscriptionActionsDisabled}
                  variant="workspace"
                  onSubmit={async (entry) => {
                    if (!connectionStore.activeConnectionId) {
                      return;
                    }
                    try {
                      await subscriptionStore.addSubscription(
                        connectionStore.activeConnectionId,
                        entry,
                      );
                      toast.success(
                        entry.id ? t("toast.subscriptionUpdated") : t("toast.subscriptionAdded"),
                      );
                    } catch (error) {
                      toast.error(getErrorMessage(error));
                    }
                  }}
                  onRemove={async (subscriptionId) => {
                    if (!connectionStore.activeConnectionId) {
                      return;
                    }
                    try {
                      await subscriptionStore.removeSubscription(
                        connectionStore.activeConnectionId,
                        subscriptionId,
                      );
                      toast.success(t("toast.subscriptionRemoved"));
                    } catch (error) {
                      toast.error(getErrorMessage(error));
                    }
                  }}
                  onToggle={async (subscriptionId, enabled) => {
                    if (!connectionStore.activeConnectionId) {
                      return;
                    }
                    try {
                      await subscriptionStore.toggleSubscription(
                        connectionStore.activeConnectionId,
                        subscriptionId,
                        enabled,
                      );
                      toast.success(
                        enabled ? t("toast.subscriptionEnabled") : t("toast.subscriptionDisabled"),
                      );
                    } catch (error) {
                      toast.error(getErrorMessage(error));
                    }
                  }}
                />
              </section>

              <section className="workspace-conversation">
                <div className="workspace-conversation-panel">
                  <MessageTable
                    items={messageStore.items}
                    filter={messageStore.filter}
                    isPaused={messageStore.isPaused}
                    payloadViewMode={payloadViewMode}
                    isLoading={messageStore.isLoading}
                    hasMore={messageStore.hasMore}
                    actionsDisabled={messageActionsDisabled}
                    showToolbar={false}
                    onFilterChange={(filter) => {
                      messageStore.setFilter(filter);
                    }}
                    onPayloadViewModeChange={setPayloadViewMode}
                    onTogglePause={messageStore.togglePause}
                    onClear={async () => {
                      if (!connectionStore.activeConnectionId) {
                        return;
                      }
                      try {
                        await messageStore.clear(connectionStore.activeConnectionId);
                        toast.success(t("toast.historyCleared"));
                      } catch (error) {
                        toast.error(getErrorMessage(error));
                      }
                    }}
                    onExport={async () => {
                      if (!connectionStore.activeConnectionId) {
                        return;
                      }

                      const path = await save({
                        defaultPath: "mqttbox-messages.json",
                      });

                      if (!path) {
                        return;
                      }

                      try {
                        await messageStore.export({
                          connectionId: connectionStore.activeConnectionId,
                          format: path.endsWith(".csv") ? "csv" : "json",
                          path,
                        });
                        toast.success(t("toast.exported"));
                      } catch (error) {
                        toast.error(getErrorMessage(error));
                      }
                    }}
                    onLoadMore={async () => {
                      if (!connectionStore.activeConnectionId) {
                        return;
                      }
                      try {
                        await messageStore.loadMore(connectionStore.activeConnectionId);
                      } catch (error) {
                        toast.error(getErrorMessage(error));
                      }
                    }}
                  />

                  <div
                    className="workspace-main-divider"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label={t("publish.title")}
                    onPointerDown={(event) => {
                      if (!workspaceMainRef.current) {
                        return;
                      }
                      publishResizeRef.current = {
                        startY: event.clientY,
                        startHeight: uiStore.publishPanelHeight,
                        maxHeight: Math.max(
                          200,
                          Math.floor(workspaceMainRef.current.clientHeight * 0.45),
                        ),
                      };
                      setIsResizingPublishPanel(true);
                      document.body.style.cursor = "row-resize";
                      document.body.style.userSelect = "none";
                    }}
                  >
                    <span className="workspace-main-divider-handle" />
                  </div>

                  <div
                    className="workspace-main-bottom"
                    style={{ height: uiStore.publishPanelHeight }}
                  >
                    <PublishComposer
                      connectionId={connectionStore.activeConnectionId}
                      height={uiStore.publishPanelHeight}
                      disabled={publishActionsDisabled}
                      onBlockedSend={(reason) => {
                        toast.error(reason);
                      }}
                      onPublish={async (request) => {
                        if (!connectionStore.activeConnectionId) {
                          return;
                        }
                        try {
                          await messageStore.publish({
                            connectionId: connectionStore.activeConnectionId,
                            ...request,
                          });
                          toast.success(t("toast.publishRequested"));
                        } catch (error) {
                          toast.error(getErrorMessage(error));
                        }
                      }}
                    />
                  </div>
                </div>
              </section>
            </div>

            <OverlaySheet
              open={uiStore.activeOverlay === "connections"}
              title={
                isCreatingConnection
                  ? t("connectionEditor.title.new")
                  : t("connectionEditor.title.edit")
              }
              width="lg"
              variant="command"
              onClose={() => {
                setIsCreatingConnection(false);
                setEditingConnectionId(null);
                setEditorFolderId(null);
                uiStore.closeOverlay();
              }}
            >
              <ConnectionEditor
                profile={editorProfile}
                secret={activeSecret}
                defaultFolderId={editorFolderId}
                onSave={async (profile) => {
                  try {
                    const saved = await connectionStore.saveProfile(profile);
                    setIsCreatingConnection(false);
                    setEditingConnectionId(saved.id);
                    setEditorFolderId(null);
                    setActiveSecret(await getConnectionSecret(saved.id));
                    uiStore.closeOverlay();
                    toast.success(
                      profile.id ? t("toast.connectionUpdated") : t("toast.connectionCreated"),
                    );
                  } catch (error) {
                    toast.error(getErrorMessage(error));
                  }
                }}
                onTest={async (profile) => {
                  try {
                    const result = await connectionStore.testProfile(profile);
                    toast.success(`${result.message} · ${result.latencyMs} ms`);
                    return result;
                  } catch (error) {
                    toast.error(getErrorMessage(error));
                    throw error;
                  }
                }}
              />
            </OverlaySheet>

            <OverlaySheet
              open={uiStore.activeOverlay === "parsers"}
              title={t("overlay.parsers.title")}
              width="xl"
              onClose={uiStore.closeOverlay}
            >
              <ParserLibrary />
            </OverlaySheet>

            <OverlaySheet
              open={uiStore.activeOverlay === "agent"}
              title={t("overlay.agent.title")}
              position="right"
              width="sm"
              onClose={uiStore.closeOverlay}
            >
              <AgentPanel />
            </OverlaySheet>
            </main>
          </div>
        ) : (
          <StartupShell />
        )}

        <OverlaySheet
          className="overlay-sheet--settings"
          open={uiStore.activeOverlay === "settings"}
          title={t("settings.title")}
          width="md"
          backdropClosable={false}
          onClose={() => {
            document.documentElement.dataset.theme = settings.theme;
            uiStore.setTheme(settings.theme);
            uiStore.closeSettings();
          }}
        >
          <SettingsView
            initialSettings={settings}
            onClose={() => {
              document.documentElement.dataset.theme = settings.theme;
              uiStore.setTheme(settings.theme);
              uiStore.closeSettings();
            }}
            onSaved={(nextSettings) => {
              setSettings(nextSettings);
              uiStore.setTheme(nextSettings.theme);
              uiStore.closeSettings();
            }}
          />
        </OverlaySheet>
      </div>
      <Toaster
        position="top-right"
        richColors
        theme={uiStore.theme === "midnight" ? "dark" : "light"}
      />
    </div>
  );
}

function StartupShell() {
  return (
    <div className="workspace-shell startup-shell" aria-hidden="true">
      <div className="utility-rail startup-rail">
        <div className="startup-pill h-8 w-8 rounded-[11px]" />
        <div className="startup-pill h-8 w-8 rounded-[11px]" />
      </div>
      <aside className="connection-sidebar startup-sidebar">
        <div className="connection-sidebar-header">
          <div className="startup-pill h-4 w-28 rounded-full" />
          <div className="startup-pill h-8 w-[72px] rounded-[10px]" />
        </div>
        <div className="startup-sidebar-list">
          <div className="startup-pill h-9 w-full rounded-[12px]" />
          <div className="startup-pill h-9 w-full rounded-[12px]" />
          <div className="startup-pill h-9 w-[86%] rounded-[12px]" />
        </div>
      </aside>
      <main className="workspace-main startup-main">
        <section className="workspace-topbar startup-topbar">
          <div className="startup-topbar-row">
            <div className="startup-pill h-10 flex-1 rounded-[12px]" />
            <div className="startup-pill h-10 w-40 rounded-[12px]" />
            <div className="startup-pill h-10 w-40 rounded-[12px]" />
            <div className="startup-pill h-10 w-28 rounded-[12px]" />
          </div>
        </section>
        <div className="workspace-workbench startup-workbench">
          <section className="workspace-subscriptions startup-subscriptions-panel">
            <div className="startup-subscriptions">
              <div className="startup-subscriptions-header">
                <div className="startup-pill h-4 w-28 rounded-full" />
                <div className="startup-pill h-6 w-24 rounded-full" />
              </div>
              <div className="startup-pill h-10 w-full rounded-[12px]" />
              <div className="startup-pill h-10 w-full rounded-[12px]" />
            </div>
          </section>
          <section className="workspace-conversation startup-conversation">
            <div className="startup-conversation-panel">
              <div className="startup-main-header">
                <div className="startup-pill h-4 w-24 rounded-full" />
                <div className="startup-main-actions">
                  <div className="startup-pill h-8 w-8 rounded-[10px]" />
                  <div className="startup-pill h-8 w-8 rounded-[10px]" />
                </div>
              </div>
              <div className="startup-main-filters">
                <div className="startup-pill h-10 flex-1 rounded-[12px]" />
                <div className="startup-pill h-10 w-44 rounded-[12px]" />
                <div className="startup-pill h-10 w-32 rounded-[12px]" />
              </div>
              <div className="startup-table">
                <div className="startup-table-row" />
                <div className="startup-table-row" />
                <div className="startup-table-row" />
                <div className="startup-table-row" />
                <div className="startup-table-row" />
              </div>
              <div className="workspace-main-divider startup-divider">
                <span className="workspace-main-divider-handle" />
              </div>
              <div className="workspace-main-bottom startup-main-bottom">
                <div className="publish-composer startup-publish-composer">
                  <div className="startup-pill h-4 w-28 rounded-full" />
                  <div className="startup-pill h-10 w-full rounded-[12px]" />
                  <div className="startup-pill h-10 w-full rounded-[12px]" />
                  <div className="startup-pill h-[104px] w-full rounded-[14px]" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
