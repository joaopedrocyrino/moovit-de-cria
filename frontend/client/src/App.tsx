import { lazy, Suspense, useCallback, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bus,
  Menu,
  X,
  ArrowUpRight,
  UserRound,
  Star,
  Sun,
  Moon,
  Bookmark,
  LocateFixed,
} from "lucide-react";
import { useTheme } from "./hooks/useTheme";
import PrivacyControls from "./components/PrivacyControls";
import { track } from "./lib/analytics";
import { api } from "./api";
import type {
  Config,
  Itinerary,
  Place,
  Plan,
  PlanTiming,
  TransitLine,
} from "@cria/shared";
import { useAccount } from "./hooks/useAccount";
import type { AccountIntent } from "./components/AccountDialog";
import { addressPlace } from "./lib/savedPlaces";
import { findFavorite, lineLabel } from "./lib/favorites";
import { useLocation } from "./hooks/useLocation";
import MapView from "./components/MapView";
import BottomSheet from "./components/BottomSheet";
import { useRouteVehicles } from "./hooks/useRouteVehicles";
import { useMobile } from "./hooks/useMobile";
import SearchPanel from "./components/SearchPanel";
import RouteList from "./components/RouteList";
import "./App.css";
const JourneyPanel = lazy(() => import("./components/JourneyPanel"));
const AccountDialog = lazy(() => import("./components/AccountDialog"));
export default function App() {
  const theme = useTheme();
  const account = useAccount();
  const [accountIntent, setAccountIntent] = useState<AccountIntent | null>(
    null,
  );
  const [savedSelection, setSavedSelection] = useState<{
    key: number;
    target: "from" | "to";
    place: Place;
  } | null>(null);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState("");
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
  const selectVehicle = useCallback((id: string) => {
    track("map_action", { control: "vehicle" });
    setVehicle(id || null);
  }, []);
  const stopTrip = () => {
    if (route) track("journey_step", { step: "back" });
    setRoute(null);
    setExpanded(true);
    setVehicle(null);
    location.setTracking(false);
  };
  async function toggleFavorite(line: TransitLine) {
    if (favoriteBusy) return;
    setFavoriteBusy(true);
    setFavoriteError("");
    try {
      const existing = findFavorite(account.lines, line);
      if (existing) await account.deleteLine(existing.id);
      else await account.saveLine(line);
    } catch (error) {
      setFavoriteError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a linha.",
      );
    } finally {
      setFavoriteBusy(false);
    }
  }
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
          type="button"
          className="menu-button theme-toggle"
          aria-label={
            theme.theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"
          }
          onClick={() => {
            theme.toggle();
            track("theme_change", {
              theme: theme.theme === "dark" ? "light" : "dark",
            });
          }}
        >
          {theme.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {!account.user && (
          <button
            type="button"
            className="menu-button"
            aria-label="Abrir lugares e linhas salvos"
            onClick={() => setAccountIntent({})}
          >
            <Bookmark size={18} />
          </button>
        )}
        <button
          type="button"
          className="account-button"
          aria-label={
            account.user ? "Abrir minha conta" : "Entrar ou criar conta"
          }
          onClick={() => setAccountIntent({ auth: !account.user })}
        >
          <UserRound size={18} />
          <span>
            {account.user ? account.user.name.split(" ")[0] : "Entrar"}
          </span>
        </button>
        <button
          className="menu-button"
          aria-label="Sobre o aplicativo"
          onClick={() => {
            track("about_open");
            setInfo(true);
          }}
        >
          <Menu size={20} />
        </button>
      </header>
      {(location.error || location.pending) && (
        <p
          className="location-feedback"
          role={location.error ? "alert" : "status"}
        >
          {location.error ||
            "Aguardando sua localização… Autorize o acesso se o navegador pedir."}
        </p>
      )}
      <BottomSheet
        mobile={mobile}
        expanded={expanded}
        onChange={(value) => {
          track("panel_change", { expanded: value });
          setExpanded(value);
        }}
      >
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
                track("route_search", {
                  timing: timing.arriveBy
                    ? "arrive"
                    : timing.departure
                      ? "depart"
                      : "now",
                  payment,
                });
                plan.mutate({ from, to, payment, timing });
              }}
              pending={plan.isPending}
              disabled={!online || !config.data?.dataReady}
              savedAddresses={account.addresses}
              onSavePlace={(place) => setAccountIntent({ place })}
              selection={savedSelection}
            />
            <div hidden={compact}>
              {!location.fix && (
                <div className="location-request">
                  <button
                    type="button"
                    className="account-text-button"
                    disabled={location.pending}
                    onClick={location.locate}
                  >
                    <LocateFixed size={16} />{" "}
                    {location.pending
                      ? "Buscando sua localização…"
                      : "Usar minha localização"}
                  </button>
                  <small>
                    Autorize a localização para usar sua posição como origem.
                  </small>
                </div>
              )}
              {account.lines.length > 0 && (
                <section
                  className="favorite-shortcuts"
                  aria-label="Suas linhas favoritas"
                >
                  <span>
                    <Star size={12} /> Suas linhas
                  </span>
                  <div>
                    {account.lines.map((line) => (
                      <button
                        type="button"
                        key={line.id}
                        onClick={() => setAccountIntent({ tab: "lines" })}
                      >
                        {lineLabel(line)}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {!online && (
                <p className="status-notice">
                  Você está offline. O GPS do telefone pode continuar, mas rotas
                  e veículos precisam de conexão.
                </p>
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
                    favorites={account.lines}
                    onFavorite={(line) => void toggleFavorite(line)}
                    favoriteBusy={favoriteBusy}
                    onSelect={(r) => {
                      track("route_selected", { legs: r.legs.length });
                      setRoute(r);
                      setExpanded(false);
                      setVehicle(null);
                    }}
                  />
                  {favoriteError && (
                    <p className="status-notice error" role="alert">
                      {favoriteError}
                    </p>
                  )}
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
                <span>Feito pra quem faz o Rio acontecer. 🌴</span>
                <button
                  type="button"
                  className="privacy-link"
                  onClick={() =>
                    window.dispatchEvent(new Event("cria:privacy-open"))
                  }
                >
                  Privacidade e cookies
                </button>
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
      {accountIntent && (
        <Suspense
          fallback={
            <p className="account-loading" role="status">
              Abrindo sua conta…
            </p>
          }
        >
          <AccountDialog
            key={account.user?.id ?? "guest"}
            account={account}
            intent={accountIntent}
            onClose={() => setAccountIntent(null)}
            onUseAddress={(address, target) => {
              stopTrip();
              setSavedSelection((previous) => ({
                key: (previous?.key ?? 0) + 1,
                target,
                place: addressPlace(address),
              }));
              setAccountIntent(null);
            }}
          />
        </Suspense>
      )}
      <PrivacyControls />
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
            <h3>Aparência</h3>
            <label>
              Tema{" "}
              <select
                aria-label="Preferência de tema"
                value={theme.preference}
                onChange={(event) => {
                  const value = event.target.value as
                    "system" | "light" | "dark";
                  theme.setPreference(value);
                  track("theme_change", { theme: value });
                }}
              >
                <option value="system">Seguir sistema</option>
                <option value="light">Claro</option>
                <option value="dark">Escuro</option>
              </select>
            </label>
            <h3>Seus dados</h3>
            <button
              type="button"
              className="privacy-link"
              onClick={() => {
                setInfo(false);
                window.dispatchEvent(new Event("cria:privacy-open"));
              }}
            >
              Privacidade e cookies
            </button>
            <p>
              Sem conta, os lugares com apelido e linhas favoritas ficam no
              armazenamento local deste navegador. Com conta, os favoritos ficam
              privados no servidor. A preferência de tema também fica neste
              navegador. Sua posição acompanha a viagem no telefone.
              Origem/destino são enviados para calcular a rota e buscar
              endereços, sem histórico de viagens no servidor. Se você criar uma
              conta, os lugares e linhas que decidir salvar ficam privados na
              sua conta. Você pode removê-los ou excluir a conta. A busca de
              endereço usa OpenStreetMap/Nominatim e o mapa usa tiles públicos;
              esses provedores recebem as respectivas consultas.
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
