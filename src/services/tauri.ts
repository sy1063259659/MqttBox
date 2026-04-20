import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LocalePreference } from "@/lib/locale";
import type { AgentEvent } from "@agent-contracts";

import type {
  ConnectionFolderDto,
  ConnectionProfileDto,
  ConnectionProfileInput,
  ConnectionReorderItem,
  ConnectionSecretDto,
} from "@/features/connections/types";
import type {
  AgentContextDto,
  LegacyAgentStatusEvent,
} from "@/features/agent/types";
import type {
  ExportRequest,
  MessageFilter,
  MessageHistoryPageDto,
  PublishRequest,
} from "@/features/messages/types";
import type {
  MessageParserDto,
  MessageParserInput,
  MessageParserTestRequest,
  MessageParserTestResultDto,
} from "@/features/parsers/types";
import type { SubscriptionDto, SubscriptionInput } from "@/features/subscriptions/types";

export interface AppSettingsDto {
  activeConnectionId?: string | null;
  messageHistoryLimitPerConnection: number;
  autoScrollMessages: boolean;
  timestampFormat: string;
  theme: "graphite" | "midnight";
  locale: LocalePreference;
}

export interface AgentSettingsDto {
  enabled: boolean;
  provider: "openai";
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: "responses" | "chat_completions";
}

export const defaultAgentSettings: AgentSettingsDto = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-5.4",
  protocol: "responses",
};

export interface ConnectionTestResultDto {
  ok: boolean;
  message: string;
  latencyMs: number;
}

export interface ConnectionEventPayload {
  connectionId: string;
  status: string;
  message?: string | null;
}

export type AgentEventPayload = LegacyAgentStatusEvent | AgentEvent;

let cachedAppSettings: AppSettingsDto | null = null;
let cachedAgentSettings: AgentSettingsDto | null = null;

export function normalizeAgentSettings(
  settings?: Partial<AgentSettingsDto> | null,
): AgentSettingsDto {
  return {
    enabled:
      typeof settings?.enabled === "boolean"
        ? settings.enabled
        : defaultAgentSettings.enabled,
    provider:
      settings?.provider === "openai"
        ? settings.provider
        : defaultAgentSettings.provider,
    baseUrl:
      typeof settings?.baseUrl === "string" && settings.baseUrl.trim().length > 0
        ? settings.baseUrl
        : defaultAgentSettings.baseUrl,
    apiKey:
      typeof settings?.apiKey === "string"
        ? settings.apiKey
        : defaultAgentSettings.apiKey,
    model:
      typeof settings?.model === "string" && settings.model.trim().length > 0
        ? settings.model
        : defaultAgentSettings.model,
    protocol:
      settings?.protocol === "chat_completions" || settings?.protocol === "responses"
        ? settings.protocol
        : defaultAgentSettings.protocol,
  };
}

export function hasValidAgentModelConfig(
  settings?: Partial<AgentSettingsDto> | null,
): boolean {
  const normalized = normalizeAgentSettings(settings);
  return (
    normalized.provider === "openai" &&
    normalized.baseUrl.trim().length > 0 &&
    normalized.apiKey.trim().length > 0 &&
    normalized.model.trim().length > 0
  );
}

export async function listConnections() {
  return invoke<ConnectionProfileDto[]>("list_connections");
}

export async function pickCertificateFile() {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [
      {
        name: "Certificates",
        extensions: ["pem", "crt", "cer", "key", "der", "p12", "pfx"],
      },
    ],
  });

  if (Array.isArray(selected)) {
    return selected[0] ?? null;
  }

  return selected;
}

export async function listConnectionFolders() {
  return invoke<ConnectionFolderDto[]>("list_connection_folders");
}

export async function getConnectionSecret(connectionId: string) {
  return invoke<ConnectionSecretDto | null>("get_connection_secret", { connectionId });
}

export async function createConnection(profile: ConnectionProfileInput) {
  return invoke<ConnectionProfileDto>("create_connection", { profile });
}

export async function updateConnection(profile: ConnectionProfileInput) {
  return invoke<ConnectionProfileDto>("update_connection", { profile });
}

export async function createConnectionFolder(name: string) {
  return invoke<ConnectionFolderDto>("create_connection_folder", { name });
}

