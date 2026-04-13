import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  FolderTree,
  Pencil,
  Plus,
  RefreshCw,
  Plug,
  Power,
  Trash2,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ConnectionFolderDto,
  ConnectionProfileDto,
  ConnectionReorderItem,
  ConnectionRuntimeState,
} from "@/features/connections/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const UNGROUPED_KEY = "__ungrouped__";

interface ConnectionSidebarProps {
  collapsed: boolean;
  folders: ConnectionFolderDto[];
  profiles: ConnectionProfileDto[];
  runtime: Record<string, ConnectionRuntimeState>;
  activeConnectionId: string | null;
  pendingConnectionIds: string[];
  expandedFolderIds: string[];
  draggingState:
    | {
        type: "folder";
        id: string;
      }
    | {
        type: "connection";
        id: string;
        sourceFolderId?: string | null;
      }
    | null;
  activeStatus: ConnectionRuntimeState["status"];
  onToggleCollapsed: () => void;
  onSelectConnection: (connectionId: string) => void;
  onCreateConnection: (folderId?: string | null) => void;
  onEditConnection: (connectionId: string) => void;
  onRemoveConnection: (connectionId: string) => void;
  onConnectActive: () => Promise<void>;
  onDisconnectActive: () => Promise<void>;
  onCreateFolder: (name: string) => Promise<void>;
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onRemoveFolder: (folderId: string) => Promise<void>;
  onToggleFolder: (folderId: string) => void;
  onReorderFolders: (folderIds: string[]) => Promise<void>;
  onReorderConnections: (items: ConnectionReorderItem[]) => Promise<void>;
  onDragStart: (
    draggingState:
      | {
          type: "folder";
          id: string;
        }
      | {
          type: "connection";
          id: string;
          sourceFolderId?: string | null;
        },
  ) => void;
  onDragEnd: () => void;
}

