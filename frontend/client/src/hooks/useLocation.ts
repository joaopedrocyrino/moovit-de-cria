import { useEffect, useState, useRef } from "react";
import type { Fix } from "@cria/shared";
export function useLocation() {
  const [fix, setFix] = useState<Fix | null>(null),
    [error, setError] = useState<string | null>(null),
    [tracking, setTracking] = useState(false);
  const watch = useRef<number | null>(null);
  const onFix = (p: GeolocationPosition) => {
    setFix({
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      accuracy: p.coords.accuracy,
      timestamp: p.timestamp,
    });
    setError(null);
  };
  const onError = (e: GeolocationPositionError) =>
    setError(
      e.code === 1
        ? "Permita a localização no navegador ou escolha a origem pelo endereço."
        : "GPS indisponível. Vá para uma área aberta ou escolha a origem manualmente.",
    );
  function locate() {
    if (!navigator.geolocation) {
      setError("Este navegador não oferece GPS.");
      return;
    }
    navigator.geolocation.getCurrentPosition(onFix, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  }
  useEffect(() => {
    if (!tracking || !navigator.geolocation) return;
    watch.current = navigator.geolocation.watchPosition(onFix, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000,
    });
    return () => {
      if (watch.current !== null)
        navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    };
  }, [tracking]);
  return { fix, error, locate, tracking, setTracking };
}
