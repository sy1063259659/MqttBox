import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { closeCurrentWindow } from "@/services/window";
import { peekCachedAppSettings, saveAppSettings, type AppSettingsDto } from "@/services/tauri";

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
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

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
      await saveAppSettings(settings);
      document.documentElement.dataset.theme = settings.theme;
      await onSaved?.(settings);
      toast.success(t("toast.settingsSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.settingsSaveFailed"));
    } finally {
      setIsSaving(false);
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
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  theme: event.currentTarget.value as AppSettingsDto["theme"],
                }))
              }
            >
              <option value="graphite">{t("theme.graphite")}</option>
              <option value="midnight">{t("theme.midnight")}</option>
            </Select>
          </div>
          <div>
            <Label>{t("settings.timestamp")}</Label>
            <Select
              value={settings.timestampFormat}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  timestampFormat: event.currentTarget.value,
                }))
              }
            >
              <option value="datetime">{t("timestamp.datetime")}</option>
              <option value="time">{t("timestamp.time")}</option>
            </Select>
          </div>
          <div>
            <Label>{t("settings.language")}</Label>
            <Select
              value={settings.locale}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  locale: event.currentTarget.value as AppSettingsDto["locale"],
                }))
              }
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
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  messageHistoryLimitPerConnection: Number(event.currentTarget.value) || 0,
                }))
              }
            />
          </div>
          <div className="settings-toggle">
            <Label htmlFor="auto-scroll">{t("settings.autoScroll")}</Label>
            <input
              id="auto-scroll"
              checked={settings.autoScrollMessages}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  autoScrollMessages: event.currentTarget.checked,
                }))
              }
              type="checkbox"
            />
          </div>
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
