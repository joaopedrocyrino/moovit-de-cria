import { apiBaseUrl } from "./lib/apiUrl";
const base = apiBaseUrl(import.meta.env.VITE_API_ORIGIN);
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Não foi possível conectar." }));
    throw new Error(error.message || "Tente novamente.");
  }
  return response.json();
}
