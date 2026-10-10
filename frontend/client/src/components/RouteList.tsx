import {
  Bus,
  Footprints,
  ArrowRight,
  Clock,
  ChevronRight,
  TrainFront,
  Star,
} from "lucide-react";
import type { Itinerary, FavoriteLine, TransitLine } from "@cria/shared";
import { findFavorite, lineLabel } from "../lib/favorites";
import { brl, time } from "@cria/shared";
import "./RouteList.css";
export default function RouteList({
  routes,
  selected,
  arriveBy = false,
  onSelect,
  favorites = [],
  onFavorite,
  favoriteBusy = false,
}: {
  routes: Itinerary[];
  selected: string | null;
  arriveBy?: boolean;
  onSelect: (r: Itinerary) => void;
  favorites?: FavoriteLine[];
  onFavorite?: (line: TransitLine) => void;
  favoriteBusy?: boolean;
}) {
  return (
    <section className="route-list">
      <div className="section-label">
        <h2>Seu caminho pelo Rio</h2>
        <span>{routes.length} opções</span>
      </div>
      {!routes.length && (
        <p className="empty">
          Nenhuma rota nos serviços disponíveis para este trajeto e horário.
          Tente outros endereços ou um horário com serviço ativo.
        </p>
      )}
      {routes.map((r, i) => (
        <div className="route-card-wrap" key={r.id}>
          <button
            className={"route-card" + (selected === r.id ? " selected" : "")}
            onClick={() => onSelect(r)}
          >
            <div className="route-top">
              <strong>
                {r.durationMinutes}
                <small> min</small>
              </strong>
              <span className="route-price">
                {r.fare.cents === null ? brl(null) : "≈ " + brl(r.fare.cents)}
              </span>
              <ChevronRight size={18} />
            </div>
            <div className="route-badges">
              {i === 0 && (
                <span className="best">
                  {arriveBy ? "Saída mais tarde" : "Mais rápida encontrada"}
                </span>
              )}
              <span>
                {r.transfers
                  ? r.transfers +
                    (r.transfers > 1 ? " baldeações" : " baldeação")
                  : "Sem baldeação"}
              </span>
            </div>
            <div className="route-chain">
              <Footprints size={16} />
              <ArrowRight size={13} />
              {r.legs
                .filter((l) => l.kind === "transit")
                .map((l, j) => (
                  <span key={j} className="line-tag">
                    {l.mode === "metro" ? (
                      <TrainFront size={14} />
                    ) : (
                      <Bus size={14} />
                    )}
                    {l.mode === "metro"
                      ? "Metrô "
                      : l.mode === "brt"
                        ? "BRT "
                        : ""}
                    {l.line}
                    {findFavorite(favorites, {
                      mode: l.mode ?? "bus",
                      line: l.line ?? "",
                    }) && (
                      <Star
                        size={12}
                        fill="currentColor"
                        aria-label="Linha favorita"
                      />
                    )}
                  </span>
                ))}
            </div>
            <div className="route-directions">
              {r.legs
                .filter((l) => l.kind === "transit")
                .map((l, j) => (
                  <span key={j}>
                    {l.mode === "metro"
                      ? "Metrô "
                      : l.mode === "brt"
                        ? "BRT "
                        : ""}
                    {l.line} → {l.headsign}
                  </span>
                ))}
            </div>
            <div className="route-bottom">
              <span>
                <Clock size={12} /> {time(r.departure)} → {time(r.arrival)}
              </span>
              <span>{r.walkMinutes} min a pé</span>
            </div>
          </button>
          {onFavorite && (
            <div
              className="route-favorite-actions"
              aria-label="Salvar linhas desta rota"
            >
              {Array.from(
                new Map(
                  r.legs
                    .filter((leg) => leg.kind === "transit" && leg.line)
                    .map((leg) => [
                      `${leg.mode}:${leg.line}`,
                      {
                        mode: leg.mode ?? "bus",
                        line: leg.line!,
                        name: leg.headsign ?? "",
                      },
                    ]),
                ).values(),
              ).map((line) => {
                const favorite = findFavorite(favorites, line);
                return (
                  <button
                    type="button"
                    key={`${line.mode}:${line.line}`}
                    disabled={favoriteBusy}
                    aria-label={`${favorite ? "Remover" : "Favoritar"} ${lineLabel(line)}`}
                    onClick={() => onFavorite(line)}
                  >
                    <Star size={13} fill={favorite ? "currentColor" : "none"} />
                    {lineLabel(line)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
