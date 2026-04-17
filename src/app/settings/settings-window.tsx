import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { I18nProvider, useI18n } from "@/lib/i18n";
import {
  getAgentServiceHealth,
  isAgentServiceUnreachableError,
  syncAgentServiceConfig,
} from "@/services/agent-service";
import { closeCurrentWindow } from "@/services/window";
import {
  defaultAgentSettings,
  getAgentSettings,
  hasValidAgentModelConfig,
  normalizeAgentSettings,
  peekCachedAppSettings,
  peekCachedAgentSettings,
  saveAgentSettings,
  saveAppSettings,
  type AgentSettingsDto,
  type AppSettingsDto,
} from "@/services/tauri";

const defaultSettings: AppSettingsDto = {
  activeConnectionId: null,
  messageHistoryLimitPerConnection: 5000,
  autoScrollMessages: true,
  timestampFormat: "datetime",
  theme: "graphite",
  locale: "system",
};

interface SettingsViewProps {
  initialSettings: AppSettingsDto;
  onClose: () => void;
  onSaved?: (settings: AppSettingsDto) => void | Promise<void>;
  standalone?: boolean;
}

export function SettingsView({
  initialSettings,
  onClose,
  onSaved,
  standalone = false,
}: SettingsViewProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettingsDto>(initialSettings);
  const [agentSettings, setAgentSettings] = useState<AgentSettingsDto>(
    () => normalizeAgentSettings(peekCachedAgentSettings() ?? defaultAgentSettings),
  );
  const [savedAgentSettings, setSavedAgentSettings] = useState<AgentSettingsDto>(
    () => normalizeAgentSettings(peekCachedAgentSettings() ?? defaultAgentSettings),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingAgent, setIsCheckingAgent] = useState(false);
  const [agentHealth, setAgentHealth] = useState<string | null>(null);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    void getAgentSettings()
      .then((next) => {
        const normalized = normalizeAgentSettings(next);
        setAgentSettings(normalized);
        setSavedAgentSettings(normalized);
      })
      .catch(() => {
        const normalized = normalizeAgentSettings(peekCachedAgentSettings() ?? defaultAgentSettings);
        setAgentSettings(normalized);
        setSavedAgentSettings(normalized);
      });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const handleClose = () => {
    document.documentElement.dataset.theme = initialSettings.theme;
    onClose();
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      const shouldAutoEnableOnFirstValidSave =
        !hasValidAgentModelConfig(savedAgentSettings) &&
        hasValidAgentModelConfig(agentSettings) &&
        !agentSettings.enabled;
      const nextAgentSettings = normalizeAgentSettings({
        ...agentSettings,
        enabled: shouldAutoEnableOnFirstValidSave ? true : agentSettings.enabled,
      });

      await saveAppSettings(settings);
      await saveAgentSettings(nextAgentSettings);
      let localOnlyMessage: string | null = null;

      try {
        await syncAgentServiceConfig(nextAgentSettings);
        setAgentHealth(null);
      } catch (error) {
        if (!isAgentServiceUnreachableError(error)) {
          throw error;
        }
        localOnlyMessage = t("settings.agentStatus.localServiceRequired");
        setAgentHealth(localOnlyMessage);
      }
      setAgentSettings(nextAgentSettings);
      setSavedAgentSettings(nextAgentSettings);
      document.documentElement.dataset.theme = settings.theme;
      await onSaved?.(settings);
      toast.success(localOnlyMessage ? t("toast.settingsSavedLocalOnly") : t("toast.settingsSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.settingsSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const checkAgentHealth = async () => {
    setIsCheckingAgent(true);
    try {
      const health = await getAgentServiceHealth();
      const modelState = !health.model?.enabled
        ? t("settings.agentStatus.disabled")
        : !health.model.configured
          ? t("settings.agentStatus.missingKey")
          : t("settings.agentStatus.ready");
      const status = `${modelState} · ${health.deepagentsRuntime} · ${health.model?.model ?? agentSettings.model}`;
      setAgentHealth(status);
      toast.success(t("toast.agentHealthChecked"));
    } catch (error) {
      const message = isAgentServiceUnreachableError(error)
        ? t("settings.agentStatus.localServiceRequired")
        : error instanceof Error
          ? error.message
          : t("settings.agentStatus.unreachable");
      setAgentHealth(message);
      toast.error(message);
    } finally {
      setIsCheckingAgent(false);
    }
  };

  return (
    <main className={cn("settings-window", standalone ? "settings-window--standalone" : "settings-window--modal")}>
      <section className="settings-card">
        <div className="settings-card-header">
          <h1>{t("settings.appearance")}</h1>
        </div>
        <div className="settings-grid">
          <div>
            <Label>{t("settings.theme")}</Label>
            <Select
              value={settings.theme}
              onChange={(event) => {
                const nextTheme = event.currentTarget.value as AppSettingsDto["theme"];
                setSettings((current) => ({
                  ...current,
                  theme: nextTheme,
                }));
              }}
            >
              <option value="graphite">{t("theme.graphite")}</option>
              <option value="midnight">{t("theme.midnight")}</option>
            </Select>
          </div>
          <div>
            <Label>{t("settings.timestamp")}</Label>
            <Select
              value={settings.timestampFormat}
              onChange={(event) => {
                const nextTimestampFormat = event.currentTarget.value;
                setSettings((current) => ({
                  ...current,
                  timestampFormat: nextTimestampFormat,
                }));
              }}
            >
              <option value="datetime">{t("timestamp.datetime")}</option>
              <option value="time">{t("timestamp.time")}</option>
            </Select>
          </div>
          <div>
            <Label>{t("settings.language")}</Label>
            <Select
              value={settings.locale}
              onChange={(event) => {
                const nextLocale = event.currentTarget.value as AppSettingsDto["locale"];
                setSettings((current) => ({
                  ...current,
                  locale: nextLocale,
                }));
              }}
            >
              <option value="system">{t("locale.system")}</option>
              <option value="zh-CN">{t("locale.zh-CN")}</option>
              <option value="en-US">{t("locale.en-US")}</option>
            </Select>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <h1>{t("settings.messages")}</h1>
        </div>
        <div className="settings-grid">
          <div>
            <Label>{t("settings.historyLimit")}</Label>
            <Input
              type="number"
              value={settings.messageHistoryLimitPerConnection}
              onChange={(event) => {
                const nextLimit = Number(event.currentTarget.value) || 0;
                setSettings((current) => ({
                  ...current,
                  messageHistoryLimitPerConnection: nextLimit,
                }));
              }}
            />
          </div>
          <div className="settings-toggle">
            <Label htmlFor="auto-scroll">{t("settings.autoScroll")}</Label>
            <input
              id="auto-scroll"
              checked={settings.autoScrollMessages}
              onChange={(event) => {
                const nextAutoScroll = event.currentTarget.checked;
                setSettings((current) => ({
                  ...current,
                  autoScrollMessages: nextAutoScroll,
                }));
              }}
              type="checkbox"
            />
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <h1>{t("settings.agent")}</h1>
        </div>
        <div className="settings-grid">
          <div className="settings-toggle">
            <Label htmlFor="agent-enabled">{t("settings.agentEnabled")}</Label>
            <input
              id="agent-enabled"
              checked={agentSettings.enabled}
              onChange={(event) => {
                const nextEnabled = event.currentTarget.checked;
                setAgentSettings((current) => ({
                  ...current,
                  enabled: nextEnabled,
                }));
              }}
              type="checkbox"
            />
          </div>
          <div>
            <Label>{t("settings.agentProvider")}</Label>
            <Select
              value={agentSettings.provider}
              onChange={(event) => {
                const nextProvider = event.currentTarget.value as AgentSettingsDto["provider"];
                setAgentSettings((current) => ({
                  ...current,
                  provider: nextProvider,
                }));
              }}
            >
              <option value="openai">OpenAI</option>
            </Select>
          </div>
          <div>
            <Label>{t("settings.agentBaseUrl")}</Label>
            <Input
              value={agentSettings.baseUrl}
              onChange={(event) => {
                const nextBaseUrl = event.currentTarget.value;
                setAgentSettings((current) => ({
                  ...current,
                  baseUrl: nextBaseUrl,
                }));
              }}
            />
          </div>
          <div>
            <Label>{t("settings.agentModel")}</Label>
            <Input
              value={agentSettings.model}
              onChange={(event) => {
                const nextModel = event.currentTarget.value;
                setAgentSettings((current) => ({
                  ...current,
                  model: nextModel,
                }));
              }}
            />
          </div>
          <div>
            <Label>{t("settings.agentApiKey")}</Label>
            <Input
              type="password"
              value={agentSettings.apiKey}
              onChange={(event) => {
                const nextApiKey = event.currentTarget.value;
                setAgentSettings((current) => ({
                  ...current,
                  apiKey: nextApiKey,
                }));
              }}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" onClick={() => void checkAgentHealth()} disabled={isCheckingAgent}>
            {isCheckingAgent ? t("settings.agentChecking") : t("settings.agentCheckHealth")}
          </Button>
          {agentHealth ? <span className="text-xs text-muted-foreground">{agentHealth}</span> : null}
        </div>
      </section>

      <div className="settings-actions">
        <Button variant="outline" onClick={handleClose}>
          {t("button.close")}
        </Button>
        <Button onClick={() => void saveSettings()} disabled={isSaving}>
          {isSaving ? t("settings.saving") : t("button.save")}
        </Button>
      </div>
    </main>
  );
}

export function SettingsWindow() {
  const [settings, setSettings] = useState<AppSettingsDto>(
    () => peekCachedAppSettings() ?? defaultSettings,
  );

  return (
    <I18nProvider localePreference={settings.locale}>
      <div className="app-shell">
        <header className="settings-layer-header">
          <div className="settings-layer-copy">
            <div className="titlebar-logo">M</div>
            <div>
              <div className="titlebar-name">{settings.locale === "zh-CN" ? "设置" : "Settings"}</div>
            </div>
          </div>
        </header>
        <SettingsView
          initialSettings={settings}
          onClose={() => {
            void closeCurrentWindow();
          }}
          onSaved={(nextSettings) => {
            setSettings(nextSettings);
          }}
          standalone
        />
        <Toaster
          position="top-right"
          richColors
          theme={settings.theme === "midnight" ? "dark" : "light"}
        />
      </div>
    </I18nProvider>
  );
}
