import { apiBaseUrl } from "@cria/shared/api-url";
import { track } from "./lib/analytics";
const base = apiBaseUrl(import.meta.env.VITE_API_ORIGIN);
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    csrfToken?: string;
  } = {},
): Promise<T> {
  const started = performance.now();
  const prefix = path.split("?")[0];
  const endpoint = prefix.startsWith("/places/")
    ? "places-" + prefix.split("/")[2]
    : prefix.startsWith("/auth/")
      ? "auth"
      : prefix.startsWith("/account")
        ? "account"
        : prefix.startsWith("/shapes/")
          ? "shapes"
          : prefix.slice(1);
  let response: Response;
  try {
    response = await fetch(base + path, {
      method: options.method || (body === undefined ? "GET" : "POST"),
      credentials: "include",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.csrfToken ? { "X-CSRF-Token": options.csrfToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (!signal?.aborted)
      track("api_result", {
        endpoint,
        status: 0,
        duration: Math.round(performance.now() - started),
      });
    throw cause;
  }
  track("api_result", {
    endpoint,
    status: response.status,
    duration: Math.round(performance.now() - started),
  });
  if (prefix === "/places/search")
    track("place_search", {
      length: Math.min(
        200,
        String((body as { query?: string })?.query || "").length,
      ),
    });
  const authMethod =
    prefix === "/account/password"
      ? "password"
      : prefix === "/account" && options.method === "DELETE"
        ? "delete"
        : prefix.startsWith("/auth/")
          ? prefix.split("/")[2]
          : null;
  if (authMethod && authMethod !== "session")
    track("auth_result", {
      method: authMethod,
      result: response.ok ? "success" : "error",
    });
  if (!response.ok) {
    const error = await response.json().catch(() => ({
      message:
        response.status === 401
          ? "Entre na sua conta para continuar."
          : "Não foi possível conectar.",
    }));
    throw new ApiError(
      error.message ||
        (response.status === 401
          ? "Entre na sua conta para continuar."
          : "Tente novamente."),
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (prefix === "/plans")
    track("route_result", {
      count: data.itineraries?.length || 0,
      duration: Math.round(performance.now() - started),
    });
  return data;
}
