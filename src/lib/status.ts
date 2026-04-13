import type { ConnectionStatus } from "@/features/connections/types";
import type { Translator } from "@/lib/i18n";

function fallbackStatusLabel(status: ConnectionStatus) {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export function getStatusBadgeVariant(status: ConnectionStatus) {
  switch (status) {
    case "connected":
      return "success";
    case "reconnecting":
    case "connecting":
      return "warning";
    case "error":
      return "error";
    default:
      return "outline";
  }
}

export function getStatusLabel(status: ConnectionStatus, t?: Translator) {
  if (!t) {
    return fallbackStatusLabel(status);
  }

  switch (status) {
    case "connected":
      return t("status.connected");
    case "connecting":
      return t("status.connecting");
    case "reconnecting":
      return t("status.reconnecting");
    case "disconnected":
      return t("status.disconnected");
    case "error":
      return t("status.error");
    default:
      return t("status.idle");
  }
}
