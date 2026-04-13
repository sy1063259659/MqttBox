import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createConnectionProfileSchema, type ConnectionProfileFormValues } from "@/features/connections/schema";
import type {
  ConnectionProfileDto,
  ConnectionProfileInput,
  ConnectionSecretDto,
} from "@/features/connections/types";
import { useI18n } from "@/lib/i18n";
import { pickCertificateFile } from "@/services/tauri";

const defaultValues: ConnectionProfileFormValues = {
  name: "",
  host: "broker.emqx.io",
  port: 1883,
  clientId: `mqttbox-${Math.random().toString(16).slice(2, 8)}`,
  username: "",
  password: "",
  passphrase: "",
  cleanSession: true,
  keepAliveSecs: 30,
  autoReconnect: true,
  connectTimeoutMs: 10000,
  useTls: false,
  tlsMode: "disabled",
  caCertPath: "",
  clientCertPath: "",
  clientKeyPath: "",
};

interface ConnectionEditorProps {
  profile?: ConnectionProfileDto;
  secret?: ConnectionSecretDto | null;
  defaultFolderId?: string | null;
  onSave: (profile: ConnectionProfileInput) => Promise<void>;
  onTest: (profile: ConnectionProfileInput) => Promise<{ message: string; latencyMs: number }>;
}

