# Architecture

An overview of how Polly is put together and how data flows. Conventions and
checklists for day-to-day changes are in [CLAUDE.md](../CLAUDE.md); the design
rules in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

## Big picture

```
┌──────────────────────── Browser / PWA / Capacitor app ────────────────────────┐
│                                                                               │
│  React pages (lazy routes, HashRouter)                                        │
│        │ useStore(useShallow(...))                                            │
│        ▼                                                                      │
│  Zustand store: one object, one slice per domain                              │
│        │ persist (version + migrate)                                          │
│        ├──► localStorage "gardener-storage"   (web, ~5 MB budget)             │
│        ├──► file mirror                       (native, lib/nativeStorage.ts)  │
│        │                                                                      │
│  IndexedDB "gardener-photos": journal photos (lib/photoStore.ts)              │
│                                                                               │
│  useBackendSync ──► lib/sync (only when a backend URL is set)                 │
└────────────────────────────────────┬──────────────────────────────────────────┘
                                     │ HTTPS, same origin in Docker
┌────────────────────────────────────▼──────────────────────────────────────────┐
│ Docker image                                                                  │
│   nginx: static frontend, /api → backend                                      │
│   Express 5 backend: /api/changes, /api/blobs, /api/health (+ legacy /sync)   │
│   SQLite /app/data/gardener.db: records, blobs (+ legacy tables)              │
└───────────────────────────────────────────────────────────────────────────────┘

External, called from the browser: Open-Meteo (weather, default) or
OpenWeatherMap (with own key); Open-Meteo geocoding for the place search.
```

Polly works completely without the backend (GitHub Pages, or the app on its
own). The backend only adds sync between devices.

## Frontend

| Area | Where | Notes |
|---|---|---|
| Pages | `src/components/<feature>/` | lazy-loaded routes in `src/App.tsx`, retry wrapper for stale PWA caches |
| Layout | `src/components/layout/` | sidebar (desktop), bottom nav and quick add (mobile), top bar with sync status |
| UI primitives | `src/components/ui/` | Button, Card, Modal (`<dialog>`), Input, Toast, plant icons |
| State | `src/store/` | one slice per domain, combined in `store/index.ts` |
| Logic | `src/lib/` | pure functions (sufficiency, succession, weather alerts, sync, export/import, …), unit-tested |
| Types | `src/types/` | data model per domain |
| Static data | `src/data/` | plant catalogue (`plants.json`), families, guilds |
| Translations | `public/locales/{de,en,es,fr}/` | loaded over HTTP by i18next; German is the default |

### Persistence

- The whole store is one JSON entry in localStorage, written through
  `safeLocalStorage` (a failed write shows a toast). Only keys listed in
  `PERSISTED_KEYS` are saved.
- Schema changes go through the `persist` migration (`version` in
  `store/index.ts`).
- Binary data never goes into the store: journal photos live in IndexedDB and
  the record keeps a `photo:` reference.
- On Android/iOS the store is mirrored to a file, because the OS may clear
  WebView storage; `main.tsx` waits for hydration before rendering.

### Backup

Settings → Data exports a JSON file with all collections (`lib/dataExport.ts`)
and imports it as overwrite or merge (`lib/dataImport.ts`). Journal photos are
not part of the backup yet.

## Sync

Optional, active when a backend URL is set in the settings. Code:
`src/lib/sync/records.ts` (pure logic), `src/lib/sync/client.ts` (one round),
`src/hooks/useBackendSync.ts` (scheduling), `backend/src/routes/changes.ts`.

- The client sees the store as a set of **records**: every item of a synced
  collection plus one record for the shared settings, keyed `collection/id`.
- For each record it remembers the hash of the version both sides last agreed
  on (the **base**, persisted as `syncBase`). Store vs. base gives the local
  changes; the slices do not track anything.
- **Push** sends upserts and deletions 2 s after a local change.
- **Pull** asks for everything with a revision above the last one seen, every
  30 s, when the window comes back into view and when the network returns.
- **Conflicts:** per record. An unpushed local edit is kept and wins on its
  next push; otherwise the server's version is taken.
- **First contact:** both sides are joined; on overlap the server wins.
- **Epoch:** the server gets a new epoch on every start. A device that sees a
  new epoch joins again from the full state including tombstones, and pushes
  back what a restored database lost.
- Unknown fields and collections pass through untouched, so older clients do
  not destroy data written by newer ones.
- Beds are still nested in gardens, so one garden with all its beds is one
  record.

Images (site plan background, later journal photos) go to `/api/blobs/:id`;
records only carry the id. Blobs are immutable.

## Backend

`backend/src/`:

| File | Purpose |
|---|---|
| `index.ts` | starts the server (port 3001) |
| `app.ts` | `createApp()`: CORS, rate limit (100/min/IP), optional token auth, routes |
| `db.ts` | SQLite connection, schema creation, one-time import of the old snapshot |
| `routes/changes.ts` | record sync |
| `routes/blobs.ts` | images |
| `routes/sync.ts`, `gardens.ts`, `tasks.ts` | legacy, kept for compatibility |
| `middleware/auth.ts` | `GARDENER_TOKEN` bearer auth; open when unset |

Tests: `backend/test/` with `node:test` (`npm test` in `backend/`), run in CI.

## Native apps

Capacitor wraps the same web build (`npm run build:native`). Native-only code
is limited to `lib/nativeStorage.ts` and `lib/native.ts`. Details in
[MOBILE.md](MOBILE.md).

## Build, test, release

| Step | Where |
|---|---|
| Lint, types, unit tests, E2E, build, Docker build | `.github/workflows/ci.yml` on every PR |
| Release image + GitHub release | `.github/workflows/release.yml` on tag `v*` |
| Android debug APK | `.github/workflows/android.yml` |
| GitHub Pages | `.github/workflows/deploy.yml`, manual only, currently unused |

Process: [RELEASING.md](RELEASING.md). Running it: [DEPLOYMENT.md](DEPLOYMENT.md).
