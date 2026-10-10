import { useEffect, useState } from "react";
import type { AccountData } from "@cria/shared";
import {
  GUEST_SAVED_KEY,
  emptySaved,
  readGuestSaved,
  writeGuestSaved,
} from "../lib/guestSaved";

export function useGuestSaved() {
  const [data, setData] = useState<AccountData>(() => {
    try {
      return readGuestSaved(window.localStorage);
    } catch {
      return emptySaved();
    }
  });
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key !== GUEST_SAVED_KEY && event.key !== null) return;
      try {
        setData(readGuestSaved(window.localStorage));
      } catch {
        setData(emptySaved());
      }
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  function change(mutate: (current: AccountData) => AccountData) {
    // Read at mutation time so another tab's latest saves are retained.
    let current;
    try {
      current = readGuestSaved(window.localStorage);
    } catch {
      throw new Error(
        "Seus favoritos não estão acessíveis neste navegador. Libere o armazenamento do site e tente novamente.",
      );
    }
    const next = mutate(current);
    writeGuestSaved(window.localStorage, next);
    setData(next);
  }
  return { data, change };
}
