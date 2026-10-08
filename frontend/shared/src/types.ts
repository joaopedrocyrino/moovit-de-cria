export type TravelTimeMode = "now" | "departure" | "arrival";
export type PlanTiming = { departure?: string; arriveBy?: string };
export type Point = { lat: number; lon: number };
export type Stop = { id: string; name: string; point: Point };
export type Leg = {
  kind: "walk" | "transit";
  routeId: string | null;
  line: string | null;
  mode: string | null;
  headsign: string | null;
  direction: number | null;
  shapeId: string | null;
  start: string;
  end: string;
  from: Stop;
  to: Stop;
  stops: Stop[];
  fareCents: number | null;
  municipal: boolean;
  estimated: boolean;
};
export type Itinerary = {
  id: string;
  durationMinutes: number;
  transfers: number;
  walkMinutes: number;
  departure: string;
  arrival: string;
  fare: { cents: number | null; label: string; notes: string[] };
  legs: Leg[];
};
export type Plan = {
  itineraries: Itinerary[];
  notices: string[];
  source: string;
  importedAt: string;
};
export type Place = {
  label: string;
  point: Point;
  source?: "catalog" | "photon" | "nominatim";
};
export type Vehicle = {
  id: string;
  line: string;
  routeId: string | null;
  direction: number | null;
  point: Point;
  observedAt: string;
  speed: number | null;
  bearing: number | null;
  source: string;
};
export type Vehicles = {
  vehicles: Vehicle[];
  status: "live" | "empty" | "unavailable";
  checkedAt: string;
  message: string | null;
  lineCount: number;
  unknownDirectionCount: number;
};
export type Fix = Point & { accuracy: number; timestamp: number };
export type Config = {
  dataReady: boolean;
  coverage: string[];
  tilesUrl: string;
  importedAt: string | null;
};
