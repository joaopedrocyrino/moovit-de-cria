import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Itinerary, Vehicle, Vehicles } from "@cria/shared";
import { api } from "../api";
import { mapVehicles, routeLayers } from "../lib/routeVehicles";

export function useRouteVehicles(route: Itinerary | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const lines = route
    ? [
        ...new Set(
          routeLayers(route)
            .filter(
              (layer) => layer.leg.mode === "bus" || layer.leg.mode === "brt",
            )
            .map((layer) => layer.leg.line!),
        ),
      ]
    : [];
  const queries = useQueries({
    queries: lines.map((line) => ({
      queryKey: ["vehicles", line],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<Vehicles>(
          `/vehicles?line=${encodeURIComponent(line)}`,
          undefined,
          signal,
        ),
      staleTime: 20000,
      refetchInterval: 20000,
      refetchIntervalInBackground: false,
      retry: 1,
    })),
  });
  const fleets: Record<string, Vehicle[]> = {};
  queries.forEach((query, index) => {
    fleets[lines[index]] = query.data?.vehicles ?? [];
  });
  return mapVehicles(route, fleets, now);
}
