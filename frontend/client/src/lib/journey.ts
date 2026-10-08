import type { Point, Fix, Leg } from "@cria/shared";
export function distance(a: Point, b: Point) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) *
      Math.cos(b.lat * r) *
      Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function validFix(fix: Fix, now = Date.now()) {
  return (
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lon) &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy >= 0 &&
    fix.accuracy <= 65 &&
    now - fix.timestamp <= 20000 &&
    fix.timestamp <= now + 1000
  );
}
export function progress(
  leg: Leg,
  fix: Fix,
  previous: number,
  now = Date.now(),
) {
  if (!validFix(fix, now))
    return { index: previous, alert: false, offRoute: false };
  let nearest = previous;
  let best = Infinity;
  // Ignore earlier stops after passing them; jumps to distant later sections are not trusted.
  for (
    let i = Math.max(0, previous - 1);
    i < Math.min(leg.stops.length, previous + 7);
    i++
  ) {
    const d = distance(fix, leg.stops[i].point);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  if (best > 220) return { index: previous, alert: false, offRoute: true };
  const index = Math.max(previous, nearest),
    remaining = leg.stops.length - 1 - index;
  const alert =
    index > 0 && remaining <= 2 && distance(fix, leg.to.point) <= 800;
  return { index, alert, offRoute: false };
}
export function clipShape(points: Point[], leg: Leg): Point[] {
  if (points.length < 2) return leg.stops.map((s) => s.point);
  let start = 0;
  for (let i = 1; i < points.length; i++)
    if (
      distance(points[i], leg.from.point) <
      distance(points[start], leg.from.point)
    )
      start = i;
  let end = start;
  for (let i = start + 1; i < points.length; i++)
    if (distance(points[i], leg.to.point) < distance(points[end], leg.to.point))
      end = i;
  return end > start
    ? points.slice(start, end + 1)
    : leg.stops.map((s) => s.point);
}
