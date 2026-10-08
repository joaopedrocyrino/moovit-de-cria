import type { Itinerary, Leg, Vehicle } from "@cria/shared";
const colors = ["#176B4D", "#1B66BD", "#AD3C85", "#B76A19"];
export type MapVehicle = Vehicle & { color: string; routeLabel: string };
export function routeLayers(route: Itinerary) {
  return route.legs
    .filter((l) => l.kind === "transit")
    .filter(
      (leg, index, legs) =>
        legs.findIndex(
          (l) => l.routeId === leg.routeId && l.direction === leg.direction,
        ) === index,
    )
    .map((leg, index) => ({
      leg,
      color: colors[index % colors.length],
      label: `${leg.mode === "metro" ? "Metrô " : leg.mode === "brt" ? "BRT " : ""}${leg.line} · ${leg.headsign}`,
    }));
}
export function matchesLeg(vehicle: Vehicle, leg: Leg, now = Date.now()) {
  return (
    leg.direction !== null &&
    vehicle.direction === leg.direction &&
    vehicle.routeId === leg.routeId &&
    vehicle.line === leg.line &&
    new Date(vehicle.observedAt).getTime() >= now - 180000 &&
    new Date(vehicle.observedAt).getTime() <= now + 30000
  );
}
export function mapVehicles(
  route: Itinerary | null,
  fleets: Record<string, Vehicle[]>,
  now = Date.now(),
): MapVehicle[] {
  if (!route) return [];
  const seen = new Set<string>();
  return routeLayers(route)
    .filter((layer) => layer.leg.mode === "bus" || layer.leg.mode === "brt")
    .flatMap((layer) =>
      (fleets[layer.leg.line!] ?? [])
        .filter(
          (vehicle) =>
            matchesLeg(vehicle, layer.leg, now) && !seen.has(vehicle.id),
        )
        .map((vehicle) => {
          seen.add(vehicle.id);
          return { ...vehicle, color: layer.color, routeLabel: layer.label };
        }),
    );
}
