// Runs before the app paints; storage can be unavailable in restricted browsers.
(() => {
  let preference;
  try {
    preference = localStorage.getItem("cria.theme");
  } catch {}
  const theme =
    preference === "light" || preference === "dark"
      ? preference
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.backgroundColor =
    theme === "dark" ? "#111b16" : "#e3e9de";
})();
