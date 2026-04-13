export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type TlsMode = "disabled" | "server_ca" | "mutual";

export interface ConnectionFolderDto {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectionProfileDto {
  id: string;
  name: string;
  host: string;
  port: number;
  clientId: string;
  protocol: "mqtt";
  cleanSession: boolean;
  keepAliveSecs: number;
  autoReconnect: boolean;
  connectTimeoutMs: number;
  useTls: boolean;
  tlsMode: TlsMode;
  folderId?: string | null;
  sortOrder: number;
  caCertPath?: string | null;
  clientCertPath?: string | null;
  clientKeyPath?: string | null;
  lastConnectedAt?: number | null;
  lastUsedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectionSecretDto {
  connectionId: string;
  username?: string | null;
  password?: string | null;
  passphrase?: string | null;
}

export interface ConnectionProfileInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  clientId: string;
  username?: string;
  password?: string;
  passphrase?: string;
  cleanSession: boolean;
  keepAliveSecs: number;
  autoReconnect: boolean;
  connectTimeoutMs: number;
  useTls: boolean;
  tlsMode: TlsMode;
  folderId?: string | null;
  sortOrder?: number;
  caCertPath?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
}

export interface ConnectionReorderItem {
  connectionId: string;
  folderId?: string | null;
  sortOrder: number;
}

export interface ConnectionRuntimeState {
  status: ConnectionStatus;
  lastError?: string | null;
}
