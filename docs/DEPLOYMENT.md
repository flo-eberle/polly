# Environments and deployment

## Environments

| Environment | Where | Runs | Purpose |
|---|---|---|---|
| Development | laptop | `npm run dev` (frontend), `npm run dev` in `backend/` | day-to-day work |
| Test | laptop | `docker compose up --build`, port 8090 via `docker-compose.override.yml` | manual test before a release, with a copy of production data |
| Production | homelab (Proxmox) | released image `ghcr.io/flo-eberle/polly:<version>` | household use |

`docker-compose.override.yml` is listed in `.git/info/exclude` and not part of
the repo.

Development on the laptop is enough. The test instance on the laptop covers the
manual checks; a second instance on the server is only worth it if the
household should try a version on their phones before it goes live.

## Production

Status: **not set up yet** (issue #18). The plan follows the other services in
the homelab (Docmost, Paperless): one LXC with Docker, data on the root disk,
backups on the external disk. Homelab-specific details (LXC id, IP, NPM entry)
are documented in the homelab repo; this page describes what Polly needs.

### Container

```yaml
# /opt/polly/docker-compose.yml
services:
  polly:
    image: ghcr.io/flo-eberle/polly:0.2.0   # always a fixed version, never :latest
    restart: unless-stopped
    ports:
      - "8090:80"
    volumes:
      - ./data:/app/data
    environment:
      - GARDENER_TOKEN=${GARDENER_TOKEN}     # from /opt/polly/.env, never committed
      - TRUST_PROXY=3                        # Cloudflare → NPM → container nginx, see below
```

```bash
# /opt/polly/.env — generated on the server, shown nowhere else
GARDENER_TOKEN=<openssl rand -hex 32>
```

The image serves frontend and backend from one origin (nginx proxies `/api` to
the backend), so the backend URL in the app is the site itself and CORS does not
come into play. The image is public on GHCR; pulling needs no login.

| Variable | Default | Meaning |
|---|---|---|
| `GARDENER_TOKEN` | unset (API open) | Shared access token. Mandatory as soon as the instance is reachable from the internet. |
| `TRUST_PROXY` | `1` | Number of reverse proxies in front of the backend, counting the container's own nginx. The backend takes the client address from `X-Forwarded-For` through that many hops; it is used for the rate limit (100 requests per minute and client). Too low: all devices share one limit. Too high: clients can fake their address. |

### Access: public behind the Nginx Proxy Manager

Decided on 2026-11-25: Polly is reachable on its own subdomain over HTTPS, like
Docmost. Only HTTPS gives the full PWA (install on the phone, offline mode).

1. **DNS:** a subdomain (the Cloudflare wildcard already covers it; proxied is fine).
2. **NPM proxy host:** the subdomain → `http://<LXC-IP>:8090`, Let's Encrypt
   certificate, *Force SSL*, *HTTP/2*. Websockets are not needed.
3. **Uploads:** background images go up to 20 MB. If an upload fails with
   413, add `client_max_body_size 25m;` under the proxy host's *Advanced*
   settings.
4. **`TRUST_PROXY`:** Cloudflare (proxied) → NPM → container nginx = `3`.
   Without Cloudflare's proxy (grey cloud) it is `2`.

**Each device**, once: Settings → Synchronisierung:

- *Backend-URL*: `https://<subdomain>`
- *Zugangs-Token*: the value of `GARDENER_TOKEN`

The token stays on the device (not synced, not in backups). A wrong or missing
token shows as "Zugang verweigert" in the top bar and under the token field.

Not chosen: the Headscale tailnet only (like the Kopfschmerz-Tagebuch). Plain
HTTP on a tailnet address is not a secure context, so no service worker: no
install, no offline mode; and Headscale issues no certificates.

### Backup

The database is a single SQLite file in WAL mode: `/app/data/gardener.db`.
Back it up with SQLite's online backup, not by copying the file while the
container runs:

```bash
docker exec polly node -e "
  require('/app/backend/node_modules/better-sqlite3')('/app/data/gardener.db')
    .backup('/app/data/backup-' + new Date().toISOString().slice(0,10) + '.db')
    .then(() => console.log('ok'))"
```

Planned: a daily cron job like Docmost's `backup.sh`, moving the file to the
external disk and keeping 14 days. Images are stored in the same database
(`blobs` table), so this one file is the complete server state. Each device
also keeps its own data and can export a JSON backup from the settings.

### Update

1. Read the changelog between the running and the new version (manual steps
   would mean a major version from 1.0 on).
2. Back up the database (see above).
3. Set the new version in `docker-compose.yml`.
4. `docker compose pull && docker compose up -d`
5. Check `docker compose logs` and open the app; Settings → About shows the
   version. Database migrations run automatically on start.
6. `docker image prune -a` to free the old image.

Phones pick up the new frontend on their next reload; until then they talk to
the new backend with the old frontend, which the API compatibility rule in
[RELEASING.md](RELEASING.md#compatibility-rules) allows for.

### Rollback

Migrations only go forward. To go back: stop the container, restore the backup
taken in step 2, set the previous version, start again.

Devices notice that the server restarted (its sync epoch changed) and join
afresh: records the restored database lacks are pushed back from the devices
that still have them, and edits a device had not pushed yet win. Only what was
changed on the server side after the backup and exists on no device any more is
lost.
