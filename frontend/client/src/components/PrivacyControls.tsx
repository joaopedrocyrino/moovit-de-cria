import { useEffect, useState, useSyncExternalStore } from "react";
import {
  chooseConsent,
  consentSnapshot,
  subscribeConsent,
} from "../lib/analytics";
import "./PrivacyControls.css";
export default function PrivacyControls() {
  const consent = useSyncExternalStore(subscribeConsent, consentSnapshot);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("cria:privacy-open", show);
    return () => window.removeEventListener("cria:privacy-open", show);
  }, []);
  async function choose(value: "accepted" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await chooseConsent(value);
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar a preferência.",
      );
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {(consent === null || open) && (
        <section
          className="privacy-panel"
          aria-labelledby="privacy-title"
          aria-live="polite"
        >
          <h2 id="privacy-title">Você escolhe os cookies</h2>
          <p>
            Cookies essenciais mantêm sua conta e a segurança. Com sua
            autorização, usamos cookies próprios para medir ações, falhas e
            desempenho e melhorar o app. Sem anúncios ou rastreamento entre
            sites.
          </p>
          <p>
            As análises usam um identificador aleatório deste navegador e ficam
            por até 90 dias. Não incluem senhas, e-mail, endereços digitados ou
            coordenadas. Você pode mudar a escolha aqui; ao recusar, apagamos as
            análises associadas a este navegador.
          </p>
          {consent && (
            <small>
              Análises {consent === "accepted" ? "ativadas" : "desativadas"}{" "}
              neste navegador.
            </small>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="privacy-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void choose("rejected")}
            >
              Recusar análises
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void choose("accepted")}
            >
              Aceitar análises
            </button>
          </div>
          {consent !== null && (
            <button
              type="button"
              className="account-text-button"
              onClick={() => setOpen(false)}
            >
              Fechar
            </button>
          )}
        </section>
      )}
    </>
  );
}
