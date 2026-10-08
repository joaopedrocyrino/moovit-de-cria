import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bus,
  TrainFront,
  Check,
  ChevronLeft,
  Footprints,
  ShieldCheck,
  ChevronUp,
} from "lucide-react";
import { api } from "../api";
import type { Fix, Itinerary, Vehicles } from "../types";
import { time, brl } from "../types";
import { matchesLeg } from "../lib/routeVehicles";
import { journeyStatus } from "../lib/timing";
import { progress, validFix } from "../lib/journey";
import "./JourneyPanel.css";
type Props = {
  route: Itinerary;
  compact: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  fix: Fix | null;
  onBack: () => void;
  selectedVehicle: string | null;
  onSelectVehicle: (id: string) => void;
  setTracking: (v: boolean) => void;
};
export default function JourneyPanel({
  route,
  compact,
  onExpand,
  onCollapse,
  fix,
  onBack,
  selectedVehicle,
  onSelectVehicle,
  setTracking,
}: Props) {
  const rides = route.legs.filter((l) => l.kind === "transit");
  const [stage, setStage] = useState(0),
    [boarded, setBoarded] = useState(false),
    [index, setIndex] = useState(0),
    [alert, setAlert] = useState(false),
    [notice, setNotice] = useState(""),
    [hidden, setHidden] = useState(document.hidden),
    [notificationEnabled, setNotificationEnabled] = useState(
      typeof Notification !== "undefined" &&
        Notification.permission === "granted",
    );
  const notified = useRef(false),
    wake = useRef<WakeLockSentinel | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  const leg = rides[stage];
  const isMetro = leg.mode === "metro";
  const vehicles = useQuery({
    queryKey: ["vehicles", leg.line],
    queryFn: ({ signal }) =>
      api<Vehicles>(
        `/vehicles?line=${encodeURIComponent(leg.line!)}`,
        undefined,
        signal,
      ),
    enabled: !isMetro,
    staleTime: 20000,
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const routeVehicles = useMemo(
    () =>
      isMetro
        ? []
        : (vehicles.data?.vehicles ?? []).filter((v) =>
            matchesLeg(v, leg, now),
          ),
    [vehicles.data, isMetro, leg.routeId, leg.direction, leg.line, now],
  );
  const vehicleScope = vehicles.data
    ? `${routeVehicles.length} neste sentido e variação · ${vehicles.data.lineCount} na linha inteira. ${vehicles.data.unknownDirectionCount ? `${vehicles.data.unknownDirectionCount} sem sentido confirmado.` : ""} Outras opções podem usar outro sentido ou variação.`
    : null;
  useEffect(() => {
    setTracking(boarded);
    return () => {
      setTracking(false);
      wake.current?.release().catch(() => {});
    };
  }, [boarded, setTracking]);
  useEffect(() => {
    const listener = () => {
      setHidden(document.hidden);
      if (!document.hidden && boarded && wake.current?.released)
        navigator.wakeLock
          ?.request("screen")
          .then((w) => {
            wake.current = w;
          })
          .catch(() => {});
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, [boarded]);
  useEffect(() => {
    if (!boarded || !fix) return;
    const state = progress(leg, fix, index);
    if (state.index !== index) setIndex(state.index);
    if (state.offRoute)
      setNotice("Você parece longe do trajeto. Confira a linha e o sentido.");
    if (state.alert && !notified.current) {
      notified.current = true;
      setAlert(true);
      const body = `Prepare-se para descer em ${leg.to.name}.`;
      navigator.vibrate?.([200, 100, 200]);
      if (notificationEnabled)
        navigator.serviceWorker?.ready
          .then((r) =>
            r.showNotification("Seu desembarque está chegando", {
              body,
              tag: "cria-alight",
              icon: "/icon.svg",
            }),
          )
          .catch(() => {});
    }
  }, [boarded, fix, index, leg, notificationEnabled]);
  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      setNotice(
        "Para receber avisos no iPhone, adicione o app à Tela de Início. O aviso na tela continua disponível.",
      );
      return;
    }
    try {
      setNotificationEnabled(
        (await Notification.requestPermission()) === "granted",
      );
    } catch {
      setNotice("Notificações indisponíveis; acompanhe os avisos na tela.");
    }
  }
  async function board() {
    setBoarded(true);
    onCollapse();
    try {
      if (navigator.wakeLock)
        wake.current = await navigator.wakeLock.request("screen");
    } catch {
      setNotice(
        "Não foi possível manter a tela ligada. Mantenha o app aberto para os avisos.",
      );
    }
  }
  function next() {
    setBoarded(false);
    setIndex(0);
    setAlert(false);
    notified.current = false;
    wake.current?.release().catch(() => {});
    if (stage < rides.length - 1) {
      setStage(stage + 1);
      onSelectVehicle("");
    } else onBack();
  }
  const fresh = fix && validFix(fix, now);
  const status = journeyStatus(leg, boarded, index, alert, Boolean(fresh), now);
  const v = routeVehicles.find((v) => v.id === selectedVehicle);
  return (
    <section className={"journey-panel" + (compact ? " compact" : "")}>
      {compact && (
        <button
          className={"journey-summary" + (alert ? " alighting" : "")}
          aria-label="Abrir detalhes da viagem"
          onClick={onExpand}
        >
          {boarded ? (
            isMetro ? (
              <TrainFront size={25} />
            ) : (
              <Bus size={25} />
            )
          ) : (
            <Footprints size={25} />
          )}
          <span aria-live="polite">
            <strong>{status.title}</strong>
            <small>{status.detail}</small>
          </span>
          <ChevronUp size={18} />
        </button>
      )}
      <div hidden={compact}>
        <button className="back" onClick={onBack}>
          <ChevronLeft size={17} /> Outras rotas
        </button>
        <span className="eyebrow">
          {boarded
            ? "ACOMPANHANDO SUA VIAGEM"
            : isMetro
              ? "VAMOS PEGAR SEU METRÔ"
              : "VAMOS PEGAR SEU ÔNIBUS"}
        </span>
        <div className="journey-heading">
          <span className="journey-bus">
            {isMetro ? <TrainFront size={24} /> : <Bus size={24} />}
          </span>
          <div>
            <h2>
              {isMetro ? "Metrô " : leg.mode === "brt" ? "BRT " : ""}
              {leg.line}
            </h2>
            <p>Sentido {leg.headsign}</p>
          </div>
        </div>
        <div className="journey-facts">
          <span>{route.durationMinutes} min estimados</span>
          <span>{brl(route.fare.cents)}</span>
          <span>Chegada {time(route.arrival)}</span>
        </div>
        {alert && (
          <div className="alight-alert" role="alert">
            <Bell size={22} />
            <div>
              <strong>Já já é sua parada!</strong>
              <p>Prepare-se para descer em {leg.to.name}.</p>
            </div>
          </div>
        )}
        {!boarded ? (
          <>
            <div className="step">
              <Footprints size={20} />
              <div>
                <strong>Vá até {leg.from.name}</strong>
                <p>Confirme a linha e o sentido no letreiro.</p>
              </div>
            </div>
            {isMetro ? (
              <p className="muted" role="status">
                Metrô sem posição de trens em tempo real. A espera é estimada.
                Nos túneis, o GPS do telefone pode ficar indisponível; acompanhe
                as estações e confirme o desembarque.
              </p>
            ) : (
              <>
                <div className="live-heading">
                  <h3>Veículos para este sentido</h3>
                  <span
                    className={
                      routeVehicles.length > 0 ? "live-pill" : "quiet-pill"
                    }
                  >
                    {vehicles.isFetching
                      ? "Atualizando"
                      : vehicles.data?.status === "unavailable" &&
                          routeVehicles.length > 0
                        ? "Último GPS recebido"
                        : routeVehicles.length > 0
                          ? "GPS ao vivo"
                          : "Sem GPS recente"}
                  </span>
                </div>
                {vehicleScope && <p className="muted">{vehicleScope}</p>}
                {vehicles.data?.status === "unavailable" && (
                  <p className="muted">{vehicles.data.message}</p>
                )}
                {vehicles.error && (
                  <p className="error">{vehicles.error.message}</p>
                )}
                <div className="vehicle-list">
                  {routeVehicles.map((bus) => (
                    <button
                      key={bus.id}
                      className={selectedVehicle === bus.id ? "selected" : ""}
                      onClick={() => onSelectVehicle(bus.id)}
                    >
                      <Bus size={17} />
                      <span>Veículo {bus.id}</span>
                      <small>
                        {Math.max(
                          0,
                          Math.round(
                            (Date.now() - new Date(bus.observedAt).getTime()) /
                              1000,
                          ),
                        )}
                        s atrás
                      </small>
                      {selectedVehicle === bus.id && <Check size={16} />}
                    </button>
                  ))}
                </div>
                {v && (
                  <p className="muted">
                    Acompanhando o veículo {v.id} no mapa. A posição é do
                    operador, não do seu telefone.
                  </p>
                )}
              </>
            )}
            <button className="primary" onClick={board}>
              Já embarquei <ArrowIcon />
            </button>
            <p className="muted small">
              Você confirma o embarque. A partir daqui, o GPS do seu telefone
              acompanha as próximas paradas.
            </p>
          </>
        ) : (
          <>
            {isMetro && (
              <p className="muted">
                O GPS pode falhar nos túneis. Use os nomes das estações para
                acompanhar sua viagem.
              </p>
            )}
            <div className="gps-state">
              <span className={fresh ? "pulse" : "warning-dot"} />
              {fresh
                ? `GPS do telefone · precisão ${Math.round(fix.accuracy)} m`
                : "Aguardando GPS preciso…"}
            </div>
            <div className="stop-timeline">
              {leg.stops.map((s, i) => (
                <div
                  key={s.id + ":" + i}
                  className={
                    (i < index ? "passed " : "") +
                    (i === index ? "current " : "")
                  }
                >
                  <span className="stop-dot" />
                  <div>
                    <strong>{s.name}</strong>
                    {i === leg.stops.length - 1 && (
                      <small>Seu desembarque</small>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button className="primary" onClick={next}>
              {stage < rides.length - 1
                ? "Desci · próxima conexão"
                : "Desci · finalizar viagem"}{" "}
              <Check size={18} />
            </button>
          </>
        )}
        <button className="notification-button" onClick={enableNotifications}>
          <Bell size={16} />
          {notificationEnabled
            ? "Notificações ativadas"
            : "Ativar aviso de desembarque"}
        </button>
        {hidden && (
          <p className="error">
            Rastreamento pode ser pausado com o app em segundo plano.
          </p>
        )}
        {notice && (
          <p className="muted" role="status">
            {notice}
          </p>
        )}
        <p className="tracking-note">
          <ShieldCheck size={15} /> Sua posição não é salva no servidor.
          Mantenha o app aberto e a tela ligada para acompanhar o GPS e receber
          o aviso.
        </p>
        <details>
          <summary>Tarifa e estimativas</summary>
          {route.fare.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </details>
      </div>
    </section>
  );
}
function ArrowIcon() {
  return <Check size={18} />;
}
