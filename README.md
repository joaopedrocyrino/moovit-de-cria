# Moovit de Cria

A mobile-first Rio de Janeiro transit web app: no advertisements or paid GPS feature. React/TypeScript + Vite/Leaflet, .NET 10 REST API, and a read-only SQLite timetable snapshot. One deployable Docker monolith, behind the existing shared Caddy at **moovit.joaocyrino.com**.

## What works

- Map centered on your position after granting browser permission, with an accuracy circle and manual recentering.
- Destination search expands an editable origin above it; origin/destination swapping, direct editable fields and debounced place/address suggestions.
- Up to eight bus/BRT/metro alternatives, sorted by estimated arrival: transfers, walking time, departure/arrival times and BRL fare estimates.
- Route shapes and stops from the official GTFS; server-side live vehicle positions from the current SMTR ITS gateway. Select a specific vehicle on the map or list.
- Explicit “Já embarquei” enables high-accuracy phone GPS, stop progress, vibration and an optional notification before alighting. Confirm alighting to move to the next connection.
- Installable PWA shell, screen wake lock while riding when supported, graceful denied-GPS/no-route/no-live-data states. No simulated public vehicles or fake schedules in normal usage.
- Main-only GitHub Actions: tests → image build → deterministic browser checks → GHCR → shared droplet. Staging and pull requests trigger no Actions.

## Important current boundaries

The SMTR GTFS covers **municipal buses and BRT**. A bundled, verified MetrôRio station graph adds **lines 1/4 and 2**, including bus/BRT transfers, the regular operating calendar and the ordinary R$ 7.90 fare. Metro run times come from the operator’s public route planner; the assumed eight-minute headway (four-minute mean wait) is explicitly estimated. This is not a metro GTFS, live timetable or live train feed. Special operations, closures and last-train times need confirmation with the operator. Rail, VLT and ferries remain outside coverage.

