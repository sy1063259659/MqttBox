import { create } from "zustand";

import type {
  ConnectionFolderDto,
  ConnectionProfileDto,
  ConnectionProfileInput,
  ConnectionReorderItem,
  ConnectionRuntimeState,
} from "@/features/connections/types";
import {
  connectBroker,
  createConnection,
  createConnectionFolder,
  deleteConnectionFolder,
  disconnectBroker,
  listConnectionFolders,
  listConnections,
  removeConnection,
  reorderConnectionFolders,
  reorderConnections as persistConnectionOrder,
  testConnection,
  updateAppSettings,
  updateConnection,
  updateConnectionFolder,
} from "@/services/tauri";

type DraggingState =
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

interface ConnectionStore {
  folders: ConnectionFolderDto[];
  profiles: ConnectionProfileDto[];
  activeConnectionId: string | null;
  runtime: Record<string, ConnectionRuntimeState>;
  pendingConnectionIds: string[];
  expandedFolderIds: string[];
  draggingState: DraggingState;
  isLoading: boolean;
  error: string | null;
  loadFolders: () => Promise<void>;
  loadProfiles: () => Promise<void>;
  saveProfile: (profile: ConnectionProfileInput) => Promise<ConnectionProfileDto>;
  testProfile: (profile: ConnectionProfileInput) => Promise<{ message: string; latencyMs: number }>;
  setActiveConnection: (connectionId: string | null) => Promise<void>;
  hydrateActiveConnection: (connectionId: string | null) => void;
  connect: (connectionId: string) => Promise<void>;
  disconnect: (connectionId: string) => Promise<void>;
  markConnectionPending: (connectionId: string) => void;
  clearConnectionPending: (connectionId: string) => void;
  remove: (connectionId: string) => Promise<void>;
  createFolder: (name: string) => Promise<ConnectionFolderDto>;
  renameFolder: (folderId: string, name: string) => Promise<ConnectionFolderDto>;
  removeFolder: (folderId: string) => Promise<void>;
  reorderFolders: (folderIds: string[]) => Promise<void>;
  reorderConnections: (items: ConnectionReorderItem[]) => Promise<void>;
  toggleFolderExpanded: (folderId: string) => void;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
  setDraggingState: (draggingState: DraggingState) => void;
  clearDraggingState: () => void;
  setRuntimeState: (
    connectionId: string,
    runtime: Partial<ConnectionRuntimeState>,
  ) => void;
}

