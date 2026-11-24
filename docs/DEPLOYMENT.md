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

Status: **not set up yet.** The plan follows the other services in the homelab
(Docmost, Paperless): one LXC with Docker, data on the root disk, backups on the
external disk.

### Container

```yaml
# /opt/polly/docker-compose.yml
services:
  polly:
    image: ghcr.io/flo-eberle/polly:0.1.0   # always a fixed version, never :latest
    restart: unless-stopped
    ports:
      - "8090:80"
    volumes:
      - ./data:/app/data
    environment:
      - GARDENER_TOKEN=${GARDENER_TOKEN}     # from /opt/polly/.env, never committed
```

The image serves frontend and backend from one origin (nginx proxies `/api` to
the backend), so the backend URL in the app is the site itself and CORS does not
come into play.

### Access: open decision

| Option | How | Consequence |
|---|---|---|
| **A: public, behind NPM** | subdomain with Let's Encrypt via the Nginx Proxy Manager on the Pi, like Docmost | Full PWA (install, offline). The API is reachable from the internet, so `GARDENER_TOKEN` is mandatory, and the app has to send it. **The app does not send a token yet.** |
| **B: Headscale tailnet only** | like the Kopfschmerz-Tagebuch | Not public. But plain HTTP on a tailnet IP is not a secure context: no service worker, so no install and no offline mode. Headscale does not issue certificates. |

Preferred: **A**, after the app can send the token (settings field, sent as
`Authorization: Bearer …` on every backend request).

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
