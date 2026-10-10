import { useCallback, useEffect, useState, useRef } from "react";
import type { Fix } from "@cria/shared";
import { track } from "../lib/analytics";
export function useLocation() {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [tracking, setTracking] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onFix = useCallback((p: GeolocationPosition) => {
    if (
      !mounted.current ||
      !Number.isFinite(p.coords.latitude) ||
      !Number.isFinite(p.coords.longitude)
    )
      return;
    setFix({
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      accuracy: p.coords.accuracy,
      timestamp: p.timestamp,
    });
    setError(null);
    setPending(false);
  }, []);
  const onError = useCallback((e: Pick<GeolocationPositionError, "code">) => {
    if (!mounted.current) return;
    setPending(false);
    setError(
      e.code === 1
        ? "Localização bloqueada. No Safari, abra os ajustes deste site e permita Localização. No iPhone, confira também Ajustes › Privacidade e Segurança › Serviços de Localização › Sites do Safari. Você pode escolher a origem pelo endereço."
        : e.code === 3
          ? "A localização demorou a responder. Confira a permissão do site e os Serviços de Localização do aparelho, depois tente novamente ou digite a origem."
          : "Localização indisponível. Ative os Serviços de Localização do aparelho e tente em uma área aberta, ou digite a origem.",
    );
  }, []);
  const locate = useCallback(() => {
    const current = ++generation.current;
    clearTimeout(timer.current);
    setError(null);
    track("location_request");
    if (!window.isSecureContext || !navigator.geolocation) {
      setPending(false);
      setError(
        !window.isSecureContext
          ? "A localização precisa de uma conexão HTTPS. Abra https://moovit.joaocyrino.com ou digite a origem."
          : "Este navegador não oferece localização. Digite a origem.",
      );
      track("location_result", {
        result: !window.isSecureContext ? "insecure" : "unsupported",
      });
      return;
    }
    setPending(true);
    const active = () => current === generation.current && mounted.current;
    // Bound the UI wait even when Safari never calls back while awaiting permission. A later fix remains useful.
    timer.current = setTimeout(() => {
      if (active()) {
        onError({ code: 3 });
        track("location_result", { result: "timeout" });
      }
    }, 25_000);
    const success = (p: GeolocationPosition) => {
      if (!active()) return;
      clearTimeout(timer.current);
      onFix(p);
      track("location_result", {
        result: "success",
        accuracy:
          p.coords.accuracy < 50
            ? "fine"
            : p.coords.accuracy < 500
              ? "medium"
              : "coarse",
      });
    };
    const failure = (e: GeolocationPositionError) => {
      if (!active()) return;
      clearTimeout(timer.current);
      onError(e);
      track("location_result", {
        result:
          e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable",
      });
    };
    // Call directly within the user's tap: Safari need not support navigator.permissions.
    navigator.geolocation.getCurrentPosition(
      (p) => {
        success(p);
        if (active() && p.coords.accuracy > 50)
          navigator.geolocation.getCurrentPosition(
            (refined) => {
              if (active() && refined.coords.accuracy < p.coords.accuracy)
                onFix(refined);
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
          );
      },
      (e) => {
        if (!active()) return;
        if (e.code === 1) failure(e);
        else
          navigator.geolocation.getCurrentPosition(success, failure, {
            enableHighAccuracy: true,
            maximumAge: 30_000,
            timeout: 12_000,
          });
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 10_000 },
    );
  }, [onFix, onError]);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    // Restore only an already granted permission; a fresh permission request is user initiated.
    try {
      navigator.permissions
        ?.query({ name: "geolocation" })
        .then((status) => {
          if (!cancelled && status.state === "granted") locate();
        })
        .catch(() => {});
    } catch {} // Older Safari may throw synchronously for unsupported permission descriptors.
    return () => {
      cancelled = true;
      mounted.current = false;
      ++generation.current;
      clearTimeout(timer.current);
    };
  }, [locate]);
  useEffect(() => {
    if (!tracking || !navigator.geolocation || !window.isSecureContext) return;
    const watch = navigator.geolocation.watchPosition(
      onFix,
      (e) => {
        onError(e);
        if (e.code === 1) setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [tracking, onFix, onError]);
  return { fix, error, pending, locate, tracking, setTracking };
}