function sortProfiles(profiles: ConnectionProfileDto[]) {
  return [...profiles].sort((left, right) => {
    const leftFolder = left.folderId ?? "";
    const rightFolder = right.folderId ?? "";

    if (leftFolder !== rightFolder) {
      return leftFolder.localeCompare(rightFolder);
    }

    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return left.name.localeCompare(right.name);
  });
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  folders: [],
  profiles: [],
  activeConnectionId: null,
  runtime: {},
  pendingConnectionIds: [],
  expandedFolderIds: [],
  draggingState: null,
  isLoading: false,
  error: null,
  async loadFolders() {
    set({ isLoading: true, error: null });
    try {
      const folders = await listConnectionFolders();
      set((state) => ({
        folders,
        expandedFolderIds: Array.from(
          new Set([...state.expandedFolderIds, ...folders.map((folder) => folder.id)]),
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to load folders",
      });
    }
  },
  async loadProfiles() {
    set({ isLoading: true, error: null });
    try {
      const profiles = sortProfiles(await listConnections());
      set((state) => ({
        profiles,
        activeConnectionId: state.activeConnectionId ?? profiles[0]?.id ?? null,
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to load connections",
      });
    }
  },
  async saveProfile(profile) {
    const saved = profile.id
      ? await updateConnection(profile)
      : await createConnection(profile);

    set((state) => ({
      profiles: sortProfiles([
        ...state.profiles.filter((item) => item.id !== saved.id),
        saved,
      ]),
      activeConnectionId: saved.id,
    }));

    return saved;
  },
  async testProfile(profile) {
    const result = await testConnection(profile);
    return {
      message: result.message,
      latencyMs: result.latencyMs,
    };
  },
  async setActiveConnection(connectionId) {
    set({ activeConnectionId: connectionId });
    await updateAppSettings({
      activeConnectionId: connectionId,
    });
  },
  hydrateActiveConnection(connectionId) {
    set({ activeConnectionId: connectionId });
  },
  async connect(connectionId) {
    get().setRuntimeState(connectionId, { status: "connecting", lastError: null });
    await connectBroker(connectionId);
  },
  async disconnect(connectionId) {
    try {
      await disconnectBroker(connectionId);
      get().setRuntimeState(connectionId, { status: "disconnected" });
    } finally {
      get().clearConnectionPending(connectionId);
    }
  },
  markConnectionPending(connectionId) {
    set((state) => ({
      pendingConnectionIds: state.pendingConnectionIds.includes(connectionId)
        ? state.pendingConnectionIds
        : [...state.pendingConnectionIds, connectionId],
    }));
  },
  clearConnectionPending(connectionId) {
    set((state) => ({
      pendingConnectionIds: state.pendingConnectionIds.filter((id) => id !== connectionId),
    }));
  },
  async remove(connectionId) {
    await removeConnection(connectionId);
    const removedActiveConnection = get().activeConnectionId === connectionId;
    const nextProfiles = get().profiles.filter((profile) => profile.id !== connectionId);
    const nextActiveConnectionId = removedActiveConnection
      ? nextProfiles[0]?.id ?? null
      : get().activeConnectionId;

    set({
      profiles: nextProfiles,
      activeConnectionId: nextActiveConnectionId,
    });

    if (removedActiveConnection) {
      await updateAppSettings({
        activeConnectionId: nextActiveConnectionId,
      });
    }
  },
  async createFolder(name) {
    const folder = await createConnectionFolder(name);
    set((state) => ({
      folders: [...state.folders, folder].sort((left, right) => left.sortOrder - right.sortOrder),
      expandedFolderIds: Array.from(new Set([...state.expandedFolderIds, folder.id])),
    }));
    return folder;
  },
  async renameFolder(folderId, name) {
    const updated = await updateConnectionFolder(folderId, name);
    set((state) => ({
      folders: state.folders.map((folder) => (folder.id === folderId ? updated : folder)),
    }));
    return updated;
  },
  async removeFolder(folderId) {
    await deleteConnectionFolder(folderId);
    set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== folderId),
      profiles: sortProfiles(
        state.profiles.map((profile) =>
          profile.folderId === folderId
            ? { ...profile, folderId: null }
            : profile,
        ),
      ),
      expandedFolderIds: state.expandedFolderIds.filter((id) => id !== folderId),
    }));
  },
  async reorderFolders(folderIds) {
    if (folderIds.length === 0) {
      return;
    }
    await reorderConnectionFolders(folderIds);
    set((state) => ({
      folders: folderIds
        .map((folderId, index) => {
          const folder = state.folders.find((item) => item.id === folderId);
          return folder ? { ...folder, sortOrder: index } : null;
        })
        .filter((folder): folder is ConnectionFolderDto => Boolean(folder)),
    }));
  },
  async reorderConnections(items) {
    if (items.length === 0) {
      return;
    }
    await persistConnectionOrder(items);
    set((state) => ({
      profiles: sortProfiles(
        state.profiles.map((profile) => {
          const updated = items.find((item) => item.connectionId === profile.id);
          return updated
            ? {
                ...profile,
                folderId: updated.folderId ?? null,
                sortOrder: updated.sortOrder,
              }
            : profile;
        }),
      ),
    }));
  },
  toggleFolderExpanded(folderId) {
    set((state) => ({
      expandedFolderIds: state.expandedFolderIds.includes(folderId)
        ? state.expandedFolderIds.filter((id) => id !== folderId)
        : [...state.expandedFolderIds, folderId],
    }));
  },
  setFolderExpanded(folderId, expanded) {
    set((state) => ({
      expandedFolderIds: expanded
        ? Array.from(new Set([...state.expandedFolderIds, folderId]))
        : state.expandedFolderIds.filter((id) => id !== folderId),
    }));
  },
  setDraggingState(draggingState) {
    set({ draggingState });
  },
  clearDraggingState() {
    set({ draggingState: null });
  },
  setRuntimeState(connectionId, runtime) {
    set((state) => {
      const currentRuntime =
        state.runtime[connectionId] ??
        ({
          status: "idle",
          lastError: null,
        } satisfies ConnectionRuntimeState);

      return {
        runtime: {
          ...state.runtime,
          [connectionId]: {
            ...currentRuntime,
            ...runtime,
          },
        },
        pendingConnectionIds:
          runtime.status === "connected" ||
          runtime.status === "disconnected" ||
          runtime.status === "error"
            ? state.pendingConnectionIds.filter((id) => id !== connectionId)
            : state.pendingConnectionIds,
      };
    });
  },
}));