export async function updateConnectionFolder(folderId: string, name: string) {
  return invoke<ConnectionFolderDto>("update_connection_folder", { folderId, name });
}

export async function deleteConnectionFolder(folderId: string) {
  return invoke<void>("delete_connection_folder", { folderId });
}

export async function reorderConnectionFolders(folderIds: string[]) {
  return invoke<void>("reorder_connection_folders", { folderIds });
}

export async function reorderConnections(items: ConnectionReorderItem[]) {
  return invoke<void>("reorder_connections", { items });
}

export async function testConnection(profile: ConnectionProfileInput) {
  return invoke<ConnectionTestResultDto>("test_connection", { profile });
}

export async function connectBroker(connectionId: string) {
  return invoke<void>("connect_broker", { connectionId });
}

export async function disconnectBroker(connectionId: string) {
  return invoke<void>("disconnect_broker", { connectionId });
}

export async function removeConnection(connectionId: string) {
  return invoke<void>("remove_connection", { connectionId });
}

export async function listSubscriptions(connectionId?: string) {
  return invoke<SubscriptionDto[]>("list_subscriptions", { connectionId });
}

export async function subscribeTopics(connectionId: string, subscriptions: SubscriptionInput[]) {
  return invoke<SubscriptionDto[]>("subscribe_topics", { connectionId, subscriptions });
}

export async function unsubscribeTopics(connectionId: string, subscriptionIds: string[]) {
  return invoke<void>("unsubscribe_topics", { connectionId, subscriptionIds });
}

export async function setSubscriptionEnabled(
  connectionId: string,
  subscriptionId: string,
  enabled: boolean,
) {
  return invoke<SubscriptionDto>("set_subscription_enabled", {
    connectionId,
    subscriptionId,
    enabled,
  });
}

export async function listMessageParsers() {
  return invoke<MessageParserDto[]>("list_message_parsers");
}

export async function saveMessageParser(parser: MessageParserInput) {
  return invoke<MessageParserDto>("save_message_parser", { input: parser });
}

export async function removeMessageParser(parserId: string) {
  return invoke<void>("remove_message_parser", { parserId });
}

export async function testMessageParser(request: MessageParserTestRequest) {
  return invoke<MessageParserTestResultDto>("test_message_parser", { request });
}

export async function publishMessage(request: PublishRequest) {
  return invoke<void>("publish_message", { request });
}

export async function loadMessageHistory(connectionId: string, filter?: Partial<MessageFilter>) {
  return invoke<MessageHistoryPageDto>("load_message_history", {
    connectionId,
    filter: {
      keyword: filter?.keyword ?? "",
      topic: filter?.topic ?? "",
      direction: filter?.direction ?? "all",
      limit: filter?.limit ?? 200,
      offset: filter?.offset ?? 0,
    },
  });
}

export async function clearMessageHistory(connectionId: string) {
  return invoke<void>("clear_message_history", { connectionId });
}

export async function exportMessages(request: ExportRequest) {
  return invoke<void>("export_messages", { request });
}

export async function getAgentContext(connectionId?: string) {
  return invoke<AgentContextDto>("get_agent_context", { connectionId });
}

export async function getAppSettings() {
  const settings = await invoke<AppSettingsDto>("get_app_settings");
  cachedAppSettings = settings;
  return settings;
}

export async function getAgentSettings() {
  const settings = normalizeAgentSettings(await invoke<AgentSettingsDto>("get_agent_settings"));
  cachedAgentSettings = settings;
  return settings;
}

export async function saveAppSettings(settings: AppSettingsDto) {
  await invoke<void>("save_app_settings", { settings });
  cachedAppSettings = settings;
}

export async function saveAgentSettings(settings: AgentSettingsDto) {
  await invoke<void>("save_agent_settings", { settings });
  cachedAgentSettings = normalizeAgentSettings(settings);
}

export function peekCachedAppSettings() {
  return cachedAppSettings;
}

export function peekCachedAgentSettings() {
  return cachedAgentSettings ? normalizeAgentSettings(cachedAgentSettings) : null;
}

export async function updateAppSettings(patch: Partial<AppSettingsDto>) {
  const current = await getAppSettings();
  const next = {
    ...current,
    ...patch,
  };

  await saveAppSettings(next);
  cachedAppSettings = next;
  return next;
}
