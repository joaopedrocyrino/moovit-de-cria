// Public build-time setting, never a credential. Local Vite keeps its /api proxy.
export function apiBaseUrl(configured?: string): string {
  if (!configured) return "/api";
  const url = new URL(configured);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("VITE_API_ORIGIN must be an HTTPS origin without a path.");
  return url.origin + "/api";
}
