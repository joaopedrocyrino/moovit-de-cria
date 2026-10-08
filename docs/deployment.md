# First deployment: moovit.joaocyrino.com

One React/.NET image runs behind the droplet's existing `csl-caddy-1` and external Docker network `proxy`. GTFS lives in a persistent Docker volume. Only pushes to **main** run Actions, including a merge into main. Staging and pull requests do not trigger the workflow.

## 1. DNS and shared proxy

Add an `A` record for `moovit.joaocyrino.com` pointing to your shared droplet. Remove an unrelated `AAAA` record unless IPv6 reaches this same droplet. Ports 80 and 443 must reach the existing Caddy, which handles the certificate automatically through Docker labels.

Check that the shared services exist:

```bash
docker inspect --format '{{.Name}}' csl-caddy-1
docker network inspect proxy --format '{{.Name}}'
```

This project does not start another proxy or publish a production host port.

## 2. Create the server configuration

Over your existing trusted SSH connection, create `/opt/moovit-de-cria` owned by the **actual account used by DEPLOY_USER**. If you continue deploying as root:

```bash
mkdir -p /opt/moovit-de-cria
chmod 700 /opt/moovit-de-cria
```

For a different deploy account, set the directory owner to that existing account. It needs Docker access and Python 3, `flock`, `curl`, and Docker Compose v2 installed on the server.

Create `/opt/moovit-de-cria/.env` directly on the droplet, using [.env.production.example](../.env.production.example) as the template. Set:

```dotenv
APP_HOSTNAME=moovit.joaocyrino.com
GTFS_URL=https://dados.mobilidade.rio/gtfs/schedule
VEHICLES_URL=https://its.mobilidade.rio/v1/geolocalizacao/veiculos
AUTOCOMPLETE_URL=https://photon.komoot.io
GEOCODING_URL=https://nominatim.openstreetmap.org
GEOCODING_USER_AGENT=MoovitDeCria/1.0 (+https://moovit.joaocyrino.com)
APP_MEMORY_LIMIT=512m
IMPORT_MEMORY_LIMIT=384m
```

```bash
chmod 600 /opt/moovit-de-cria/.env
```

The file must belong to DEPLOY_USER. It remains on the server; it is not an Actions secret or deployment upload. Retaining unrestricted SSH/Docker access means this account can technically read it; no restricted SSH command account is introduced here.

GitHub Actions downloads and compiles the public GTFS while building the release image. Deployment copies and validates that prepared snapshot with a 64 MiB installer limit, then the installer exits. The application still needs memory for the real timetable: measured app usage after a real route request was approximately 316 MiB, so container limits alone do not make it fit on a busy 1 GiB host.

For a small shared host, check `free -h`, `swapon --show` and `df -h /` before the first deployment. If there is no swap and several GiB of disk space are available, these root commands create 3 GiB of swap without restarting apps. They refuse to overwrite an existing `/swapfile-extra`:

```bash
(
  set -e
  umask 077
  dd if=/dev/zero of=/swapfile-extra bs=1M count=3072 conv=excl status=progress
  mkswap /swapfile-extra
  swapon /swapfile-extra
  printf '/swapfile-extra none swap defaults,nofail 0 0\n' >> /etc/fstab
)
free -h
swapon --show
```

Swap uses disk for less-active memory and can reduce memory-exhaustion failures, but it is slower than RAM. If the host remains slow under normal app traffic, reduce the running workload or increase physical RAM.

## 3. GitHub configuration

Create your repository, then create the GitHub environment **production**. Put these secrets there (repository secrets also work):

| Secret                   | Value                                                            |
| ------------------------ | ---------------------------------------------------------------- |
| `DEPLOY_HOST`            | Droplet IPv4 address or SSH hostname                             |
| `DEPLOY_USER`            | Existing deploy account, e.g. `root` if retaining current access |
| `DEPLOY_SSH_KEY`         | Full private key whose public key is authorized on the droplet   |
| `DEPLOY_SSH_KNOWN_HOSTS` | Verified SSH host-key line, described below                      |
| `GHCR_USERNAME`          | GitHub account with access to the image package                  |
| `GHCR_TOKEN`             | Token with `read:packages` for pulling that package              |

