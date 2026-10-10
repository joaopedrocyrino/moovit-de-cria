# Usage analytics and privacy choices

The client sends first-party product events to the existing .NET API. There is no
paid analytics service or extra database server. Reports are private command-line
exports; the public API has no event-listing or reporting endpoint.

## Consent and identifiers

- The initial banner has equally accessible accept/reject buttons. Normal routing,
  GPS, accounts and local favorites work without analytics consent.
- Essential authentication/CSRF cookies remain separate. The versioned analytics
  choice is stored in `cria.analytics-consent.v1` in localStorage for 90 days.
- No usage events or analytics identifiers are created before acceptance. The API
  independently requires an encrypted consent/visitor cookie before accepting events.
- Production cookies are host-only, Secure, HttpOnly, Path=/, SameSite=Lax:
  `__Host-cria-usage-visitor` expires after 90 days; `__Host-cria-usage-session`
  expires after 30 minutes of inactivity. These cookies are on the API hostname.
  Stored visitor/session identifiers are SHA-256 hashes of random UUIDs.
- Open **Sobre o aplicativo → Privacidade e cookies** (also available in the expanded
  search footer) to change the choice. Rejection immediately stops the client queue,
  clears analytics cookies and deletes that browser's rows from the active store.
  A revocation tombstone prevents in-flight/replayed requests from restoring deleted
  rows. Reacceptance creates a fresh identifier. Offline changes stop collection
  immediately and retry the server update on reconnect/next load.
- Browser choices synchronize across tabs. Cookie/storage deletion, browser privacy
  restrictions and different devices affect identification. These are pseudonymous
  browser counts, not guaranteed distinct people.
- The collector stores no passwords, account names/emails/IDs, typed address/search
  content, aliases, precise GPS, travel endpoints, IP addresses, raw user agents,
  raw URLs/referrers or error stacks. Account deletion and analytics withdrawal are
  separate controls because analytics is not linked to account identity.
- Cloudflare, geocoding/map providers and operational infrastructure have their own
  request data/logging; this document describes this application's event collector.

The consent UI follows the design guidance in the
[ANPD cookie guide](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais).
This implementation does not replace a review of the actual site's privacy notice,
provider agreements and backup retention before launch.

## Event catalog (schema version 1)

| Events                                           | Useful fields / questions                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `app_open`                                       | Coarse browser/OS, viewport bucket, theme and release; who uses each version?                                  |
| `account_state`                                  | Signed-in/guest state transitions; no account identity                                                         |
| `map_action`, `panel_change`, `about_open`       | Zoom/location/vehicle controls, expanded panel and About discovery                                             |
| `engagement`, `connectivity`                     | Visible active duration in capped heartbeat increments, online/offline changes                                 |
| `place_search`, `place_selected`                 | Search length only; selection from search/saved/GPS, origin/destination field                                  |
| `route_search`, `route_result`, `route_selected` | Time/payment mode, result count, elapsed milliseconds, selected leg count; planning funnel                     |
| `journey_step`                                   | Explicit boarding, alighting/connection and returning to route results                                         |
| `saved_open`, `saved_change`                     | Tab, guest/account storage, address/line and add/edit/remove; shortcut adoption                                |
| `auth_result`                                    | Login/register/logout/password/delete outcome; no credentials or user identifier                               |
| `location_request`, `location_result`            | Success/denial/timeout/unavailable/insecure/unsupported; accuracy bucket only                                  |
| `api_result`                                     | Fixed endpoint category, status (0 for network failure), elapsed milliseconds; never request/response payloads |
| `performance`                                    | Navigation load, observed LCP candidates, layout shift samples and slow interaction durations, where supported |
| `ui_error`                                       | Error occurrence and release, without raw exception text                                                       |

`VITE_RELEASE` is a Git SHA (set by CI) or semantic version; native builds default
to `0.1.0`. Performance observations are raw diagnostic samples, not an official
aggregated Core Web Vitals score. Supported performance entries differ by browser.

Events are UUID-deduplicated, versioned, timestamped (occurrence and receipt), and
validated against event-specific property names plus bounded numeric/enumerated
values. Unknown/sensitive properties reject the entire batch before any insert.
The collector accepts at most 20 events per request, retains a bounded 100-event
memory queue, flushes every 30 seconds/on visibility changes and uses keepalive
when leaving. It never writes event queues to persistent browser storage. Delivery
is best effort; offline closure, ad blockers and network failures can lose events.
Collector failures never block a trip. The API also limits event batches to 20/minute
per client, inside the existing global request/body limits.

## Storage, retention and reports

PostgreSQL stores analytics in the application database (`app.usage_events` and `app.usage_revocations`).
Event properties use JSONB. Transactions and visitor advisory locks serialize revocation/collection across replicas.
The private reporting CLI uses a consistent read-only PostgreSQL transaction.
Back up with the PostgreSQL procedure in [accounts.md](accounts.md#backups-and-recovery).

```bash
npm run analytics:report -- --days 30 --output /private/path/usage.json
```

Node 22.18+ produces aggregate JSON: daily browser/session activity, event adoption,
release/browser/OS breakdowns, an ordered first-attempt planning/boarding funnel,
location/API failures, visible engagement, performance samples and local/account
favorite changes. The funnel uses the first observed stage in each session and may
undercount repeated attempts; use the underlying event timestamps for deeper reviews.
The export contains no visitor/session identifiers. Analyze with SQL, a notebook or
a future protected dashboard; add schemas/instrumentation deliberately for new features.
