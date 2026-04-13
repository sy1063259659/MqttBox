export type SupportedLocale = "en-US" | "zh-CN";
export type LocalePreference = "system" | SupportedLocale;

export function detectSystemLocale(input?: string): SupportedLocale {
  const raw =
    input ??
    (typeof navigator !== "undefined" ? navigator.language : "en-US");

  return raw.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function resolveLocalePreference(
  preference: LocalePreference | null | undefined,
  systemLocale?: string,
): SupportedLocale {
  if (preference === "en-US" || preference === "zh-CN") {
    return preference;
  }

  return detectSystemLocale(systemLocale);
}
