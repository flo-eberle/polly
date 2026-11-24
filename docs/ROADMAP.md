# Polly – Ziele und Entscheidungen

Stand: 2026-11-19. Übernommen aus dem Projekt Hexenhaus (`~/Projects/hexenhaus`),
in dem die Tool-Auswahl stattfand.

## Ziel

Polly ist die Garten-Web-App für den eigenen Garten („Hexenhaus“). Sie wird von
mehreren Personen im Haushalt genutzt und soll zwei Dinge abdecken:

1. **Gartenlayout:** Beete, Wege, Bäume und Bauten auf dem Grundstück.
2. **Gemüse- und Obstplanung:** Aussaattermine, Mengen, Beetbelegung,
   Erntetermine und Erntemengen.

## Warum ein Fork von Gardener

Getestet und entschieden am 2026-11-19:

| Tool | Urteil |
|---|---|
| **Gardener** (mniedermaier/gardener, MIT) | Gut, aber es fehlen Funktionen. Riskant, weil das Projekt klein ist und nur einen Maintainer hat. → **Harter Fork als Polly** |
| **Open Garden Planner** | Sehr gut für Layout und Planung, aber eine Desktop-App, keine Web-App. Ausgeschlossen. Der Quellcode liegt als Referenz für das 2D-Layout in `~/Projects/hexenhaus/tools/open-garden-planner`. |
| **farmOS** | Viel zu groß und zu kompliziert. Ausgeschlossen. |

Diese Tools nicht erneut als Ersatz vorschlagen.

## Gewünschte Änderungen

- **2D-Gartenlayout** wie in Open Garden Planner (ohne 3D). Plan dazu, einschließlich
  des neuen Syncs pro Eintrag: `docs/PLAN_LAGEPLAN.md`.
- **Anbindung an eine externe Pflanzendatenbank** statt nur der statischen
  `src/data/plants.json` (siehe unten).
- **Menü, Journal und Gewichtung überarbeiten.**

Die Nutzer testen Polly zuerst gründlich und listen danach auf, was hinzukommen,
sich ändern oder wegfallen soll. Größere Umbauten erst nach dieser Liste beginnen.

## Pflanzendaten: Permapeople

Entscheidung vom 2026-11-19: **Permapeople** (permapeople.org) als Quelle.

- Lizenz **CC BY-SA 4.0**. Die Daten müssen attribuiert werden, und Abwandlungen
  der Daten stehen unter derselben Lizenz.
- API-Zugang mit Key-ID und Secret in `~/.config/permapeople-token`. Die Datei liegt
  außerhalb des Repos und darf nie committet werden.
- Cloudflare blockiert den Standard-User-Agent. Deshalb einen eigenen, generischen
  User-Agent setzen.
- Der Suchfilter `type` liefert nichts zurück. Er ist nicht nutzbar.

Plan:
1. Permapeople **lokal spiegeln**, damit die App nicht live von der API abhängt.
2. Darauf eine **deutsche Anbau-Schicht** legen: Aussaat- und Erntezeitpunkte,
   Pflanzabstände und schlechte Nachbarn. Als Startbestand dienen die 47 Pflanzen
   aus Gardener.

Verworfen: **Trefle**. Es liefert nur Daten auf Artebene und kaum Anbaudaten.

## Lokaler Betrieb

- Docker auf `127.0.0.1:8090` über `docker-compose.override.yml`. Die Datei steht
  in `.git/info/exclude` und ist deshalb nicht versioniert. Laut Kommentar in der
  Datei ist der eigene Port wegen PWA/Service Worker gewählt.
- Der Container (`polly-gardener-1`) hat keine Restart-Policy und startet nach
  einem Reboot nicht von selbst: `docker compose up -d`.
- Commits laufen mit der GitHub-noreply-Adresse (repo-lokale Git-Config).
- Remotes: `origin` = flo-eberle/polly (öffentlich), `upstream` = mniedermaier/gardener.
