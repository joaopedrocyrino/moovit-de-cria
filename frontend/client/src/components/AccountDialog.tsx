import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bus,
  MapPin,
  Plus,
  Pencil,
  Star,
  Trash2,
  X,
  LoaderCircle,
  LogOut,
  ArrowRight,
  TrainFront,
} from "lucide-react";
import type {
  FavoriteLine,
  Place,
  SavedAddress,
  TransitLine,
  Vehicles,
} from "@cria/shared";
import type { AccountController } from "../hooks/useAccount";
import { track } from "../lib/analytics";
import { api } from "../api";
import { findFavorite, lineLabel } from "../lib/favorites";
import PlacePicker from "./PlacePicker";
import "./AccountDialog.css";

export type AccountIntent = {
  auth?: boolean;
  tab?: "addresses" | "lines" | "settings";
  place?: Place;
  line?: Pick<TransitLine, "mode" | "line">;
};
type Editor = { key: string; id?: string; alias: string; place: Place | null };
export default function AccountDialog({
  account,
  intent,
  onClose,
  onUseAddress,
}: {
  account: AccountController;
  intent: AccountIntent;
  onClose: () => void;
  onUseAddress: (address: SavedAddress, target: "from" | "to") => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState(
    intent.tab ?? (intent.line ? "lines" : "addresses"),
  );
  const [authOpen, setAuthOpen] = useState(!account.user && !!intent.auth);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<Editor | null>(
    intent.place ? { key: "initial", alias: "", place: intent.place } : null,
  );
  const [lineQuery, setLineQuery] = useState("");
  const [debouncedLine, setDebouncedLine] = useState("");
  const [activeLine, setActiveLine] = useState<FavoriteLine | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newConfirmation, setNewConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const requestedLine = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    setDebouncedLine("");
    const timer = setTimeout(() => setDebouncedLine(lineQuery.trim()), 350);
    return () => clearTimeout(timer);
  }, [lineQuery]);
  const matches = useQuery({
    queryKey: ["line-catalog", debouncedLine],
    queryFn: ({ signal }) =>
      api<TransitLine[]>(
        "/lines?query=" + encodeURIComponent(debouncedLine),
        undefined,
        signal,
      ),
    enabled: tab === "lines" && !!debouncedLine,
    staleTime: 5 * 60_000,
    retry: false,
  });
  async function action(
    work: () => Promise<unknown>,
    success?: string,
    after?: () => void,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      if (success) setMessage(success);
      after?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (intent.line && !requestedLine.current) {
      requestedLine.current = true;
      void action(
        () => account.saveLine(intent.line!),
        `${lineLabel(intent.line)} salva nas suas linhas.`,
      );
    }
  }, [account.user?.id, intent.line?.mode, intent.line?.line]);
  function authenticate(event: FormEvent) {
    event.preventDefault();
    if (authMode === "register" && password !== confirmation) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    void action(() =>
      account.authenticate(authMode, {
        email,
        password,
        ...(authMode === "register" ? { name } : {}),
      }),
    );
  }
  function switchTab(next: typeof tab) {
    setTab(next);
    setError("");
    setMessage("");
    setActiveLine(null);
  }
  useEffect(() => {
    if (!authOpen)
      track("saved_open", { tab, storage: account.user ? "account" : "guest" });
  }, [tab, authOpen, account.user?.id]);
  const accountReady = !account.pending && !account.error;
  return (
    <dialog
      ref={dialog}
      className="account-dialog"
      aria-labelledby="account-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="account-dialog-content">
        <header className="account-header">
          <span className="eyebrow">SEU CORRE, DO SEU JEITO</span>
          <button
            type="button"
            className="account-close"
            aria-label="Fechar conta"
            onClick={onClose}
          >
            <X size={20} />
          </button>
          <h2 id="account-title">
            {account.user
              ? `Salve, ${account.user.name.split(" ")[0]}.`
              : "Seu Rio, do seu jeito."}
          </h2>
          <p>
            {account.user
              ? "Seus lugares e linhas, sempre à mão."
              : "Salve seus lugares e as linhas que fazem parte do seu dia."}
          </p>
        </header>
        {error && (
          <p className="account-feedback error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="account-feedback success" role="status">
            {message}
          </p>
        )}
        {authOpen && account.pending && (
          <p className="account-feedback" role="status">
            <LoaderCircle size={16} className="spin" /> Abrindo sua conta…
          </p>
        )}
        {authOpen && account.error && (
          <div className="account-feedback error" role="alert">
            Não foi possível conectar à sua conta.{" "}
            <button type="button" onClick={() => void account.refresh()}>
              Tentar novamente
            </button>
          </div>
        )}
        {!account.user && authOpen ? (
          <>
            <button
              type="button"
              className="account-text-button"
              onClick={() => setAuthOpen(false)}
            >
              Voltar aos lugares e linhas deste navegador
            </button>
            <div
              className="account-tabs"
              role="tablist"
              aria-label="Acesso à conta"
            >
              <button
                role="tab"
                type="button"
                aria-selected={authMode === "login"}
                onClick={() => {
                  setAuthMode("login");
                  setError("");
                }}
              >
                Entrar
              </button>
              <button
                role="tab"
                type="button"
                aria-selected={authMode === "register"}
                onClick={() => {
                  setAuthMode("register");
                  setError("");
                }}
              >
                Criar conta
              </button>
            </div>
            <form className="account-form" onSubmit={authenticate}>
              {authMode === "register" && (
                <label>
                  Seu nome
                  <input
                    autoComplete="name"
                    required
                    maxLength={60}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              <label>
                E-mail
                <input
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  aria-describedby={
                    authMode === "register"
                      ? "account-password-hint"
                      : undefined
                  }
                  autoComplete={
                    authMode === "login" ? "current-password" : "new-password"
                  }
                  required
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {authMode === "register" && (
                <small id="account-password-hint" className="account-hint">
                  Use pelo menos 12 caracteres. Uma frase funciona bem.
                </small>
              )}
              {authMode === "register" && (
                <label>
                  Confirmar senha
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              )}
              <button
                type="submit"
                className="primary"
                disabled={busy || !accountReady}
              >
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <ArrowRight size={17} />
                )}
                {busy
                  ? "Um instante…"
                  : authMode === "login"
                    ? "Entrar na conta"
                    : "Criar minha conta"}
              </button>
            </form>
            <p className="account-privacy">
              Sua conta guarda apenas o que você decidir salvar. Você também
              pode buscar rotas sem entrar.
            </p>
          </>
        ) : (
          <>
            {!account.user && (
              <p className="account-privacy">
                Salvos apenas neste navegador. Ao entrar, seus favoritos locais
                continuam aqui para quando você sair da conta.{" "}
                <button
                  type="button"
                  className="account-text-button"
                  onClick={() => setAuthOpen(true)}
                >
                  Entrar ou criar conta
                </button>
              </p>
            )}
            <nav className="account-tabs" role="tablist" aria-label="Sua conta">
              {(
                [
                  ["addresses", "Lugares"],
                  ["lines", "Linhas"],
                  ["settings", "Conta"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  role="tab"
                  id={`account-tab-${value}`}
                  aria-controls={`account-panel-${value}`}
                  aria-selected={tab === value}
                  onClick={() =>
                    value === "settings" && !account.user
                      ? setAuthOpen(true)
                      : switchTab(value)
                  }
                >
                  {label}
                </button>
              ))}
            </nav>
            {account.savedPending && (
              <p className="account-feedback" role="status">
                <LoaderCircle size={15} className="spin" /> Carregando seus
                favoritos…
              </p>
            )}
            {account.savedError && (
              <p className="account-feedback error" role="alert">
                Não foi possível carregar seus favoritos.{" "}
                <button
                  type="button"
                  onClick={() => void account.refreshSaved()}
                >
                  Tentar novamente
                </button>
              </p>
            )}
            <section
              className="account-panel"
              role="tabpanel"
              id={`account-panel-${tab}`}
              aria-labelledby={`account-tab-${tab}`}
            >
              {tab === "addresses" && (
                <>
                  <div className="account-section-heading">
                    <div>
                      <h3>Seus lugares</h3>
                      <p>Um apelido, um toque, partiu.</p>
                    </div>
                    <button
                      type="button"
                      className="account-add"
                      disabled={busy}
                      onClick={() => {
                        setEditor({
                          key: crypto.randomUUID(),
                          alias: "",
                          place: null,
                        });
                        setError("");
                      }}
                    >
                      <Plus size={16} /> Novo lugar
                    </button>
                  </div>
                  {editor && (
                    <form
                      className="account-form account-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (editor.place)
                          void action(
                            () =>
                              account.saveAddress(
                                editor.alias,
                                editor.place!,
                                editor.id,
                              ),
                            "Lugar salvo.",
                            () => setEditor(null),
                          );
                      }}
                    >
                      <h4>{editor.id ? "Editar lugar" : "Salvar um lugar"}</h4>
                      <label>
                        Apelido
                        <input
                          autoComplete="off"
                          required
                          maxLength={40}
                          placeholder="Casa, Trabalho, Academia…"
                          value={editor.alias}
                          onChange={(event) =>
                            setEditor({ ...editor, alias: event.target.value })
                          }
                        />
                      </label>
                      <PlacePicker
                        key={editor.key}
                        place={editor.place}
                        onChange={(place) => setEditor({ ...editor, place })}
                      />
                      <div className="account-form-actions">
                        <button
                          type="submit"
                          className="primary"
                          disabled={
                            busy || !editor.place || !editor.alias.trim()
                          }
                        >
                          {busy ? "Salvando…" : "Salvar lugar"}
                        </button>
                        <button
                          type="button"
                          className="account-text-button"
                          onClick={() => setEditor(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  )}
                  {!account.savedPending &&
                    !account.savedError &&
                    !account.addresses.length &&
                    !editor && (
                      <div className="account-empty">
                        <MapPin size={29} />
                        <h4>Seus pontos de partida.</h4>
                        <p>
                          Salve sua casa, trabalho ou aquele lugar que você
                          sempre visita. Eles aparecem na busca de origem e
                          destino.
                        </p>
                      </div>
                    )}
                  <ul className="account-saved-list">
                    {account.addresses.map((address) => (
                      <li className="account-saved-card" key={address.id}>
                        <div className="account-saved-title">
                          <MapPin size={18} />
                          <div>
                            <strong>{address.alias}</strong>
                            <p>{address.address}</p>
                          </div>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Editar ${address.alias}`}
                            disabled={busy}
                            onClick={() =>
                              setEditor({
                                key: crypto.randomUUID(),
                                id: address.id,
                                alias: address.alias,
                                place: {
                                  label: address.address,
                                  point: address.point,
                                },
                              })
                            }
                          >
                            <Pencil size={16} />
                          </button>
                        </div>
                        <div className="account-card-actions">
                          <button
                            type="button"
                            onClick={() => onUseAddress(address, "from")}
                          >
                            Usar como origem
                          </button>
                          <button
                            type="button"
                            onClick={() => onUseAddress(address, "to")}
                          >
                            Usar como destino
                          </button>
                          <button
                            type="button"
                            className="account-remove"
                            aria-label={`Excluir ${address.alias}`}
                            disabled={busy}
                            onClick={() =>
                              void action(
                                () => account.deleteAddress(address.id),
                                "Lugar excluído.",
                              )
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {tab === "lines" && (
                <>
                  <div className="account-section-heading">
                    <div>
                      <h3>Suas linhas</h3>
                      <p>As de sempre, sem procurar de novo.</p>
                    </div>
                  </div>
                  <label className="account-line-search">
                    Adicionar uma linha
                    <input
                      type="search"
                      autoComplete="off"
                      maxLength={80}
                      aria-label="Buscar linha para favoritar"
                      placeholder="Número da linha ou nome"
                      value={lineQuery}
                      onChange={(event) => setLineQuery(event.target.value)}
                    />
                  </label>
                  {lineQuery.trim() &&
                    (debouncedLine !== lineQuery.trim() ||
                      matches.isFetching) && (
                      <p className="muted" role="status">
                        Buscando linhas…
                      </p>
                    )}
                  {matches.error && (
                    <p className="error" role="alert">
                      {matches.error.message}
                    </p>
                  )}
                  {debouncedLine === lineQuery.trim() &&
                    matches.data &&
                    lineQuery.trim() && (
                      <ul
                        className="account-line-results"
                        aria-label="Linhas encontradas"
                      >
                        {matches.data.map((line) => {
                          const favorite = findFavorite(account.lines, line);
                          return (
                            <li key={`${line.mode}:${line.line}`}>
                              <div>
                                <strong>{lineLabel(line)}</strong>
                                <small>{line.name}</small>
                              </div>
                              <button
                                type="button"
                                className="account-line-star"
                                aria-label={`${favorite ? "Remover" : "Favoritar"} ${lineLabel(line)}`}
                                disabled={busy}
                                onClick={() =>
                                  void action(
                                    () =>
                                      favorite
                                        ? account.deleteLine(favorite.id)
                                        : account.saveLine(line),
                                    favorite
                                      ? "Linha removida."
                                      : "Linha salva.",
                                  )
                                }
                              >
                                <Star
                                  size={19}
                                  fill={favorite ? "currentColor" : "none"}
                                />
                              </button>
                            </li>
                          );
                        })}
                        {matches.data.length === 0 && (
                          <li className="muted">
                            Nenhuma linha encontrada nos horários disponíveis.
                          </li>
                        )}
                      </ul>
                    )}
                  {!account.savedPending &&
                    !account.savedError &&
                    !account.lines.length && (
                      <div className="account-empty">
                        <Bus size={29} />
                        <h4>Seu Rio tem suas linhas.</h4>
                        <p>
                          Busque uma linha acima ou toque na estrela ao lado de
                          uma linha nas suas rotas.
                        </p>
                      </div>
                    )}
                  <ul className="account-saved-list">
                    {account.lines.map((line) => (
                      <li className="account-saved-card" key={line.id}>
                        <div className="account-saved-title">
                          {line.mode === "metro" ? (
                            <TrainFront size={20} />
                          ) : (
                            <Bus size={20} />
                          )}
                          <div>
                            <strong>{lineLabel(line)}</strong>
                            <p>{line.name}</p>
                          </div>
                          <button
                            type="button"
                            className="icon-button account-remove"
                            aria-label={`Excluir ${lineLabel(line)}`}
                            disabled={busy}
                            onClick={() =>
                              void action(
                                () => account.deleteLine(line.id),
                                "Linha removida.",
                                () => {
                                  if (activeLine?.id === line.id)
                                    setActiveLine(null);
                                },
                              )
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {line.mode === "metro" ? (
                          <p className="account-hint">
                            Horários estimados nas rotas. Não há GPS público de
                            trens.
                          </p>
                        ) : (
                          <button
                            type="button"
                            className="account-text-button"
                            onClick={() => setActiveLine(line)}
                          >
                            Ver GPS público <ArrowRight size={13} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {activeLine && <LineFleet line={activeLine} />}
                </>
              )}
              {tab === "settings" && account.user && (
                <>
                  <div className="account-profile">
                    <strong>{account.user.name}</strong>
                    <span>{account.user.email}</span>
                  </div>
                  <button
                    type="button"
                    className="account-logout"
                    disabled={busy}
                    onClick={() =>
                      void action(account.logout, undefined, onClose)
                    }
                  >
                    <LogOut size={17} /> Sair desta conta
                  </button>
                  <details className="account-settings">
                    <summary>Alterar senha</summary>
                    <form
                      className="account-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (newPassword !== newConfirmation) {
                          setError("As novas senhas precisam ser iguais.");
                          return;
                        }
                        void action(
                          () =>
                            account.changePassword(
                              currentPassword,
                              newPassword,
                            ),
                          "Senha alterada. As outras sessões foram encerradas.",
                          () => {
                            setCurrentPassword("");
                            setNewPassword("");
                            setNewConfirmation("");
                          },
                        );
                      }}
                    >
                      <label>
                        Senha atual
                        <input
                          type="password"
                          autoComplete="current-password"
                          required
                          minLength={12}
                          maxLength={128}
                          value={currentPassword}
                          onChange={(event) =>
                            setCurrentPassword(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Nova senha
                        <input
                          type="password"
                          autoComplete="new-password"
                          required
                          minLength={12}
                          maxLength={128}
                          value={newPassword}
                          onChange={(event) =>
                            setNewPassword(event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Confirmar nova senha
                        <input
                          type="password"
                          autoComplete="new-password"
                          required
                          minLength={12}
                          maxLength={128}
                          value={newConfirmation}
                          onChange={(event) =>
                            setNewConfirmation(event.target.value)
                          }
                        />
                      </label>
                      <button type="submit" className="primary" disabled={busy}>
                        Alterar senha
                      </button>
                    </form>
                  </details>
                  <details className="account-settings account-danger">
                    <summary>Excluir minha conta</summary>
                    <p>Seus lugares, linhas e sessões serão excluídos.</p>
                    <form
                      className="account-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (deleteConfirmed)
                          void action(
                            () => account.deleteAccount(deletePassword),
                            undefined,
                            onClose,
                          );
                      }}
                    >
                      <label>
                        Confirme sua senha
                        <input
                          type="password"
                          autoComplete="current-password"
                          required
                          minLength={12}
                          maxLength={128}
                          value={deletePassword}
                          onChange={(event) =>
                            setDeletePassword(event.target.value)
                          }
                        />
                      </label>
                      <label className="account-checkbox">
                        <input
                          type="checkbox"
                          checked={deleteConfirmed}
                          onChange={(event) =>
                            setDeleteConfirmed(event.target.checked)
                          }
                        />{" "}
                        Quero excluir minha conta e meus favoritos.
                      </label>
                      <button
                        type="submit"
                        className="account-delete-button"
                        disabled={busy || !deleteConfirmed}
                      >
                        Excluir minha conta
                      </button>
                    </form>
                  </details>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </dialog>
  );
}

function LineFleet({ line }: { line: FavoriteLine }) {
  const gps = useQuery({
    queryKey: ["favorite-line-gps", line.line],
    queryFn: ({ signal }) =>
      api<Vehicles>(
        "/vehicles?line=" + encodeURIComponent(line.line),
        undefined,
        signal,
      ),
    refetchInterval: 20_000,
    retry: false,
  });
  const vehicles =
    gps.data?.vehicles.filter(
      (vehicle) => Date.now() - Date.parse(vehicle.observedAt) < 180_000,
    ) ?? [];
  return (
    <section className="account-fleet" aria-label={`GPS de ${lineLabel(line)}`}>
      <h4>{lineLabel(line)} · GPS público</h4>
      <p className="account-hint">
        Todos os sentidos. Posições recebidas, sem previsão de chegada.
      </p>
      {gps.isPending && (
        <p className="muted" role="status">
          Buscando veículos…
        </p>
      )}
      {gps.error && (
        <p className="error" role="alert">
          Não foi possível atualizar o GPS.
        </p>
      )}
      {gps.data && (
        <>
          <p>
            {vehicles.length}{" "}
            {vehicles.length === 1
              ? "veículo com GPS recente"
              : "veículos com GPS recente"}
          </p>
          {gps.data.message && (
            <p className="account-hint">{gps.data.message}</p>
          )}
          <ul>
            {vehicles.slice(0, 20).map((vehicle) => (
              <li key={vehicle.id}>
                <span>Veículo {vehicle.id}</span>
                <small>
                  Recebido às{" "}
                  {new Date(vehicle.observedAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
