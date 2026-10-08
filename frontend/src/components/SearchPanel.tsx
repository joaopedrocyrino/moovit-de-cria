import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  ArrowDownUp,
  LocateFixed,
  ArrowRight,
  LoaderCircle,
  MapPin,
  X,
} from "lucide-react";
import type { Place, Point, PlanTiming, TravelTimeMode } from "../types";
import { planTiming, rioDateTime } from "../lib/timing";
import { api } from "../api";
import "./SearchPanel.css";

type Field = "from" | "to";
type Props = {
  location: Point | null;
  locationLabel: string | null;
  onPlan: (from: Place, to: Place, payment: string, timing: PlanTiming) => void;
  compact: boolean;
  onExpand: () => void;
  pending: boolean;
  disabled: boolean;
  locate: () => void;
};

export default function SearchPanel({
  location,
  locationLabel,
  onPlan,
  pending,
  disabled,
  locate,
  compact,
  onExpand,
}: Props) {
  const expanded = !compact;
  const [timeMode, setTimeMode] = useState<TravelTimeMode>("now");
  const [travelDate, setTravelDate] = useState(() =>
    rioDateTime(new Date(Date.now() + 3600000)),
  );
  const [timeError, setTimeError] = useState("");
  useEffect(() => {
    if (compact) setField(null);
  }, [compact]);
  const [field, setField] = useState<Field | null>(null);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [originText, setOriginText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [usesGps, setUsesGps] = useState(true);
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [payment, setPayment] = useState("individual");
  const originInput = useRef<HTMLInputElement>(null);
  const destinationInput = useRef<HTMLInputElement>(null);

  // A late GPS/address response must never overwrite a manually edited origin.
  useEffect(() => {
    if (usesGps && location) {
      const place = {
        label: locationLabel || "Minha localização",
        point: location,
      };
      setOrigin(place);
      setOriginText(place.label);
    }
  }, [location, locationLabel, usesGps]);

  const text =
    field === "from" ? originText : field === "to" ? destinationText : "";
  const selected = field === "from" ? origin : destination;
  const term = text.trim();
  const needsSearch =
    field !== null && term.length >= 3 && text !== selected?.label;
  useEffect(() => {
    setDebounced("");
    setActiveIndex(-1);
    if (!needsSearch) return;
    const timer = window.setTimeout(() => setDebounced(term), 450);
    return () => window.clearTimeout(timer);
  }, [term, field, needsSearch]);

  const candidateBias = (field === "to" ? origin?.point : location) || location;
  const bias =
    candidateBias &&
    candidateBias.lat >= -23.12 &&
    candidateBias.lat <= -22.72 &&
    candidateBias.lon >= -43.85 &&
    candidateBias.lon <= -43.08
      ? candidateBias
      : null;
  // Round only the search bias to improve cache reuse, never the selected routing coordinates.
  const searchBias = bias
    ? { lat: Number(bias.lat.toFixed(3)), lon: Number(bias.lon.toFixed(3)) }
    : null;
  const ready = needsSearch && debounced === term;
  const suggestions = useQuery({
    queryKey: ["places", debounced, searchBias?.lat, searchBias?.lon],
    queryFn: ({ signal }) =>
      api<Place[]>(
        "/places/search",
        { query: debounced, bias: searchBias },
        signal,
      ),
    enabled: ready,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const results = ready ? suggestions.data || [] : [];
  const searching = needsSearch && (!ready || suggestions.isFetching);
  const searchError =
    ready && suggestions.error ? suggestions.error.message : null;

  useEffect(() => {
    if (field && activeIndex >= 0)
      document
        .getElementById(`${field}-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, field]);

  function select(place: Place, target: Field) {
    if (target === "from") {
      setUsesGps(false);
      setOrigin(place);
      setOriginText(place.label);
    } else {
      setDestination(place);
      setDestinationText(place.label);
    }
    setField(null);
    setActiveIndex(-1);
  }

  function edit(target: Field, value: string) {
    onExpand();
    setField(target);
    setActiveIndex(-1);
    if (target === "from") {
      setUsesGps(false);
      setOrigin(null);
      setOriginText(value);
    } else {
      setDestination(null);
      setDestinationText(value);
    }
  }

  function useGps() {
    setUsesGps(true);
    locate();
    if (location) {
      const place = {
        label: locationLabel || "Minha localização",
        point: location,
      };
      setOrigin(place);
      setOriginText(place.label);
    }
    setField(null);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>, target: Field) {
    if (event.key === "Escape") {
      setField(null);
      return;
    }
    if (!results.length || field !== target) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        event.key === "ArrowDown"
          ? (index + 1) % results.length
          : index <= 0
            ? results.length - 1
            : index - 1,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(results[Math.max(0, activeIndex)], target);
    }
  }

  function endpoint(target: Field) {
    const isOrigin = target === "from";
    const current = isOrigin ? originText : destinationText;
    const open = field === target;
    const showOptions =
      open &&
      (needsSearch || (current.trim().length > 0 && !selected) || isOrigin);
    return (
      <div
        className="endpoint-group"
        key={target}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setField((previous) => (previous === target ? null : previous));
        }}
      >
        <div className={`endpoint ${open ? "focused" : ""}`}>
          {isOrigin ? (
            <span className="origin-circle" />
          ) : (
            <Search size={19} aria-hidden="true" />
          )}
          <div className="endpoint-field">
            {expanded && (
              <label htmlFor={`${target}-address`}>
                {isOrigin ? "Origem" : "Destino"}
              </label>
            )}
            <input
              ref={isOrigin ? originInput : destinationInput}
              id={`${target}-address`}
              aria-label={isOrigin ? "Buscar origem" : "Buscar destino"}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showOptions}
              aria-controls={showOptions ? `${target}-options` : undefined}
              aria-activedescendant={
                open && activeIndex >= 0 && results[activeIndex]
                  ? `${target}-option-${activeIndex}`
                  : undefined
              }
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              maxLength={180}
              value={current}
              onFocus={() => {
                onExpand();
                setField(target);
                setActiveIndex(-1);
              }}
              onChange={(event) => edit(target, event.target.value)}
              onKeyDown={(event) => keyDown(event, target)}
              placeholder={
                isOrigin ? "De onde você sai?" : "Pra onde você vai?"
              }
            />
          </div>
          {current && (
            <button
              type="button"
              className="icon-button clear-address"
              aria-label={isOrigin ? "Limpar origem" : "Limpar destino"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                edit(target, "");
                (isOrigin ? originInput : destinationInput).current?.focus();
              }}
            >
              <X size={16} />
            </button>
          )}
          {isOrigin && (
            <button
              type="button"
              className="icon-button"
              title="Trocar origem e destino"
              aria-label="Trocar origem e destino"
              disabled={!origin || !destination}
              onClick={() => {
                setUsesGps(false);
                setOrigin(destination);
                setDestination(origin);
                setOriginText(destinationText);
                setDestinationText(originText);
                setField(null);
              }}
            >
              <ArrowDownUp size={18} />
            </button>
          )}
        </div>
        {showOptions && (
          <div className="place-dropdown">
            {isOrigin && (
              <button
                type="button"
                className="location-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={useGps}
              >
                <LocateFixed size={16} /> Usar minha localização
              </button>
            )}
            {searching && (
              <div className="search-feedback" role="status">
                <LoaderCircle className="spin" size={16} /> Buscando lugares…
              </div>
            )}
            {searchError && (
              <p className="search-feedback error" role="alert">
                {searchError}
              </p>
            )}
            <ul
              id={`${target}-options`}
              role="listbox"
              aria-label={
                isOrigin ? "Sugestões de origem" : "Sugestões de destino"
              }
              className="place-results"
              aria-busy={searching}
            >
              {results.map((place, index) => (
                <li
                  role="presentation"
                  key={`${place.label}:${place.point.lat}:${place.point.lon}`}
                >
                  <button
                    type="button"
                    role="option"
                    tabIndex={-1}
                    id={`${target}-option-${index}`}
                    aria-selected={activeIndex === index}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(place, target)}
                  >
                    <MapPin size={17} aria-hidden="true" />
                    <span>
                      <strong>{place.label.split(",")[0]}</strong>
                      <small>
                        {place.label.split(",").slice(1).join(",").trim()}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!searching &&
              !searchError &&
              needsSearch &&
              ready &&
              !results.length &&
              suggestions.isSuccess && (
                <p className="search-feedback">
                  Nenhum lugar encontrado. Tente incluir o bairro ou endereço.
                </p>
              )}
            {!needsSearch && !selected && term.length < 3 && (
              <p className="search-feedback">
                Digite pelo menos 3 letras do lugar ou endereço.
              </p>
            )}
            {results.length > 0 && (
              <div className="search-attribution">
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  © OpenStreetMap
                </a>{" "}
                · Photon
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className={"search-panel" + (compact ? " compact" : "")}>
      <div hidden={compact}>
        <span className="eyebrow">SEU CORRE, SEM ENROLAÇÃO</span>
        <h1>Partiu, cria?</h1>
        <p className="search-subtitle">
          O Rio é grande. Seu caminho pode ser simples.
        </p>
      </div>
      <div className="route-inputs">
        {expanded && endpoint("from")}
        {endpoint("to")}
      </div>
      {expanded && (
        <div className="route-options">
          <label className="payment-label">
            Quando viajar
            <select
              aria-label="Quando viajar"
              value={timeMode}
              onChange={(event) => {
                setTimeMode(event.target.value as TravelTimeMode);
                setTimeError("");
              }}
            >
              <option value="now">Sair agora</option>
              <option value="departure">Sair às</option>
              <option value="arrival">Chegar até</option>
            </select>
          </label>
          {timeMode !== "now" && (
            <label className="travel-time-label">
              Data e hora no Rio de Janeiro
              <input
                type="datetime-local"
                aria-label="Data e hora no Rio de Janeiro"
                required
                min={rioDateTime(new Date())}
                max={rioDateTime(new Date(Date.now() + 7 * 86400000))}
                value={travelDate}
                onChange={(event) => {
                  setTravelDate(event.target.value);
                  setTimeError("");
                }}
              />
            </label>
          )}
          {timeError && (
            <p className="error" role="alert">
              {timeError}
            </p>
          )}
          <label className="payment-label">
            Pagamento
            <select
              value={payment}
              onChange={(event) => setPayment(event.target.value)}
            >
              <option value="individual">Tarifas individuais</option>
              <option value="jae">Jaé preto / QR Code (BUC)</option>
            </select>
          </label>
          <button
            type="button"
            className="primary plan-button"
            disabled={!origin || !destination || pending || disabled}
            onClick={() => {
              if (!origin || !destination) return;
              try {
                const timing = planTiming(timeMode, travelDate);
                setTimeError("");
                onPlan(origin, destination, payment, timing);
              } catch (error) {
                setTimeError(
                  error instanceof Error ? error.message : "Horário inválido.",
                );
              }
            }}
          >
            {pending ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ArrowRight size={18} />
            )}
            {pending ? "Encontrando seu caminho…" : "Encontrar rotas"}
          </button>
        </div>
      )}
      <div className="search-benefits" hidden={compact}>
        <span>Sem anúncios</span>
        <span>GPS público gratuito</span>
        <span>Do Rio, pro Rio</span>
      </div>
    </section>
  );
}
