import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AccountData,
  AccountSession,
  Place,
  SavedAddress,
  TransitLine,
} from "@cria/shared";
import { analyticsAccountState, track } from "../lib/analytics";
import { api, ApiError } from "../api";
import { useGuestSaved } from "./useGuestSaved";
import { withAddress, withLine } from "../lib/guestSaved";

const sessionKey = ["account", "session"] as const;
const dataKey = ["account", "data"] as const;
export function useAccount() {
  const guest = useGuestSaved();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) =>
      api<AccountSession>("/auth/session", undefined, signal),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const user = session.data?.user ?? null;
  useEffect(() => {
    if (session.data) analyticsAccountState(!!user);
  }, [session.data, user]);
  const previous = useRef<string | null>(null);
  const clearPrivate = useCallback(async () => {
    await client.cancelQueries({ queryKey: dataKey });
    client.removeQueries({ queryKey: dataKey });
  }, [client]);
  useEffect(() => {
    if (previous.current && previous.current !== user?.id) {
      const oldKey = [...dataKey, previous.current];
      void client
        .cancelQueries({ queryKey: oldKey })
        .then(() => client.removeQueries({ queryKey: oldKey }));
    }
    previous.current = user?.id ?? null;
  }, [user?.id, clearPrivate]);
  const saved = useQuery({
    queryKey: [...dataKey, user?.id],
    queryFn: async ({ signal }) => {
      try {
        return await api<AccountData>("/account/saved", undefined, signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          void client.invalidateQueries({ queryKey: sessionKey });
        }
        throw error;
      }
    },
    enabled: !!user,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  });

  const write = useCallback(
    async <T>(
      path: string,
      body?: unknown,
      method: "POST" | "PUT" | "DELETE" = "POST",
    ): Promise<T> => {
      const current =
        client.getQueryData<AccountSession>(sessionKey) ??
        (await client.fetchQuery({
          queryKey: sessionKey,
          queryFn: () => api<AccountSession>("/auth/session"),
        }));
      if (!current)
        throw new Error(
          "Não foi possível conectar à sua conta. Tente novamente.",
        );
      try {
        return await api<T>(path, body, undefined, {
          method,
          csrfToken: current.csrfToken,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          const fresh = await client.fetchQuery({
            queryKey: sessionKey,
            queryFn: () => api<AccountSession>("/auth/session"),
            staleTime: 0,
          });
          return api<T>(path, body, undefined, {
            method,
            csrfToken: fresh.csrfToken,
          });
        }
        if (error instanceof ApiError && error.status === 401)
          void client.invalidateQueries({ queryKey: sessionKey });
        throw error;
      }
    },
    [client],
  );
  const adopt = useCallback(
    async (next: AccountSession) => {
      await client.cancelQueries({ queryKey: sessionKey });
      await clearPrivate();
      client.setQueryData(sessionKey, next);
    },
    [clearPrivate, client],
  );
  const authenticate = async (
    mode: "login" | "register",
    input: { email: string; password: string; name?: string },
  ) => {
    await adopt(await write<AccountSession>(`/auth/${mode}`, input));
  };
  const logout = async () => {
    await adopt(await write<AccountSession>("/auth/logout", {}));
  };
  const refreshSaved = () => client.invalidateQueries({ queryKey: dataKey });
  const saveAddress = async (alias: string, place: Place, id?: string) => {
    if (!user) {
      guest.change((data) =>
        withAddress(data, alias, place, id ?? crypto.randomUUID()),
      );
      track("saved_change", {
        storage: user ? "account" : "guest",
        kind: "address",
        action: id ? "edit" : "add",
      });
      return;
    }
    await write<SavedAddress>(
      `/account/addresses${id ? "/" + encodeURIComponent(id) : ""}`,
      { alias, address: place.label, point: place.point },
      id ? "PUT" : "POST",
    );
    await refreshSaved();
    track("saved_change", {
      storage: user ? "account" : "guest",
      kind: "address",
      action: id ? "edit" : "add",
    });
  };
  const deleteAddress = async (id: string) => {
    if (!user) {
      guest.change((data) => ({
        ...data,
        addresses: data.addresses.filter((item) => item.id !== id),
      }));
      track("saved_change", {
        storage: user ? "account" : "guest",
        kind: "address",
        action: "remove",
      });
      return;
    }
    await write<void>(
      "/account/addresses/" + encodeURIComponent(id),
      undefined,
      "DELETE",
    );
    await refreshSaved();
    track("saved_change", {
      storage: user ? "account" : "guest",
      kind: "address",
      action: "remove",
    });
  };
  const saveLine = async (
    line: Pick<TransitLine, "mode" | "line"> & { name?: string },
  ) => {
    const methodMode = ["bus", "brt", "metro"].includes(line.mode)
      ? line.mode
      : undefined;
    if (!user) {
      guest.change((data) => withLine(data, line, crypto.randomUUID()));
      track("saved_change", {
        storage: user ? "account" : "guest",
        kind: "line",
        ...(methodMode ? { mode: methodMode } : {}),
        action: "add",
      });
      return;
    }
    await write("/account/lines", line);
    await refreshSaved();
    track("saved_change", {
      storage: user ? "account" : "guest",
      kind: "line",
      ...(methodMode ? { mode: methodMode } : {}),
      action: "add",
    });
  };
  const deleteLine = async (id: string) => {
    const methodMode = (user ? saved.data?.lines : guest.data.lines)?.find(
      (item) => item.id === id,
    )?.mode;
    if (!user) {
      guest.change((data) => ({
        ...data,
        lines: data.lines.filter((item) => item.id !== id),
      }));
      track("saved_change", {
        storage: user ? "account" : "guest",
        kind: "line",
        ...(methodMode ? { mode: methodMode } : {}),
        action: "remove",
      });
      return;
    }
    await write<void>(
      "/account/lines/" + encodeURIComponent(id),
      undefined,
      "DELETE",
    );
    await refreshSaved();
    track("saved_change", {
      storage: user ? "account" : "guest",
      kind: "line",
      ...(methodMode ? { mode: methodMode } : {}),
      action: "remove",
    });
  };
  const changePassword = async (password: string, newPassword: string) => {
    await adopt(
      await write<AccountSession>("/account/password", {
        password,
        newPassword,
      }),
    );
  };
  const deleteAccount = async (password: string) => {
    await adopt(
      await write<AccountSession>("/account", { password }, "DELETE"),
    );
  };
  return {
    user,
    addresses: user ? (saved.data?.addresses ?? []) : guest.data.addresses,
    lines: user ? (saved.data?.lines ?? []) : guest.data.lines,
    pending: session.isPending,
    error: session.error,
    savedPending: !!user && saved.isPending,
    savedError: saved.error,
    refresh: () => client.invalidateQueries({ queryKey: sessionKey }),
    refreshSaved,
    authenticate,
    logout,
    saveAddress,
    deleteAddress,
    saveLine,
    deleteLine,
    changePassword,
    deleteAccount,
  };
}
export type AccountController = ReturnType<typeof useAccount>;
