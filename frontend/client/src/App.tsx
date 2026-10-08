import { lazy, Suspense, useCallback, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bus, Menu, X, ArrowUpRight } from "lucide-react";
import { api } from "./api";
import type { Config, Itinerary, Place, Plan, PlanTiming } from "@cria/shared";
import { useLocation } from "./hooks/useLocation";
import MapView from "./components/MapView";
import BottomSheet from "./components/BottomSheet";
import { useRouteVehicles } from "./hooks/useRouteVehicles";
import { useMobile } from "./hooks/useMobile";
import SearchPanel from "./components/SearchPanel";
import RouteList from "./components/RouteList";
import "./App.css";
const JourneyPanel = lazy(() => import("./components/JourneyPanel"));
export default function App() {
  const location = useLocation();
  const mobile = useMobile();
  const [expanded, setExpanded] = useState(false);
  const compact = mobile && !expanded;
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api<Config>("/config"),
    staleTime: 60000,
  });
  const [route, setRoute] = useState<Itinerary | null>(null),
    [vehicle, setVehicle] = useState<string | null>(null),
    [info, setInfo] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const [gpsAddress, setGpsAddress] = useState<string | null>(null);
  const plan = useMutation({
    mutationFn: ({
      from,
      to,
      payment,
      timing,
    }: {
      from: Place;
      to: Place;
      payment: string;
      timing: PlanTiming;
    }) =>
      api<Plan>("/plans", {
        from: from.point,
        to: to.point,
        payment,
        ...timing,
      }),
  });
  useEffect(() => {
    location.locate();
    const handler = () => setOnline(navigator.onLine);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("offline", handler);
    };
  }, []);
  useEffect(() => {
    if (location.fix && !gpsAddress)
      api<Place | null>("/places/reverse", {
        lat: location.fix.lat,
        lon: location.fix.lon,
      })
        .then((p) =>
          setGpsAddress(p?.label.split(",")[0] || "Sua localização no mapa"),
        )
        .catch(() => setGpsAddress("Sua localização no mapa"));
  }, [location.fix, gpsAddress]);
  const vehicles = useRouteVehicles(route);
  const selectVehicle = useCallback((id: string) => setVehicle(id || null), []);
  const stopTrip = () => {
    setRoute(null);
    setExpanded(true);
    setVehicle(null);
    location.setTracking(false);
  };
  return (
    <main className="app-shell">
      <MapView
        fix={location.fix}
        route={route}
        vehicles={vehicles}
        selectedVehicle={vehicle}
        onVehicle={selectVehicle}
        locate={location.locate}
        tilesUrl={
          config.data?.tilesUrl ||
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        }
      />
      <header className="brand-bar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Bus size={21} />
          </span>
          <span>
            moovit{" "}
            <b>
              de cria<span className="brand-dot">.</span>
            </b>
          </span>
        </a>
        <span className="brand-city">RIO DE JANEIRO / RJ</span>
        <button
          className="menu-button"
          aria-label="Sobre o aplicativo"
          onClick={() => setInfo(true)}
        >
          <Menu size={20} />
        </button>
      </header>
      <BottomSheet mobile={mobile} expanded={expanded} onChange={setExpanded}>
        {!route ? (
          <>
            <SearchPanel
              location={location.fix}
              locationLabel={gpsAddress}
              locate={location.locate}
              compact={compact}
              onExpand={() => setExpanded(true)}
              onPlan={(from, to, payment, timing) => {
                setExpanded(true);
                plan.mutate({ from, to, payment, timing });
              }}
              pending={plan.isPending}
              disabled={!online || !config.data?.dataReady}
            />
            <div hidden={compact}>
              {!online && (
                <p className="status-notice">
                  Você está offline. O GPS do telefone pode continuar, mas rotas
                  e veículos precisam de conexão.
                </p>
              )}
              {location.error && (
                <p className="status-notice">{location.error}</p>
              )}
              {config.data && !config.data.dataReady && (
                <p className="status-notice">
                  Os horários ainda não estão disponíveis. Tente novamente em
                  alguns minutos.
                </p>
              )}
              {config.error && (
                <p className="status-notice">
                  Não foi possível conectar ao serviço de rotas.
                </p>
              )}
              {plan.error && (
                <p className="status-notice" role="alert">
                  {plan.error.message}
                </p>
              )}
              {plan.data && (
                <>
                  <RouteList
                    routes={plan.data.itineraries}
                    arriveBy={!!plan.variables?.timing.arriveBy}
                    selected={null}
                    onSelect={(r) => {
                      setRoute(r);
                      setExpanded(false);
                      setVehicle(null);
                    }}
                  />
                  <details className="plan-notices">
                    <summary>Sobre estas rotas e tarifas</summary>
                    {plan.data.notices.map((n) => (
                      <p key={n}>{n}</p>
                    ))}
                    <p>
                      Horários atualizados em{" "}
                      {new Date(plan.data.importedAt).toLocaleDateString(
                        "pt-BR",
                      )}
                      .
                    </p>
                  </details>
                </>
              )}
              <footer className="panel-footer">
                Feito pra quem faz o Rio acontecer. <span>🌴</span>
              </footer>
            </div>
          </>
        ) : (
          <Suspense
            fallback={<p className="status-notice">Abrindo sua viagem…</p>}
          >
            <JourneyPanel
              key={route.id}
              compact={compact}
              onExpand={() => setExpanded(true)}
              onCollapse={() => setExpanded(false)}
              route={route}
              fix={location.fix}
              onBack={stopTrip}
              selectedVehicle={vehicle}
              onSelectVehicle={selectVehicle}
              setTracking={location.setTracking}
            />
          </Suspense>
        )}
      </BottomSheet>
      {gpsAddress && !route && (
        <div className="location-label">📍 {gpsAddress}</div>
      )}
      {info && (
        <div className="info-backdrop" onClick={() => setInfo(false)}>
          <section
            className="info-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="info-close"
              aria-label="Fechar"
              onClick={() => setInfo(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">DO RIO, PRO RIO</span>
            <h2 id="about-title">Um corre mais leve.</h2>
            <p>
              Rotas municipais, GPS público e avisos de desembarque. Sem
              cobrança e sem anúncios.
            </p>
            <h3>O que está disponível</h3>
            <p>
              Ônibus municipais, BRT e MetrôRio (linhas 1/4 e 2). O metrô usa
              tempos estimados, sem GPS público de trens. VLT, trem e barcas
              ainda não entram nas rotas.
            </p>
            <h3>Localização e avisos</h3>
            <p>
              Precisão depende do aparelho, do sinal e da permissão do
              navegador. Mantenha este app aberto e a tela ligada: iPhone e
              Android podem suspender GPS quando a tela bloqueia. Você confirma
              o embarque e o desembarque.
            </p>
            <p>
              No iPhone, adicione à Tela de Início para habilitar notificações
              compatíveis. Nenhum alerta em segundo plano é garantido nesta
              versão.
            </p>
            <h3>Seus dados</h3>
            <p>
              Sua posição acompanha a viagem no telefone. Origem/destino são
              enviados para calcular a rota e buscar endereços, sem histórico
              pessoal no servidor. A busca de endereço usa
              OpenStreetMap/Nominatim e o mapa usa tiles públicos; esses
              provedores recebem as respectivas consultas.
            </p>
            <a
              href="https://transportes.prefeitura.rio/subsidio/"
              target="_blank"
              rel="noreferrer"
            >
              Dados de transporte da Prefeitura <ArrowUpRight size={14} />
            </a>
          </section>
        </div>
      )}
    </main>
  );
}