export function ConnectionEditor({
  profile,
  secret,
  defaultFolderId,
  onSave,
  onTest,
}: ConnectionEditorProps) {
  const { t } = useI18n();
  const schema = useMemo(() => createConnectionProfileSchema(t), [t]);
  const form = useForm<ConnectionProfileFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    form.reset({
      id: profile?.id,
      folderId: profile?.folderId ?? defaultFolderId ?? null,
      sortOrder: profile?.sortOrder,
      name: profile?.name ?? defaultValues.name,
      host: profile?.host ?? defaultValues.host,
      port: profile?.port ?? defaultValues.port,
      clientId: profile?.clientId ?? defaultValues.clientId,
      username: secret?.username ?? "",
      password: secret?.password ?? "",
      passphrase: secret?.passphrase ?? "",
      cleanSession: profile?.cleanSession ?? true,
      keepAliveSecs: profile?.keepAliveSecs ?? 30,
      autoReconnect: profile?.autoReconnect ?? true,
      connectTimeoutMs: profile?.connectTimeoutMs ?? 10000,
      useTls: profile?.useTls ?? false,
      tlsMode: profile?.tlsMode ?? "disabled",
      caCertPath: profile?.caCertPath ?? "",
      clientCertPath: profile?.clientCertPath ?? "",
      clientKeyPath: profile?.clientKeyPath ?? "",
    });
    setFormError(null);
  }, [defaultFolderId, form, profile, secret]);

  useEffect(() => {
    const subscription = form.watch(() => {
      setFormError(null);
    });

    return () => subscription.unsubscribe();
  }, [form]);

  const errors = form.formState.errors;
  const useTls = form.watch("useTls");
  const hostPreview = form.watch("host");
  const portPreview = form.watch("port");

  return (
    <section className="connection-editor-shell">
      <div className="connection-editor-head">
        <div className="connection-editor-summary">
          <div className="desktop-title text-foreground">
            {profile ? t("connectionEditor.title.edit") : t("connectionEditor.title.new")}
          </div>
          <div className="connection-editor-endpoint mono">
            {hostPreview || "broker.emqx.io"}:{portPreview || 1883}
          </div>
        </div>
        <div className="connection-editor-head-actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={form.handleSubmit(async (values) => {
              try {
                await onTest({
                  ...values,
                  username: values.username || undefined,
                  password: values.password || undefined,
                  passphrase: values.passphrase || undefined,
                  caCertPath: values.caCertPath || undefined,
                  clientCertPath: values.clientCertPath || undefined,
                  clientKeyPath: values.clientKeyPath || undefined,
                });
              } catch (error) {
                setFormError(error instanceof Error ? error.message : t("toast.operationFailed"));
              }
            })}
          >
            {t("button.test")}
          </Button>
          <Button
            size="sm"
            onClick={form.handleSubmit(async (values) => {
              try {
                await onSave({
                  ...values,
                  username: values.username || undefined,
                  password: values.password || undefined,
                  passphrase: values.passphrase || undefined,
                  caCertPath: values.caCertPath || undefined,
                  clientCertPath: values.clientCertPath || undefined,
                  clientKeyPath: values.clientKeyPath || undefined,
                });
              } catch (error) {
                setFormError(error instanceof Error ? error.message : t("toast.operationFailed"));
              }
            })}
          >
            {profile ? t("button.save") : t("button.create")}
          </Button>
        </div>
      </div>

      {formError ? <div className="connection-editor-error">{formError}</div> : null}

      <div className="connection-editor-stack">
        <div className="connection-editor-section">
          <div className="connection-editor-section-label">Broker</div>
          <div className="connection-editor-grid">
            <Field label={t("connectionEditor.name")} error={errors.name?.message}>
              <Input {...form.register("name")} />
            </Field>
            <Field label={t("connectionEditor.clientId")} error={errors.clientId?.message}>
              <Input {...form.register("clientId")} />
            </Field>
            <Field label={t("connectionEditor.host")} error={errors.host?.message}>
              <Input {...form.register("host")} />
            </Field>
            <Field label={t("connectionEditor.port")} error={errors.port?.message}>
              <Input type="number" {...form.register("port", { valueAsNumber: true })} />
            </Field>
            <Field label={t("connectionEditor.username")}>
              <Input {...form.register("username")} />
            </Field>
            <Field label={t("connectionEditor.password")}>
              <Input type="password" {...form.register("password")} />
            </Field>
            <Field label={t("connectionEditor.keepAlive")}>
              <Input
                type="number"
                {...form.register("keepAliveSecs", { valueAsNumber: true })}
              />
            </Field>
            <Field label={t("connectionEditor.timeout")}>
              <Input
                type="number"
                {...form.register("connectTimeoutMs", { valueAsNumber: true })}
              />
            </Field>
          </div>
        </div>

        <div className="connection-editor-toggles desktop-subtle-panel">
          <label className="connection-editor-toggle">
            <input type="checkbox" {...form.register("cleanSession")} />
            {t("connectionEditor.cleanSession")}
          </label>
          <label className="connection-editor-toggle">
            <input type="checkbox" {...form.register("autoReconnect")} />
            {t("connectionEditor.autoReconnect")}
          </label>
          <label className="connection-editor-toggle">
            <input type="checkbox" {...form.register("useTls")} />
            {t("connectionEditor.useTls")}
          </label>
        </div>

        {useTls ? (
          <div className="connection-editor-section connection-editor-section--tls">
            <div className="connection-editor-section-label">TLS</div>
            <div className="connection-editor-grid">
              <Field label={t("connectionEditor.tlsMode")}>
                <Select {...form.register("tlsMode")}>
                  <option value="disabled">disabled</option>
                  <option value="server_ca">server_ca</option>
                  <option value="mutual">mutual</option>
                </Select>
              </Field>
              <Field label={t("connectionEditor.passphrase")}>
                <Input type="password" {...form.register("passphrase")} />
              </Field>
              <Field label={t("connectionEditor.caCertPath")} error={errors.caCertPath?.message}>
                <CertificateField
                  value={form.watch("caCertPath") ?? ""}
                  onChange={(value) =>
                    form.setValue("caCertPath", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              </Field>
              <Field
                label={t("connectionEditor.clientCertPath")}
                error={errors.clientCertPath?.message}
              >
                <CertificateField
                  value={form.watch("clientCertPath") ?? ""}
                  onChange={(value) =>
                    form.setValue("clientCertPath", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              </Field>
              <Field
                label={t("connectionEditor.clientKeyPath")}
                error={errors.clientKeyPath?.message}
                className="col-span-2"
              >
                <CertificateField
                  value={form.watch("clientKeyPath") ?? ""}
                  onChange={(value) =>
                    form.setValue("clientKeyPath", value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              </Field>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CertificateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [isPicking, setIsPicking] = useState(false);

  return (
    <div className="connection-editor-file-field">
      <Input value={value} onChange={(event) => onChange(event.currentTarget.value)} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPicking}
        onClick={async () => {
          setIsPicking(true);
          try {
            const path = await pickCertificateFile();
            if (path) {
              onChange(path);
            }
          } catch {
            // The surrounding form handles submission errors; picker failures should stay local.
          } finally {
            setIsPicking(false);
          }
        }}
      >
        <FolderOpen className="size-3.5" />
        {t("button.browse")}
      </Button>
    </div>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="connection-editor-field-label">
        <Label>{label}</Label>
      </div>
      {children}
      {error ? <div className="mt-1 text-[11px] text-[color:var(--error-fg)]">{error}</div> : null}
    </div>
  );
}
