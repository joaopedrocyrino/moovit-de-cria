import { useEffect, useState } from "react";
export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";
const key = "cria.theme";
const systemQuery = "(prefers-color-scheme: dark)";
function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(key);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "system";
}
export function useTheme() {
  const [preference, setPreferenceState] = useState(readPreference);
  const [system, setSystem] = useState<Theme>(() =>
    window.matchMedia(systemQuery).matches ? "dark" : "light",
  );
  const theme = preference === "system" ? system : preference;
  useEffect(() => {
    const media = window.matchMedia(systemQuery);
    const update = () => setSystem(media.matches ? "dark" : "light");
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null)
        setPreferenceState(readPreference());
    };
    update();
    media.addEventListener("change", update);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.style.backgroundColor =
      theme === "dark" ? "#111b16" : "#e3e9de";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#111b16" : "#fafbf7");
  }, [theme]);
  function setPreference(next: ThemePreference) {
    try {
      if (next === "system") window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, next);
    } catch {}
    setPreferenceState(next);
  }
  return {
    theme,
    preference,
    setPreference,
    toggle: () => setPreference(theme === "dark" ? "light" : "dark"),
  };
}