export function ConnectionSidebar({
  collapsed,
  folders,
  profiles,
  runtime,
  activeConnectionId,
  pendingConnectionIds,
  expandedFolderIds,
  draggingState,
  activeStatus,
  onToggleCollapsed,
  onSelectConnection,
  onCreateConnection,
  onEditConnection,
  onRemoveConnection,
  onConnectActive,
  onDisconnectActive,
  onCreateFolder,
  onRenameFolder,
  onRemoveFolder,
  onToggleFolder,
  onReorderFolders,
  onReorderConnections,
  onDragStart,
  onDragEnd,
}: ConnectionSidebarProps) {
  const { t } = useI18n();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [draftFolderName, setDraftFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");

  const orderedFolders = useMemo(
    () => [...folders].sort((left, right) => left.sortOrder - right.sortOrder),
    [folders],
  );
  const groupedProfiles = useMemo(() => {
    const groups = new Map<string, ConnectionProfileDto[]>();
    for (const profile of profiles) {
      const key = profile.folderId ?? UNGROUPED_KEY;
      const current = groups.get(key) ?? [];
      current.push(profile);
      groups.set(key, current);
    }

    for (const [key, items] of groups) {
      groups.set(
        key,
        [...items].sort((left, right) => left.sortOrder - right.sortOrder),
      );
    }

    return groups;
  }, [profiles]);
  const ungroupedProfiles = groupedProfiles.get(UNGROUPED_KEY) ?? [];
  const showUngroupedSection = ungroupedProfiles.length > 0;
  const showUngroupDropZone = !collapsed && draggingState?.type === "connection";

  const submitCreateFolder = async () => {
    const nextName = draftFolderName.trim();
    if (!nextName) {
      return;
    }
    await onCreateFolder(nextName);
    setDraftFolderName("");
    setCreatingFolder(false);
  };

  const submitRenameFolder = async () => {
    if (!editingFolderId) {
      return;
    }
    const nextName = editingFolderName.trim();
    if (!nextName) {
      return;
    }
    await onRenameFolder(editingFolderId, nextName);
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  return (
    <aside className={cn("connection-sidebar", collapsed && "is-collapsed")}>
      <button
        type="button"
        className={cn("connection-sidebar-edge-toggle", collapsed && "is-collapsed")}
        onClick={onToggleCollapsed}
        aria-label={collapsed ? t("button.expandSidebar") : t("button.collapseSidebar")}
        title={collapsed ? t("button.expandSidebar") : t("button.collapseSidebar")}
      >
        {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
      </button>

      <div className="connection-sidebar-header">
        {!collapsed ? (
          <div>
            <div className="connection-sidebar-title">{t("connections.sidebarTitle")}</div>
          </div>
        ) : null}
        {!collapsed ? (
          <div className="connection-sidebar-actions">
            <>
              <Button
                size="icon"
                variant="ghost"
                title={t("button.newFolder")}
                onClick={() => {
                  setCreatingFolder(true);
                  setEditingFolderId(null);
                  setDraftFolderName("");
                }}
              >
                <FolderPlus className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title={t("button.new")}
                onClick={() => onCreateConnection(null)}
              >
                <Plus className="size-4" />
              </Button>
            </>
          </div>
        ) : null}
      </div>

      {!collapsed && creatingFolder ? (
        <div className="connection-sidebar-folder-input">
          <Input
            autoFocus
            placeholder={t("connections.folderPlaceholder")}
            value={draftFolderName}
            onChange={(event) => setDraftFolderName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void submitCreateFolder();
              }
              if (event.key === "Escape") {
                setCreatingFolder(false);
                setDraftFolderName("");
              }
            }}
          />
        </div>
      ) : null}

      {!collapsed ? (
        <div className="scrollbar-thin connection-sidebar-scroll">
          <div className="connection-sidebar-sections">
            {orderedFolders.map((folder) => {
              const items = groupedProfiles.get(folder.id) ?? [];
              const expanded = expandedFolderIds.includes(folder.id);
              const isEditing = editingFolderId === folder.id;

              return (
                <section
                  key={folder.id}
                  className="connection-folder"
                  draggable
                  onDragStart={() => onDragStart({ type: "folder", id: folder.id })}
                  onDragEnd={onDragEnd}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    void handleFolderDrop({
                      targetFolderId: folder.id,
                      draggingState,
                      orderedFolders,
                      groupedProfiles,
                      profiles,
                      onReorderFolders,
                      onReorderConnections,
                    });
                    onDragEnd();
                  }}
                >
                  <div className="connection-folder-header">
                    {isEditing ? (
                      <div className="connection-folder-toggle">
                        <FolderTree className="size-4" />
                        <Input
                          autoFocus
                          value={editingFolderName}
                          onChange={(event) => setEditingFolderName(event.currentTarget.value)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              void submitRenameFolder();
                            }
                            if (event.key === "Escape") {
                              setEditingFolderId(null);
                              setEditingFolderName("");
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        className="connection-folder-toggle"
                        type="button"
                        onClick={() => onToggleFolder(folder.id)}
                      >
                        {expanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                        <FolderTree className="size-4" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    )}

                    <div className="connection-folder-actions">
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t("button.new")}
                        onClick={() => onCreateConnection(folder.id)}
                      >
                        <Plus className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t("button.renameFolder")}
                        onClick={() => {
                          setEditingFolderId(folder.id);
                          setEditingFolderName(folder.name);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={t("button.deleteFolder")}
                        onClick={() => {
                          if (window.confirm(t("connections.deleteFolderConfirm"))) {
                            void onRemoveFolder(folder.id);
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="connection-folder-body">
                      {items.map((profile) => (
                        <ConnectionRow
                          key={profile.id}
                          profile={profile}
                          runtime={runtime[profile.id]}
                          active={profile.id === activeConnectionId}
                          pendingConnectionIds={pendingConnectionIds}
                          activeStatus={activeStatus}
                          onSelect={onSelectConnection}
                          onEdit={onEditConnection}
                          onRemove={onRemoveConnection}
                          onConnectActive={onConnectActive}
                          onDisconnectActive={onDisconnectActive}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                          onDropBefore={async (targetConnectionId, targetFolderId) => {
                            await onReorderConnections(
                              buildConnectionReorder({
                                profiles,
                                groupedProfiles,
                                draggingState:
                                  draggingState?.type === "connection" ? draggingState : null,
                                targetFolderId,
                                targetConnectionId,
                              }),
                            );
                          }}
                        />
                      ))}
                      {items.length === 0 ? (
                        <button
                          className="connection-folder-empty"
                          type="button"
                          onClick={() => onCreateConnection(folder.id)}
                        >
                          {t("connections.emptyFolder")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}

            {showUngroupedSection ? (
              <section className="connection-ungrouped">
                <div className="connection-folder-body">
                  {ungroupedProfiles.map((profile) => (
                    <ConnectionRow
                      key={profile.id}
                      profile={profile}
                      runtime={runtime[profile.id]}
                      active={profile.id === activeConnectionId}
                      pendingConnectionIds={pendingConnectionIds}
                      activeStatus={activeStatus}
                      onSelect={onSelectConnection}
                      onEdit={onEditConnection}
                      onRemove={onRemoveConnection}
                      onConnectActive={onConnectActive}
                      onDisconnectActive={onDisconnectActive}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onDropBefore={async (targetConnectionId, targetFolderId) => {
                        await onReorderConnections(
                          buildConnectionReorder({
                            profiles,
                            groupedProfiles,
                            draggingState:
                              draggingState?.type === "connection" ? draggingState : null,
                            targetFolderId,
                            targetConnectionId,
                          }),
                        );
                      }}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {showUngroupDropZone ? (
              <button
                className="connection-ungroup-dropzone"
                type="button"
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggingState?.type !== "connection") {
                    onDragEnd();
                    return;
                  }
                  void onReorderConnections(
                    buildConnectionReorder({
                      profiles,
                      groupedProfiles,
                      draggingState,
                      targetFolderId: null,
                    }),
                  );
                  onDragEnd();
                }}
              >
                {t("connections.dropToUngroup")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function ConnectionRow({
  profile,
  runtime,
  active,
  pendingConnectionIds,
  activeStatus,
  onSelect,
  onEdit,
  onRemove,
  onConnectActive,
  onDisconnectActive,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  profile: ConnectionProfileDto;
  runtime?: ConnectionRuntimeState;
  active: boolean;
  pendingConnectionIds: string[];
  activeStatus: ConnectionRuntimeState["status"];
  onSelect: (connectionId: string) => void;
  onEdit: (connectionId: string) => void;
  onRemove: (connectionId: string) => void;
  onConnectActive: () => Promise<void>;
  onDisconnectActive: () => Promise<void>;
  onDragStart: (
    draggingState: {
      type: "connection";
      id: string;
      sourceFolderId?: string | null;
    },
  ) => void;
  onDragEnd: () => void;
  onDropBefore: (targetConnectionId: string, targetFolderId?: string | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const isPendingConnection =
    active && pendingConnectionIds.includes(profile.id) && activeStatus !== "connected";
  const connectionActionState = getConnectionActionState(
    active,
    activeStatus,
    isPendingConnection,
  );
  const connectionAction = getConnectionAction(connectionActionState, t);
  const canToggleConnection = active && connectionActionState !== "connecting";

  return (
    <button
      className={cn("connection-row", active && "is-active")}
      type="button"
      data-action-state={connectionActionState}
      draggable
      onClick={() => onSelect(profile.id)}
      onDragStart={() =>
        onDragStart({
          type: "connection",
          id: profile.id,
          sourceFolderId: profile.folderId ?? null,
        })
      }
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        void onDropBefore(profile.id, profile.folderId ?? null);
        onDragEnd();
      }}
    >
      <div className="connection-row-main">
        <div className="connection-row-heading">
          <span className="desktop-dot" data-tone={statusTone(runtime?.status)} />
          <span className="truncate">{profile.name}</span>
        </div>
        <div className="connection-row-caption mono">
          {profile.host}:{profile.port}
        </div>
      </div>
      <div className="connection-row-actions">
        {active ? (
          <Button
            size="icon"
            variant={connectionAction.variant}
            className="connection-row-action-button"
            data-state={connectionActionState}
            title={connectionAction.title}
            aria-label={connectionAction.title}
            onClick={(event) => {
              event.stopPropagation();
              void (connectionActionState === "connected" ? onDisconnectActive() : onConnectActive());
            }}
            disabled={!canToggleConnection}
          >
            {connectionActionState === "connecting" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : connectionActionState === "connected" ? (
              <Power className="size-3.5" />
            ) : connectionActionState === "error" ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <Plug className="size-3.5" />
            )}
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="connection-row-action-button"
          title={t("button.editConnection")}
          onClick={(event) => {
            event.stopPropagation();
            onEdit(profile.id);
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="connection-row-action-button"
          title={t("button.deleteConnection")}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(profile.id);
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </button>
  );
}

function statusTone(status?: ConnectionRuntimeState["status"]) {
  if (status === "connected") {
    return "connected";
  }
  if (status === "connecting" || status === "reconnecting") {
    return "warning";
  }
  if (status === "error") {
    return "error";
  }
  return "idle";
}

function getConnectionActionState(
  active: boolean,
  activeStatus: ConnectionRuntimeState["status"],
  isPendingConnection: boolean,
) {
  if (!active) {
    return "idle" as const;
  }
  if (activeStatus === "connected") {
    return "connected" as const;
  }
  if (activeStatus === "connecting" || isPendingConnection) {
    return "connecting" as const;
  }
  if (activeStatus === "error") {
    return "error" as const;
  }
  return "idle" as const;
}

function getConnectionAction(
  state: ReturnType<typeof getConnectionActionState>,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (state === "connected") {
    return {
      label: t("titlebar.disconnect"),
      title: t("titlebar.disconnect"),
      variant: "ghost" as const,
    };
  }

  if (state === "connecting") {
    return {
      label: t("status.connecting"),
      title: t("toast.connecting"),
      variant: "ghost" as const,
    };
  }

  if (state === "error") {
    return {
      label: t("button.retry"),
      title: t("button.retry"),
      variant: "ghost" as const,
    };
  }

  return {
    label: t("titlebar.connect"),
    title: t("titlebar.connect"),
    variant: "ghost" as const,
  };
}

function handleFolderDrop({
  targetFolderId,
  draggingState,
  orderedFolders,
  groupedProfiles,
  profiles,
  onReorderFolders,
  onReorderConnections,
}: {
  targetFolderId: string;
  draggingState:
    | {
        type: "folder";
        id: string;
      }
    | {
        type: "connection";
        id: string;
        sourceFolderId?: string | null;
      }
    | null;
  orderedFolders: ConnectionFolderDto[];
  groupedProfiles: Map<string, ConnectionProfileDto[]>;
  profiles: ConnectionProfileDto[];
  onReorderFolders: (folderIds: string[]) => Promise<void>;
  onReorderConnections: (items: ConnectionReorderItem[]) => Promise<void>;
}) {
  if (!draggingState) {
    return Promise.resolve();
  }

  if (draggingState.type === "folder") {
    const folderIds = moveItemBefore(
      orderedFolders.map((folder) => folder.id),
      draggingState.id,
      targetFolderId,
    );
    return onReorderFolders(folderIds);
  }

  return onReorderConnections(
    buildConnectionReorder({
      profiles,
      groupedProfiles,
      draggingState,
      targetFolderId,
    }),
  );
}

function buildConnectionReorder({
  profiles,
  groupedProfiles,
  draggingState,
  targetFolderId,
  targetConnectionId,
}: {
  profiles: ConnectionProfileDto[];
  groupedProfiles: Map<string, ConnectionProfileDto[]>;
  draggingState:
    | {
        type: "connection";
        id: string;
        sourceFolderId?: string | null;
      }
    | null;
  targetFolderId?: string | null;
  targetConnectionId?: string;
}) {
  if (!draggingState || draggingState.type !== "connection") {
    return [];
  }

  const nextGroups = new Map<string, ConnectionProfileDto[]>();
  for (const [key, items] of groupedProfiles.entries()) {
    nextGroups.set(
      key,
      items.filter((item) => item.id !== draggingState.id),
    );
  }

  const dragged = profiles.find((profile) => profile.id === draggingState.id);
  if (!dragged) {
    return [];
  }

  const targetKey = targetFolderId ?? UNGROUPED_KEY;
  const targetItems = [...(nextGroups.get(targetKey) ?? [])];
  const insertIndex = targetConnectionId
    ? Math.max(
        0,
        targetItems.findIndex((item) => item.id === targetConnectionId),
      )
    : targetItems.length;

  targetItems.splice(insertIndex, 0, {
    ...dragged,
    folderId: targetFolderId ?? null,
  });
  nextGroups.set(targetKey, targetItems);

  const items: ConnectionReorderItem[] = [];
  for (const [key, group] of nextGroups.entries()) {
    group.forEach((profile, index) => {
      items.push({
        connectionId: profile.id,
        folderId: key === UNGROUPED_KEY ? null : key,
        sortOrder: index,
      });
    });
  }

  return items;
}

function moveItemBefore(items: string[], sourceId: string, targetId: string) {
  const next = items.filter((item) => item !== sourceId);
  const targetIndex = next.findIndex((item) => item === targetId);
  if (targetIndex === -1) {
    next.push(sourceId);
    return next;
  }
  next.splice(targetIndex, 0, sourceId);
  return next;
}
