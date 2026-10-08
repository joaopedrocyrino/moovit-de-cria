import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./MapView.css";
import { LocateFixed, Plus, Minus } from "lucide-react";
import type { Point, Fix, Itinerary } from "@cria/shared";
import { api } from "../api";
import { routeLayers, type MapVehicle } from "../lib/routeVehicles";
import { clipShape } from "../lib/journey";
type Props = {
  fix: Fix | null;
  route: Itinerary | null;
  vehicles: MapVehicle[];
  selectedVehicle: string | null;
  onVehicle: (id: string) => void;
  locate: () => void;
  tilesUrl: string;
};
export default function MapView({
  fix,
  route,
  vehicles,
  selectedVehicle,
  onVehicle,
  locate,
  tilesUrl,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    routeLayer = useRef<L.LayerGroup | null>(null),
    gpsLayer = useRef<L.LayerGroup | null>(null),
    vehicleLayer = useRef<L.LayerGroup | null>(null);
  const centered = useRef(false);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 10,
      maxZoom: 19,
      maxBounds: [
        [-23.19, -43.95],
        [-22.6, -42.98],
      ],
      maxBoundsViscosity: 0.7,
    }).setView([-22.924, -43.228], 12);
    map.current = m;
    L.tileLayer(tilesUrl, {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(m);
    routeLayer.current = L.layerGroup().addTo(m);
    gpsLayer.current = L.layerGroup().addTo(m);
    vehicleLayer.current = L.layerGroup().addTo(m);
    m.on("dragstart", () => setFollow(false));
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, [tilesUrl]);
  useEffect(() => {
    const m = map.current,
      layer = gpsLayer.current;
    if (!m || !layer || !fix) return;
    layer.clearLayers();
    L.circle([fix.lat, fix.lon], {
      radius: fix.accuracy,
      color: "#2570db",
      weight: 1,
      fillOpacity: 0.08,
    }).addTo(layer);
    L.circleMarker([fix.lat, fix.lon], {
      radius: 8,
      color: "#fff",
      weight: 3,
      fillColor: "#2570db",
      fillOpacity: 1,
    }).addTo(layer);
    if (follow || !centered.current) {
      m.setView([fix.lat, fix.lon], centered.current ? m.getZoom() : 15, {
        animate: true,
      });
      centered.current = true;
    }
  }, [fix, follow]);
  useEffect(() => {
    const m = map.current,
      layer = routeLayer.current;
    if (!m || !layer) return;
    layer.clearLayers();
    if (!route) return;
    setFollow(false);
    const bounds: L.LatLngExpression[] = [];
    let cancelled = false;
    const layers = routeLayers(route);
    for (const leg of route.legs) {
      const routeColor =
        layers.find(
          (layer) =>
            layer.leg.routeId === leg.routeId &&
            layer.leg.direction === leg.direction,
        )?.color ?? "#155c49";
      const points = leg.stops.map(
        (s) => [s.point.lat, s.point.lon] as L.LatLngTuple,
      );
      bounds.push(...points);
      const line = L.polyline(points, {
        color: leg.kind === "walk" ? "#75827b" : routeColor,
        weight: leg.kind === "walk" ? 4 : 7,
        dashArray: leg.kind === "walk" ? "6 9" : undefined,
        opacity: 0.9,
      }).addTo(layer);
      if (leg.shapeId)
        api<Point[]>("/shapes/" + encodeURIComponent(leg.shapeId))
          .then((shape) => {
            if (!cancelled)
              line.setLatLngs(clipShape(shape, leg).map((p) => [p.lat, p.lon]));
          })
          .catch(() => {});
      if (leg.kind === "transit") {
        L.circleMarker([leg.from.point.lat, leg.from.point.lon], {
          radius: 5,
          color: routeColor,
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 3,
        }).addTo(layer);
        L.circleMarker([leg.to.point.lat, leg.to.point.lon], {
          radius: 5,
          color: routeColor,
          fillColor: "#d6ee75",
          fillOpacity: 1,
          weight: 3,
        }).addTo(layer);
      }
    }
    if (bounds.length)
      m.fitBounds(L.latLngBounds(bounds), { padding: [45, 65], maxZoom: 15 });
    return () => {
      cancelled = true;
    };
  }, [route]);
  useEffect(() => {
    const layer = vehicleLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const v of vehicles) {
      const marker = L.marker([v.point.lat, v.point.lon], {
        icon: L.divIcon({
          className:
            "vehicle-dot" + (selectedVehicle === v.id ? " chosen" : ""),
          html: "<span>🚍</span>",
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      }).addTo(layer);
      marker.getElement()?.style.setProperty("--vehicle-color", v.color);
      marker.on("click", () => onVehicle(v.id));
      const text = document.createElement("span");
      text.textContent = `${v.routeLabel} · veículo ${v.id}`;
      marker.bindTooltip(text);
    }
  }, [vehicles, selectedVehicle, onVehicle]);
  return (
    <div className="map-wrap">
      <div
        className="map-canvas"
        ref={host}
        aria-label="Mapa do Rio de Janeiro"
      />
      {route && (
        <div className="map-line-legend" aria-label="Linhas da viagem no mapa">
          {routeLayers(route).map((layer) => (
            <div key={`${layer.leg.routeId}:${layer.leg.direction}`}>
              <span style={{ background: layer.color }} />
              <small>
                {layer.label}
                {layer.leg.mode === "metro"
                  ? " · sem GPS"
                  : ` · ${vehicles.filter((v) => v.routeId === layer.leg.routeId && v.direction === layer.leg.direction).length} veículos`}
              </small>
            </div>
          ))}
        </div>
      )}
      <div className="map-controls">
        <button
          title="Minha localização"
          aria-label="Minha localização"
          onClick={() => {
            setFollow(true);
            locate();
          }}
        >
          <LocateFixed size={21} />
        </button>
        <button
          aria-label="Aumentar zoom"
          onClick={() => map.current?.zoomIn()}
        >
          <Plus size={21} />
        </button>
        <button
          aria-label="Diminuir zoom"
          onClick={() => map.current?.zoomOut()}
        >
          <Minus size={21} />
        </button>
      </div>
      <div className="map-caption">
        <span className="pulse" /> Rio de Janeiro{" "}
        <span>Ônibus + BRT + Metrô</span>
      </div>
    </div>
  );
}
