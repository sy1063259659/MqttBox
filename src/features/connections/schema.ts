import { z } from "zod";
import type { Translator } from "@/lib/i18n";

export function createConnectionProfileSchema(t: Translator) {
  return z
    .object({
      id: z.string().optional(),
      folderId: z.string().nullable().optional(),
      sortOrder: z.number().optional(),
      name: z.string().min(2, t("schema.connectionNameMin")),
      host: z.string().min(2, t("schema.hostRequired")),
      port: z.number().min(1).max(65535),
      clientId: z.string().min(2, t("schema.clientIdRequired")),
      username: z.string().optional().or(z.literal("")),
      password: z.string().optional().or(z.literal("")),
      passphrase: z.string().optional().or(z.literal("")),
      cleanSession: z.boolean(),
      keepAliveSecs: z.number().min(5).max(3600),
      autoReconnect: z.boolean(),
      connectTimeoutMs: z.number().min(1000).max(60000),
      useTls: z.boolean(),
      tlsMode: z.enum(["disabled", "server_ca", "mutual"]),
      caCertPath: z.string().optional().or(z.literal("")),
      clientCertPath: z.string().optional().or(z.literal("")),
      clientKeyPath: z.string().optional().or(z.literal("")),
    })
    .superRefine((values, context) => {
      if (!values.useTls) {
        return;
      }

      if (values.tlsMode === "server_ca" || values.tlsMode === "mutual") {
        if (!values.caCertPath?.trim()) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["caCertPath"],
            message: t("schema.caCertRequired"),
          });
        }
      }

      if (values.tlsMode === "mutual") {
        if (!values.clientCertPath?.trim()) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["clientCertPath"],
            message: t("schema.clientCertRequired"),
          });
        }

        if (!values.clientKeyPath?.trim()) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["clientKeyPath"],
            message: t("schema.clientKeyRequired"),
          });
        }
      }
    });
}

export interface ConnectionProfileFormValues {
  id?: string;
  folderId?: string | null;
  sortOrder?: number;
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
  tlsMode: "disabled" | "server_ca" | "mutual";
  caCertPath?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
}
