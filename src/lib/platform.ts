export type DesktopChromePlatform = "mac" | "windows" | "other";

export function getDesktopChromePlatform(): DesktopChromePlatform {
  if (typeof navigator === "undefined") {
    return "windows";
  }

  const userAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  const candidates = [
    navigator.userAgent,
    navigator.platform,
    userAgentData.userAgentData?.platform,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (candidates.includes("mac")) {
    return "mac";
  }

  if (candidates.includes("win")) {
    return "windows";
  }

  return "other";
}