Metro data/provenance: `src/Cria.Infrastructure/Data/metro.json`; [MetrôRio travel guide](https://www.metrorio.com.br/GuiaDoCliente/SuaViagem), [fare](https://www.metrorio.com.br/como-pagar/meios-e-tarifas). The graph is embedded in the application and requires no extra environment variable or GTFS reimport. Shapes connect station coordinates schematically, rather than tracing tunnel geometry. Internal same-station metro transfers incur one fare; street exits/reboarding and bus/BRT boardings remain separate. Browser GPS can fail underground, so subway alighting cannot be guaranteed from location alone.

Routing is a bounded earliest-arrival search with an optimistic reverse transit/walking cost to prioritize useful connections, not an enumeration of every mathematical path. It searches up to two transfers and three hours of travel. Frequency-based times, congestion and access/transfer walking are **estimates**. Walking uses straight-line distance × 1.3 at 1.2 m/s, not a sidewalk graph: barriers, crossings and steep terrain can make a path unsuitable. Production-grade pedestrian routing and live delay calibration remain follow-up work. The UI discloses these limits.

The current phone implementation tracks while the app is active. **Background GPS and screen-locked alighting alerts cannot be guaranteed by a web app**, including a Home Screen PWA. A wake lock helps while visible but does not bypass OS background restrictions. This version has local Notifications API/service-worker alerts, not a server Web Push subscription flow. Native/Capacitor background location or a future server alert based on a confirmed vehicle would be needed for stronger background guarantees. Safari/Home Screen notification permission requires a user gesture; always retain the in-app alert. Physical iPhone/Android field testing is still required.

## Run locally

Requirements: .NET 10 SDK, Node 22.18+ and Python 3. Native scripts also detect the standard macOS/Linux SDK locations when npm cannot find a shell alias.

```bash
cd ~/code/moovit-de-cria
cp .env.example .env
npm install
npm run install:web
npm run data:sync
npm run dev
```

- React: http://localhost:4193
- API: http://localhost:5193/api/health/ready
- Both support reload; Vite handles React refresh and .NET watch handles C#.
- The first real GTFS snapshot is already imported in the locally delivered project; `data:sync` refreshes it. `.data` is excluded from Git and image builds.
- `data:sync` reads `GTFS_URL` from root `.env` or environment. Import a downloaded ZIP using `python3 scripts/import_gtfs.py --file /path/to/gtfs.zip`.

On physical phones, HTTP over your Mac's LAN address is not a secure context. Use a trusted HTTPS development endpoint or the production HTTPS site for geolocation, notifications and wake lock. A desktop `localhost` exception does not apply to a remote phone.

## Docker

```bash
npm run data:sync
docker compose up -d --build app
```

Open http://localhost:5193 (API and bundled React together). Stop this app before native development to free port 5193. `make refresh` rebuilds both backend and frontend.

Docker-only import, without local Python:

```bash
docker compose --profile tools run --rm import
docker compose up -d --build app
```

The importer is a one-off job. No additional PostgreSQL/Redis/antivirus service is needed: the app has no accounts or personal trip records, and the timetable is a replaceable read-only SQLite artifact.

Production images are built in GitHub Actions with `PREPARE_GTFS=1`. The runner downloads and compiles the public Rio GTFS into `/app/snapshot/transit.sqlite`. Deployment installs that prepared snapshot into the persistent volume with bounded copying, SQLite validation and atomic replacement; it does not process the full CSV feed on the shared droplet. Snapshot installation rejects corrupt, expired or mismatched-source data and preserves the previous file on failure. Local Docker builds retain the existing host-volume/import flow.

The default public GTFS needs no new settings. For a different public feed, set the repository variable `GTFS_URL` to match the droplet’s `GTFS_URL`; never put a private URL or server `.env` into Actions. `refresh-data.sh` remains an explicit server-side download/import and needs sufficient resources. On a small shared droplet, publish a new release to prepare refreshed data on the runner instead.

## Architecture and data model

```text
src/Cria.Domain          Coordinates, services, routes, timetables, trips, fares
src/Cria.Application     Route search, calendars/frequencies, fare calculation, ports
src/Cria.Infrastructure  SQLite snapshot reader, bundled metro graph, SMTR GPS, rate-limited geocoding
src/Cria.Web             REST, validation/error responses, limits, React hosting
frontend/src/components Map, search, route list, lazy active journey + own CSS
frontend/src/lib         Pure GPS validation and stop-progress logic
scripts/import_gtfs.py  Streaming CSV ingestion and atomic snapshot replacement
tests                   Domain/provider tests + deterministic import/browser fixtures
```

SQLite stores stops, routing patterns/windows, service calendars/exceptions, GTFS shapes and provenance/import validity. The importer orders stop times on disk, accepts interleaved trips, deduplicates identical timetable patterns, preserves pickup/dropoff flags, and publishes with atomic rename only after success. Failed refreshes leave the previous snapshot usable. Services after midnight use the previous service day; `calendar_dates` overrides weekdays. Expired `feed_info` is rejected for planning.

All fare amounts are **integer centavos** throughout API and calculations. Missing/ambiguous GTFS fares remain unknown. “Tarifas individuais” sums boarding fares. Choosing Jaé enables an explicitly conditional BUC estimate for up to three eligible municipal boardings in three hours including BRT; same-direction/card eligibility is not verifiable from GTFS. Special/executive fares retain their GTFS price and never receive an automatic ordinary-fare discount. No personal discounts, BUM or free-transit eligibility are assumed. Bus–metro discounted integration is not assumed; only internal same-station transfers between metro lines avoid a second metro charge.

## REST API

| Endpoint                         | Purpose                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/config`                | Coverage, data readiness, tile configuration                                                                                             |
| `GET /api/health/live` / `ready` | Process / imported data health                                                                                                           |
| `POST /api/places/search`        | Photon autocomplete `{ "query": "...", "bias": { "lat": ..., "lon": ... } }`                                                             |
| `POST /api/places/reverse`       | Address for a selected `{ "lat": ..., "lon": ... }`                                                                                      |
| `POST /api/plans`                | `{ "from": {...}, "to": {...}, "payment": "individual" or "jae", "maxTransfers": 2, "departure": "ISO-8601" or "arriveBy": "ISO-8601" }` |
| `GET /api/vehicles?line=...`     | Shared public-line fleet; optional `routeId`/`direction` filters                                                                         |
| `GET /api/shapes/:id`            | GTFS route geometry / schematic metro stations                                                                                           |

GPS entries older than 180 seconds, future timestamps and invalid coordinates are excluded. Duplicate reports resolve the latest confirmed route/direction position per vehicle. Per-line refreshes are shared for 20 seconds across clients. The ITS endpoint returns one receipt-minute, not a full fleet: bootstrap reads the current and previous three minutes, then refreshes the current and previous minute. Pages are followed using the same minute and cursor. Reports are merged by vehicle ID; empty/partial minute batches do not erase previously received fresh positions. No simulated position is returned when an operator/feed fails. Reports from multiple providers are resolved before deduplication. Identifier-free reports preserve the last confirmed GPS report with its original position/time; explicit newer direction, variant or shape changes supersede it immediately. Missing identifiers never extend a position’s 180-second lifetime. Provider failures preserve only unexpired reports and are labeled as unavailable/last received GPS. Estimated timetable arrivals are separate from live vehicle GPS; no predicted vehicle arrival is invented from distance alone.

## Travel time, mobile panel and map fleets

- **Sair agora** is the default. **Sair às** sends `departure`; **Chegar até** sends `arriveBy`. Omit both for now and never send both together. The picker uses Rio time (UTC−03:00), independent of the phone timezone, and accepts the next seven days.
- Depart-at routing searches forward. Arrive-by routing searches backward over the same service calendars and hours, includes boarding waits, transfers and the final walk, and orders alternatives by latest feasible departure. Special operations and live congestion remain outside timetable estimates; arriving on time is not guaranteed.
- On mobile, drag the handle down to collapse or up to expand; tapping the handle also works. Before route selection the compact panel has only the destination search. Selecting a route or confirming boarding collapses to the current walk/boarding/next-stop/alighting status. Expanding reveals all controls and details; collapsing leaves tracking active. Desktop keeps the full sidebar.
- The map loads **all bus/BRT lines in the selected itinerary together**, including later connections. Each line/direction has a distinct marker color matching its path and legend. Only fresh vehicles confirmed for the exact GTFS variant and travel direction are displayed; opposite, unknown and stale positions are excluded. Repeated legs reuse the fleet without duplicate markers. Metro paths appear in the legend with no train GPS.
- Departure countdowns are explicitly timetable estimates, not vehicle ETAs. Phone GPS status and estimated schedules remain separate.

## Privacy, security and third-party services

- Phone tracking stays in browser memory. Coordinates sent for planning/reverse geocoding are not stored as user history, and default server logging omits request bodies.
- Public map tiles receive viewport requests; place/address autocomplete reaches Photon and reverse GPS lookup reaches Nominatim through the API. These providers have their own privacy policies. Install an appropriate provider/self-hosted service before scaling beyond moderate use.
- Photon powers autocomplete with a 450 ms client debounce, minimum three characters, cancellable requests, cache and Rio bounding-box/location bias. OpenStreetMap business-name coverage includes the verified Chora Café in Botafogo. Public demo usage must stay moderate; `AUTOCOMPLETE_URL` can point to your own Photon instance or a compatible provider. Nominatim is used only for one-off reverse GPS lookup, never keystroke autocomplete. Both use an identifying User-Agent, server cache and shared throttle.
- OpenStreetMap attribution stays visible. Tile URL is configurable through `Map__TilesUrl`; the service worker does not cache/prefetch external tiles or cache GPS/API responses.
- Planning concurrency capped; global per-IP API rate limit; exact trusted proxy IP discovered at deployment. No uploads, public admin or write-to-database API.
- Server `.env` belongs to the deploy user, mode 0600. SSH/GHCR credentials live in Actions secrets; deployment scripts never transfer the server file.

## Test

```bash
npm test
npm run build
npx playwright install chromium webkit
```

`npm test` covers routing/transfers, service calendars, exact/frequency schedules, after-midnight trips, money/BUC/unknown fares, GPS parser freshness, importer failure atomicity and phone stop-alert rules.

Browser tests use an **explicit synthetic feed** only in disposable testing environments, and intercept external geocoding/vehicle calls. They never overwrite the installed real snapshot. See `scripts/browser.mjs`; `BASE_URL` defaults to 5193, `BROWSER=webkit` selects the Safari engine. CI runs the compiled Docker app against a temporary test feed.

See [docs/deployment.md](docs/deployment.md) for the first push. Production GTFS/live feeds, precise arrival prediction, walkability and battery/background behavior must be verified on real journeys before relying on it for travel.

### Validation performed

- 48 .NET tests (including partial/empty GPS refreshes, minute bootstrap/pagination, missing provider identifiers, direction/variant changes, outages/expiry, scheduled departure, arrive-by, calendar/overnight rules, Photon parsing, metro routing/fares and shared GPS provider caching), 14 frontend logic tests (phone GPS, Rio time, compact status and all-line vehicle filtering) and 4 importer tests passed.
- Chromium and WebKit passed search → route selection → boarding → transfer checks against the compiled monolith at mobile and desktop widths. Inline autocomplete, keyboard selection, invalidating edited coordinates and stale-response handling also passed in both engines.
- The real official feed imported 7,694 stops and 15,107 timetable patterns into a 108 MiB snapshot, including inside the final Linux image with a 384 MiB importer limit.
- The read-only, non-root app returned eight real route alternatives under its 512 MiB limit; measured container usage after that request was approximately 316 MiB. Your 1 GiB shared droplet still needs enough free memory alongside its existing apps; these are container limits, not a guarantee that all services fit together.
- The current ITS feed returned real vehicles for line 825 in a targeted check; missing vehicles are shown honestly rather than simulated.

Phone hardware/background behavior and a deployment on your actual droplet have not been tested.

## Sources verified during implementation (2026-10-07/08)

- [SMTR schedules publication](https://transportes.prefeitura.rio/subsidio/) and [current GTFS item](https://www.arcgis.com/home/item.html?id=b577e4c4c0924888823b630bbdb2c6fd): https://dados.mobilidade.rio/gtfs/schedule
- [Current consolidated ITS API documentation](https://www.arcgis.com/home/item.html?id=bc16ed45dda5434999ed3e4e9dbee56f): https://its.mobilidade.rio/v1/geolocalizacao/veiculos and https://its.mobilidade.rio/docs
- [Municipal integrations/Jaé](https://transportes.prefeitura.rio/integracoes/)
- [GTFS specification](https://gtfs.org/documentation/schedule/reference/)
- [Geolocation specification](https://w3c.github.io/geolocation/), [WebKit iOS notifications](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Photon search-as-you-type documentation](https://github.com/komoot/photon), [Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md)
- [Nominatim use policy](https://operations.osmfoundation.org/policies/nominatim/), [OSM tile use policy](https://operations.osmfoundation.org/policies/tiles/)

Live-bus alternatives share a 20-second provider snapshot **per public line**, then apply the selected GTFS variant/direction. The response/UI distinguishes the entire line fleet from vehicles confirmed for the boarding direction. Missing directions are inferred only from an unambiguous exact GTFS shape; unresolved entries are counted separately and never presented as confirmed boarding options. Positions older than 180 seconds remain excluded, including when reading a cached snapshot. Different directions/variants legitimately have different eligible counts; each route card shows its headsign.

`npm run test:browser` also checks scheduled-time payloads, mobile drag/collapse, shared line snapshots, all-line colors, direction filtering, and a bus → BRT → metro boarding flow. Set `BROWSER=webkit` for Safari’s engine; `BROWSER=all node scripts/browser-transit.mjs` checks the new transit UI in both Chromium and WebKit. `MetroAndVehiclesTests` covers station graph integrity, mixed routing, Sunday/holiday hours, internal-transfer fares and provider-cache scope. The browser requests the complete line snapshot once; matching vehicles are derived from that same response for every alternative. The per-line snapshot rolls over fresh reports instead of replacing the fleet with each partial minute batch. The optional `routeId`/`direction` API filters remain available.
