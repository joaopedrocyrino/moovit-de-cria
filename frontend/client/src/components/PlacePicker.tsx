import { useEffect, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, MapPin } from "lucide-react";
import type { Place } from "@cria/shared";
import { api } from "../api";

export default function PlacePicker({
  place,
  onChange,
}: {
  place: Place | null;
  onChange: (place: Place | null) => void;
}) {
  const [text, setText] = useState(place?.label ?? "");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const term = text.trim();
  const needsSearch = open && !place && term.length >= 3;
  useEffect(() => {
    setDebounced("");
    setActive(-1);
    if (!needsSearch) return;
    const timer = setTimeout(() => setDebounced(term), 450);
    return () => clearTimeout(timer);
  }, [term, needsSearch]);
  const ready = needsSearch && debounced === term;
  const suggestions = useQuery({
    queryKey: ["places", debounced, undefined, undefined],
    queryFn: ({ signal }) =>
      api<Place[]>("/places/search", { query: debounced }, signal),
    enabled: ready,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const results = ready ? (suggestions.data ?? []) : [];
  function select(value: Place) {
    setText(value.label);
    onChange(value);
    setOpen(false);
  }
  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) =>
        event.key === "ArrowDown"
          ? (index + 1) % results.length
          : index <= 0
            ? results.length - 1
            : index - 1,
      );
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      select(results[Math.max(0, active)]);
    }
  }
  return (
    <div
      className="account-place-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label htmlFor="saved-address-search">Endereço ou lugar</label>
      <input
        id="saved-address-search"
        role="combobox"
        aria-label="Buscar endereço para salvar"
        aria-autocomplete="list"
        aria-expanded={open && needsSearch}
        aria-controls={
          open && needsSearch ? "saved-address-options" : undefined
        }
        aria-activedescendant={
          open && active >= 0 && results[active]
            ? `saved-address-option-${active}`
            : undefined
        }
        autoComplete="off"
        maxLength={180}
        value={text}
        placeholder="Busque e selecione um endereço"
        onFocus={() => setOpen(true)}
        onKeyDown={keyboard}
        onChange={(event) => {
          setText(event.target.value);
          onChange(null);
          setOpen(true);
        }}
      />
      {needsSearch && (
        <div className="account-suggestions">
          {(!ready || suggestions.isFetching) && (
            <p className="muted" role="status">
              <LoaderCircle size={15} className="spin" /> Buscando lugares…
            </p>
          )}
          {ready && suggestions.error && (
            <p className="error" role="alert">
              {suggestions.error.message}
            </p>
          )}
          <ul
            id="saved-address-options"
            role="listbox"
            aria-label="Endereços para salvar"
          >
            {results.map((result, index) => (
              <li
                role="presentation"
                key={`${result.label}:${result.point.lat}:${result.point.lon}`}
              >
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={`saved-address-option-${index}`}
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(result)}
                >
                  <MapPin size={16} />
                  <span>{result.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {ready &&
            suggestions.isSuccess &&
            !suggestions.isFetching &&
            results.length === 0 && (
              <p className="muted">
                Nenhum endereço encontrado. Inclua o bairro ou a rua.
              </p>
            )}
          {results.length > 0 && (
            <p className="account-attribution">
              © OpenStreetMap · catálogo local e Photon
            </p>
          )}
        </div>
      )}
      {place && (
        <p className="account-hint">
          Endereço selecionado. Salve com um apelido fácil de lembrar.
        </p>
      )}
    </div>
  );
}
