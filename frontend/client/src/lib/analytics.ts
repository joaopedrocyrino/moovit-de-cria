import { apiBaseUrl } from "@cria/shared/api-url";
const release = /^[a-f0-9]{40}$|^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(
  import.meta.env.VITE_RELEASE || "",
)
  ? import.meta.env.VITE_RELEASE
  : "0.1.0";
const base = apiBaseUrl(import.meta.env.VITE_API_ORIGIN);
export const CONSENT_KEY = "cria.analytics-consent.v1";
export type Consent = "accepted" | "rejected" | null;
type Properties = Record<string, string | number | boolean>;
type Event = { id: string; name: string; at: string; properties: Properties };
const maxAge = 90 * 86400_000;
const listeners = new Set<() => void>();
let choice: Consent = null,
  enabled = false,
  initialized = false,
  sending = false,
  revision = 0;
let queue: Event[] = [];
let activeSince = 0;
let accountState: boolean | undefined;
export function analyticsAccountState(authenticated: boolean) {
  if (accountState !== authenticated) {
    accountState = authenticated;
    track("account_state", { authenticated });
  }
}
function read(): Consent {
  try {
    const stored = JSON.parse(localStorage.getItem(CONSENT_KEY) || "null");
    return stored?.version === 1 &&
      Date.now() - stored.at >= 0 &&
      Date.now() - stored.at < maxAge &&
      ["accepted", "rejected"].includes(stored.choice)
      ? stored.choice
      : null;
  } catch {
    return null;
  }
}
function publish() {
  listeners.forEach((listener) => listener());
}
export const consentSnapshot = () => choice;
export const subscribeConsent = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function track(name: string, properties: Properties = {}) {
  if (!enabled || choice !== "accepted") return;
  queue.push({
    id: crypto.randomUUID(),
    name,
    at: new Date().toISOString(),
    properties,
  });
  if (queue.length > 100) queue.shift();
  if (queue.length >= 20) void flush();
}
export async function flush(keepalive = false) {
  if (
    !enabled ||
    choice !== "accepted" ||
    sending ||
    !queue.length ||
    !navigator.onLine
  )
    return;
  sending = true;
  const batch = queue.splice(0, 20),
    current = revision;
  try {
    const response = await fetch(base + "/analytics/events", {
      method: "POST",
      credentials: "include",
      keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
    });
    if (response.status === 403 && current === revision) {
      enabled = false;
      queue = [];
    }
    // Usage analytics is best effort. Network failures never block a trip or create unbounded retries.
  } catch {
  } finally {
    sending = false;
  }
}
async function serverConsent(accepted: boolean) {
  const session = await fetch(base + "/auth/session", {
    credentials: "include",
    cache: "no-store",
  });
  if (!session.ok)
    throw new Error(
      "Não foi possível atualizar a preferência no servidor. Tentaremos novamente quando houver conexão.",
    );
  const { csrfToken } = await session.json();
  const result = await fetch(base + "/analytics/consent", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ accepted }),
  });
  if (!result.ok)
    throw new Error(
      "Não foi possível atualizar a preferência no servidor. Tentaremos novamente quando houver conexão.",
    );
}
function opened() {
  const ua = navigator.userAgent;
  const os =
    /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
      ? "ios"
      : /Android/.test(ua)
        ? "android"
        : /Mac/.test(ua)
          ? "mac"
          : /Windows/.test(ua)
            ? "windows"
            : /Linux/.test(ua)
              ? "linux"
              : "other";
  const browser = /Edg/.test(ua)
    ? "edge"
    : /Firefox|FxiOS/.test(ua)
      ? "firefox"
      : /Chrome|CriOS/.test(ua)
        ? "chrome"
        : /Safari/.test(ua)
          ? "safari"
          : "other";
  track("app_open", {
    browser,
    os,
    viewport:
      innerWidth < 600 ? "small" : innerWidth < 1100 ? "medium" : "large",
    release,
    ...(accountState === undefined ? {} : { authenticated: accountState }),
    theme: document.documentElement.dataset.theme || "light",
  });
  activeSince = document.visibilityState === "visible" ? performance.now() : 0;
  const navigation = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  if (navigation?.loadEventEnd)
    track("performance", {
      metric: "load",
      value: Math.round(navigation.loadEventEnd),
    });
}
async function sync() {
  const current = ++revision;
  enabled = false;
  queue = [];
  if (!choice) return;
  try {
    if (choice === "rejected") {
      await serverConsent(false);
      return;
    }
    const response = await fetch(base + "/analytics/consent", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return;
    if (!(await response.json()).accepted) await serverConsent(true);
    if (current !== revision || choice !== "accepted") return;
    enabled = true;
    opened();
    void flush();
  } catch {} // Offline consent state is retried on the next online event/load.
}
export async function chooseConsent(next: Exclude<Consent, null>) {
  const current = ++revision;
  enabled = false;
  queue = [];
  activeSince = 0;
  choice = next;
  try {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ version: 1, choice: next, at: Date.now() }),
    );
  } catch {} // Choice still applies in memory if browser storage is unavailable.
  publish();
  await serverConsent(next === "accepted");
  if (current === revision && choice === "accepted") {
    enabled = true;
    opened();
    void flush();
  }
}
function engagement() {
  if (enabled && activeSince) {
    const duration = Math.min(
      30_000,
      Math.round(performance.now() - activeSince),
    );
    if (duration > 0) track("engagement", { duration });
  }
  activeSince =
    enabled && document.visibilityState === "visible" ? performance.now() : 0;
}
export function initializeAnalytics() {
  if (initialized) return;
  initialized = true;
  choice = read();
  publish();
  void sync();
  setInterval(() => {
    if (choice && read() === null) {
      choice = null;
      enabled = false;
      queue = [];
      publish();
      void serverConsent(false).catch(() => {});
    }
    engagement();
    void flush();
  }, 30_000);
  window.addEventListener("online", () => {
    track("connectivity", { online: true });
    if (!enabled) void sync();
  });
  window.addEventListener("offline", () =>
    track("connectivity", { online: false }),
  );
  window.addEventListener("storage", (event) => {
    if (event.key === CONSENT_KEY || event.key === null) {
      choice = read();
      enabled = false;
      queue = [];
      publish();
      void sync();
    }
  });
  document.addEventListener("visibilitychange", () => {
    engagement();
    if (document.visibilityState === "hidden") void flush(true);
  });
  window.addEventListener("pagehide", () => {
    engagement();
    void flush(true);
  });
  window.addEventListener("error", () => track("ui_error", { release }));
  window.addEventListener("unhandledrejection", () =>
    track("ui_error", { release }),
  );
  // Only numeric performance values: never resource URLs or exception text.
  if (typeof PerformanceObserver !== "undefined") {
    for (const type of ["largest-contentful-paint", "layout-shift", "event"]) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (type === "event" && entry.duration < 104) continue;
            const layout = entry as PerformanceEntry & {
              hadRecentInput?: boolean;
              value?: number;
            };
            if (type === "layout-shift" && layout.hadRecentInput) continue;
            const metric =
              type === "event"
                ? "interaction"
                : type === "layout-shift"
                  ? "cls"
                  : "lcp";
            track("performance", {
              metric,
              value:
                type === "layout-shift"
                  ? layout.value || 0
                  : Math.round(
                      type === "event" ? entry.duration : entry.startTime,
                    ),
            });
          }
        });
        observer.observe({ type, buffered: false });
      } catch {} // Feature support differs across Safari/Chromium versions.
    }
  }
}
