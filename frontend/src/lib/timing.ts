import type { Leg, TravelTimeMode } from "../types.ts";

export function rioDateTime(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(" ", "T");
}
export function planTiming(
  mode: TravelTimeMode,
  value: string,
  now = Date.now(),
) {
  if (mode === "now") return {};
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Escolha a data e o horário.");
  // The picker represents Rio wall time, even when the phone is configured in another zone.
  const date = new Date(`${value}:00-03:00`);
  if (!Number.isFinite(date.getTime()) || rioDateTime(date) !== value)
    throw new Error("Data ou horário inválido.");
  if (date.getTime() < now - 120000 || date.getTime() > now + 7 * 86400000)
    throw new Error("Escolha um horário entre agora e os próximos 7 dias.");
  return mode === "departure"
    ? { departure: date.toISOString() }
    : { arriveBy: date.toISOString() };
}
export function journeyStatus(
  leg: Leg,
  boarded: boolean,
  index: number,
  alert: boolean,
  gps: boolean,
  now = Date.now(),
) {
  const mode =
    leg.mode === "metro" ? "Metrô" : leg.mode === "brt" ? "BRT" : "Ônibus";
  const service = `${mode} ${leg.line}`;
  if (alert)
    return {
      title: "Prepare-se para descer",
      detail: `${service} · ${leg.to.name}`,
    };
  if (boarded)
    return gps
      ? {
          title: `Próxima ${leg.mode === "metro" ? "estação" : "parada"}: ${leg.stops[Math.min(index + 1, leg.stops.length - 1)]?.name ?? leg.to.name}`,
          detail: `${service} · desembarque em ${leg.to.name}`,
        }
      : {
          title: `Em viagem · ${service}`,
          detail: `Sem GPS preciso · desembarque em ${leg.to.name}`,
        };
  const minutes = Math.ceil((new Date(leg.start).getTime() - now) / 60000);
  return {
    title: `Vá até ${leg.from.name}`,
    detail:
      minutes > 0
        ? `${service} · saída em ${minutes} min (estimativa)`
        : `${service} · confirme o próximo embarque`,
  };
}