The image build publishes with Actions' own `GITHUB_TOKEN`; GHCR_TOKEN is for the droplet pull only. Ensure the newly created package grants the chosen account read access. A private repository may require appropriate repository access too.

Set these environment/repository **variables**:

| Variable          | Value                                      |
| ----------------- | ------------------------------------------ |
| `APP_HOSTNAME`    | `moovit.joaocyrino.com` — required         |
| `DEPLOY_PATH`     | `/opt/moovit-de-cria` (default if omitted) |
| `DEPLOY_PORT`     | `22` (default if omitted)                  |
| `CADDY_CONTAINER` | `csl-caddy-1` (default if omitted)         |

For a different **public** GTFS feed, also set the **repository** variable `GTFS_URL` to exactly match the droplet's `GTFS_URL`. The default official Rio feed requires no new variable. The build never reads or uploads the server `.env`; do not put private feed credentials in a build argument or repository variable.

Obtain the host public key over a trusted connection or the DigitalOcean console:

```bash
cat /etc/ssh/ssh_host_ed25519_key.pub
```

If that prints `ssh-ed25519 AAAA... root@server`, the secret should be:

```text
YOUR_ACTUAL_DROPLET_IP ssh-ed25519 AAAA...actual-public-key...
```

Use the exact DEPLOY_HOST at the start, omit the trailing comment, and use `[HOST]:PORT` for a nonstandard port. Do not paste the private server host key.

## 4. First push

The delivered project already has a local main branch. After configuring GitHub and the droplet:

```bash
cd ~/code/moovit-de-cria
git add .
git commit -m "Create Rio transit web app"
git remote add origin git@github.com:YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

No `.env`, downloaded feed, SQLite database, node_modules or build artifacts are committed. The workflow tests the backend/importer/GPS logic, prepares the real public timetable inside the image build, browser-tests the monolith with a separate disposable fixture, publishes its digest, then deploys that exact image. Production installs the prepared real feed; synthetic browser-test data is never bundled as production data.

The remote deployment locks concurrent jobs, validates the existing server `.env`, installs the prepared timetable atomically, starts the app and checks HTTPS readiness through shared Caddy. Corrupt, expired and mismatched-source snapshots are rejected before replacing the existing file. A failed rollout restores the previous image when there is a previous successful release. A lost SSH connection requires checking the server because completion is then unknown.

## 5. Refresh official schedules

On the small shared droplet, refresh the feed in GitHub Actions: open the latest main workflow and select **Re-run all jobs**. This rebuilds the image with current public timetables and deploys the new digest. **Re-run failed jobs** alone reuses an already successful image build, so it does not refresh its bundled timetable.

For a server with sufficient resources, the existing manual server-side refresh remains available without building a new image:

```bash
bash /opt/moovit-de-cria/current/refresh-data.sh
```

For a custom path/Caddy name, pass both as arguments. The helper reuses the deployment lock and already installed image. Failed imports preserve the prior snapshot; successful replacement is picked up by the app without restarting.

Only on a server with enough import headroom, you can schedule that server-side refresh in the **deploy account's** crontab:

```cron
15 4 * * * /bin/bash /opt/moovit-de-cria/current/refresh-data.sh >> /opt/moovit-de-cria/data-refresh.log 2>&1
```

Rotate that log using your server's normal log policy. Inspect it if a provider stops responding. The database contains public transit schedules, not personal trip history.

## Targeted diagnostics

```bash
docker logs --tail 80 moovit-de-cria-app-1
docker logs --tail 80 csl-caddy-1
curl --fail https://moovit.joaocyrino.com/api/health/ready
```

Only the main workflow deploys here. No second staging installation or duplicate database is created.

## Address and business-name autocomplete

`AUTOCOMPLETE_URL` defaults to Photon and needs no API key. Set it in the droplet-owned `.env` only if changing providers. Search-as-you-type never calls public Nominatim. Public Photon has no availability guarantee and can throttle extensive usage; use your own compatible service before scaling. Results depend on OpenStreetMap coverage, so businesses missing there will not appear automatically.
