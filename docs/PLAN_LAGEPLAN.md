# Plan: Lageplan (2D-Gartenlayout) und Sync pro Eintrag

Stand: 2026-11-24. Erstes größeres Feature aus `docs/ROADMAP.md` („2D-Gartenlayout
wie in Open Garden Planner, ohne 3D“).

## Ziel

Eine neue Seite **„Grundstück“**, auf der das Grundstück maßstabsgetreu in der
Draufsicht geplant wird:

- Hintergrundbild importieren (Screenshot aus Google Maps, Katasterplan oder
  eine Mischung), kalibrieren (Linie auf den Maßstabsbalken ziehen und „5 m“
  eingeben), verschieben und drehen.
- Elemente aus einer Bibliothek setzen: Gebäude, Gehölze, Beete, Bodenflächen,
  Linien (Zaun, Hecke, Weg) und Objekte.
- Jedes Element hat Attribute (Status, Höhe, Nutzung …). Gehölze lassen sich mit
  Ernte und Pflege verknüpfen.
- Schattenwurf zu frei wählbarem Datum und Uhrzeit.

Rahmen:

- **Ein Lageplan** pro Installation.
- **Bearbeiten am Desktop, am Handy nur Anschauen** (Verschieben, Zoomen,
  Element antippen).
- Nur 2D. Höhenunterschiede im Gelände sind vorgesehen, kommen aber später
  (siehe unten).
- Nutzung im Haushalt: **eine Person pflegt die Daten, die anderen schauen
  nach.** Gleichzeitiges Bearbeiten ist die Ausnahme.

## Leitlinie: erweiterbare Datenmodelle

Es werden noch Ideen dazukommen. Darum gilt für alle neuen Daten:

1. **Flache Sammlungen mit IDs.** Jedes Element ist ein eigener Eintrag in einer
   Sammlung (`siteElements`) und steckt nicht verschachtelt in einem
   Plan-Objekt. Das passt zum Sync pro Eintrag, und neue Sammlungen kommen ohne
   Umbau dazu.
2. **Neue Felder sind optional.** Fehlt ein Feld, gilt ein Standardwert aus der
   Typ-Definition. Alte Einträge bleiben gültig, ohne dass eine Migration nötig
   ist.
3. **Unbekannte Felder bleiben erhalten.** Sync, Backend, Export und Import
   speichern Einträge unverändert durch und filtern nichts weg. Ein älterer
   Client oder ein älteres Backup löscht dadurch keine Felder, die eine neuere
   Version angelegt hat.
4. **Element-Typen als Registry.** Jeder Typ (Baum, Gebäude, Fläche …) ist an
   einer Stelle beschrieben: Standardwerte, Felder im Eigenschaften-Panel,
   Zeichnung, Schattenverhalten und Symbol. Ein neues Attribut bedeutet: Feld
   im Typ ergänzen und in der Registry eintragen. Ein neuer Element-Typ
   bedeutet: einen Registry-Eintrag anlegen.
5. **`schemaVersion` pro Eintrag**, falls doch einmal eine echte Umstellung nötig
   wird. Dann wird der einzelne Eintrag beim Laden migriert, nicht der ganze
   Store.

## Teil 0: Sync pro Eintrag (vor dem Lageplan)

### Heute

`useBackendSync` schickt den gesamten Zustand als einen Snapshot (`POST /api/sync`)
und zieht nur einmal beim Verbinden. Bei Konflikten wird nach ID zusammengeführt,
und lokal gewinnt. Dadurch:

- wird bei jeder Änderung der ganze Zustand übertragen,
- sehen andere Geräte Änderungen erst nach einem Neuladen,
- können Löschungen zurückkommen und fremde Änderungen verloren gehen,
- erzeugen Beete Konflikte auf Gartenebene, weil sie im Garten verschachtelt
  sind,
- werden Bilder nicht übertragen.

### Neu

**Backend (SQLite):**

```sql
CREATE TABLE records (
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT NOT NULL,        -- JSON, unverändert gespeichert
  version    INTEGER NOT NULL,     -- fortlaufende Server-Revision
  updated_at TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,  -- Grabstein, damit Löschungen ankommen
  PRIMARY KEY (collection, id)
);
CREATE TABLE blobs (id TEXT PRIMARY KEY, mime TEXT, data BLOB, created_at TEXT);
```

- `GET  /api/changes?since=<rev>`: alle Einträge mit `version > rev` plus die
  aktuelle Revision.
- `POST /api/changes`: geänderte und gelöschte Einträge. Der Server vergibt neue
  Versionen.
- `PUT/GET /api/blobs/:id`: Bilder (Hintergrund, später Journal-Fotos).
- Die alten Endpunkte `/api/sync` bleiben für die Übergangszeit und für die
  einmalige Übernahme vorhandener Snapshots in `records`.

**Client:**

- Der Store bleibt, wie er ist, und die Slices werden nicht umgebaut. Der Sync
  merkt sich pro Sammlung einen Hash je Eintrag vom letzten Abgleich. Bei
  Änderungen ermittelt er, was neu, geändert oder gelöscht ist, und schickt
  nur das.
- Gezogen wird beim Start, wenn das Fenster wieder in den Vordergrund kommt, und
  alle ~30 s. Da eine Person pflegt und die anderen lesen, reicht Polling.
  Server-Sent Events sind nicht nötig.
- Konflikte werden pro Eintrag gelöst, und der zuletzt geschriebene gewinnt.
  Das reicht für diese Nutzung.
- Offline funktioniert alles weiter. Änderungen bleiben in der Warteschlange,
  bis das Backend erreichbar ist. Ohne Backend-URL läuft Polly rein lokal wie
  bisher.

**Offener Punkt:** Beete sind heute in `gardens[].beds` verschachtelt. Der Sync
behandelt einen Garten fürs Erste als einen Eintrag. Beete als eigene Sammlung
herauszulösen ist ein späterer, eigener Schritt.

## Teil 1: Lageplan

### Technik

- **Konva + react-konva** (MIT). react-konva 19.3 passt zu React 19.3. Die
  Bibliothek wird nur auf der lazy geladenen Route geladen.
- **Konva-Layer** (wenige, jeder ist ein eigenes Canvas):
  1. Hintergrund
  2. Inhalt
  3. Schatten
  4. Arbeitsebene (Auswahl, Werkzeuge, Maße)
- **Ebenen für Nutzer** sind Groups im Inhalts-Layer: Flächen, Gebäude, Beete,
  Gehölze, Linien, Objekte, Beschriftung. Jede Ebene ist ein- und ausblendbar und
  sperrbar.
- **Einheiten:** Alles wird in **Metern** gespeichert, in Plankoordinaten mit
  x nach rechts und y nach unten, wie im Bild und auf dem Bildschirm. Wo Norden
  liegt, steht einmal in `northDeg`; der Schattenwurf rechnet damit in
  Himmelsrichtungen um. (Geändert bei der Umsetzung von Phase 1: Eine gekippte
  y-Achse hätte Bilder und Beschriftungen auf den Kopf gestellt.)
- **Hintergrundbild:** liegt in IndexedDB und wird über den Blob-Endpunkt
  synchronisiert. Beim Import wird es auf höchstens ~4096 px verkleinert.

### Datenmodell (Entwurf)

```ts
/** Ein Eintrag; Einstellungen des Plans. */
interface SiteSettings {
  id: "site";
  northDeg: number;          // Winkel von Norden zu "oben" auf dem Plan; 0 = genordet
  background?: {
    imageRef: string;        // Blob-ID
    x: number; y: number;    // Lage der Bildmitte in m
    rotationDeg: number;
    metersPerPixel: number;  // aus der Kalibrierung
    opacity: number;
    locked: boolean;
  };
  layers?: Record<string, { visible: boolean; locked: boolean }>;
  schemaVersion: number;
}

type Shape =
  | { type: "polygon"; points: number[] }
  | { type: "rect"; cx: number; cy: number; w: number; h: number; rotationDeg: number }
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "polyline"; points: number[]; width: number };

/** Gemeinsame Felder aller Elemente. */
interface SiteElementBase {
  id: string;
  kind: string;              // Schlüssel in der Element-Registry
  shape: Shape;
  status?: "existing" | "planned" | "remove";   // Standard: existing
  plannedYear?: number;
  name?: string;
  notes?: string;
  heightM?: number;          // für den Schatten
  baseElevationM?: number;   // vorgesehen für Gelände, siehe unten
  z?: number;
  locked?: boolean;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

interface WoodyElement extends SiteElementBase {
  kind: "tree" | "shrub" | "hedge";
  plantId?: string;          // Katalog, später Permapeople
  speciesText?: string;      // freier Text, solange der Katalog fehlt
  variety?: string;
  usage?: ("harvest" | "ornamental" | "privacy" | "wildlife")[];
  plantedYear?: number;
  crownDiameterM?: number;   // aktuell; bestimmt den Kreis
  matureHeightM?: number;
  matureCrownDiameterM?: number;
}

interface BuildingElement extends SiteElementBase { kind: "building"; roof?: "flat" }
interface SurfaceElement extends SiteElementBase {
  kind: "surface";
  material: "paving" | "gravel" | "asphalt" | "concrete" | "lawn" | "decking" | "water" | "soil";
}
interface BedElement extends SiteElementBase {
  kind: "bed";
  bedRef?: { gardenId: string; bedId: string };
}
// line (Zaun, Mauer, Weg), object (Kompost, Regentonne, …) analog
```

Neue Sammlung `siteElements` und ein Eintrag `siteSettings`:

- in `PERSISTED_KEYS` eintragen
- im Sync, im Export und im Import aufnehmen
- Element-Registry unter `src/components/site/elementTypes.ts`

### Darstellung des Status

| Status | Darstellung |
|---|---|
| vorhanden | normal |
| geplant | gestrichelt, halbtransparent |
| zu entfernen | rot, durchgestrichen |

Eine Ansicht-Auswahl schaltet um zwischen „Ist-Zustand“ (vorhanden und zu
entfernen) und „Zielzustand“ (vorhanden und geplant).

### Verknüpfungen mit dem Rest der App

- **Ernte:** `HarvestEntry.bedId` wird optional, dazu kommt `siteElementId`.
  Gehölze mit der Nutzung `harvest` erscheinen in der Ernte-Erfassung. Statistik
  und Selbstversorgung müssen Einträge ohne Beet berücksichtigen.
- **Aufgaben:**
  - neuer Aufgabentyp `prune` (Schnitt)
  - Wiederholung zusätzlich `yearly`
  - `Task.siteElementId`
  - Pflegeplan je Gehölz, z. B. Winterschnitt im Februar und Sommerschnitt im
    Juli. Daraus entstehen Aufgaben.
- **Beete:** Ein `bed`-Element zeigt auf ein `Bed`. Die Größe kommt aus dem Beet
  (Zellen × `gridCellSizeCm`), Position und Drehung aus dem Lageplan. Ein Klick
  öffnet den Beetplaner.

### Schattenwurf

- Der Sonnenstand kommt aus SunCalc mit dem Standort aus den Einstellungen und
  wird über `northDeg` auf den Plan gedreht.
- Schattenlänge: `heightM / tan(Sonnenhöhe)`. Der Schatten ist der Grundriss,
  entgegen der Sonne verschoben, einschließlich der überstrichenen Fläche:
  - Grundriss
  - verschobener Grundriss
  - je Kante ein Parallelogramm
- **Darstellung:** Alle Schatten werden deckend auf den Schatten-Layer gezeichnet,
  und erst der Layer bekommt die Transparenz. Überlappungen werden dadurch nicht
  doppelt dunkel, und es ist keine Polygon-Bibliothek nötig.
- **Bedienung:** Datum- und Uhrzeit-Regler, Schnellwahl für 21.3., 21.6. und
  21.12. Optional der Zustand „in 10 Jahren“ mit Endhöhe und Endkrone.
- **Später:** eine Karte der Sonnenstunden pro Tag, abgeglichen mit dem
  Sonnenbedarf der Pflanzen (`full`/`partial`/`shade`).
- Die Schattenberechnung bekommt eigene Unit-Tests: Richtung, Länge, Sonne unter
  dem Horizont.

### Grafiken

- Es gibt keine freien, stilistisch passenden Draufsicht-Symbole. Die von Open
  Garden Planner stehen unter **GPL-3.0** und dienen nur als Stilvorlage.
- Gehölz- und Objektsymbole erzeugen wir per Skript im Repo (deterministisch).
- Flächen bekommen Canvas- oder SVG-Muster. Falls nötig, kommen CC0-Texturen von
  ambientCG dazu.

## Gelände und Höhenunterschiede (später, im Modell vorgesehen)

Ein Teil des Grundstücks liegt im Hang. Das Datenmodell bekommt schon jetzt
`baseElevationM` an jedem Element. Ausgebaut wird in Stufen:

1. **Höhenpunkte:** gemessene oder geschätzte Punkte mit Höhe (eigene Sammlung
   `terrainPoints`). Daraus entstehen ein Dreiecksnetz, Höhenlinien und eine
   farbige Höhendarstellung. `baseElevationM` eines Elements wird daraus
   abgeleitet.
2. **Hangneigung und Ausrichtung** je Fläche, berechnet aus dem Netz. Das ist
   nützlich für Beete: Ein Südhang bekommt mehr Sonne, Kaltluft sammelt sich in
   Senken.
3. **Schatten im Gelände:** Der Schatten wird mit der Höhe des Bodens verrechnet.
   Am Hang fallen Schatten bergab länger und bergauf kürzer aus.
4. **Import eines Geländemodells:** Mehrere Bundesländer stellen ein DGM1
   (1-m-Raster) als Open Data bereit. Das wäre eine Alternative zum Messen.
   Verfügbarkeit und Format für das Grundstück vorher prüfen.

Nicht geplant ist eine echte 3D-Ansicht.

## Phasen

| Phase | Inhalt |
|---|---|
| 0 | Sync pro Eintrag: `records`, `/api/changes`, Blob-Endpunkt, Übernahme alter Snapshots, Tests — **umgesetzt** (Branch `feat/record-sync`) |
| 1 | **umgesetzt** (#11) — Lageplan-Grundgerüst: Route `/site`, Sidebar „Grundstück“, Verschieben und Zoomen, Hintergrund importieren, kalibrieren, verschieben und drehen, Nordrichtung, Raster und Maßstab, Ebenen-Panel, Store/Export/Import |
| 2 | **umgesetzt** (#12; Unterarten Gewächshaus, Kompost, Mauer und Teich ergänzt) — Zeichnen und Attribute: Polygon, Rechteck, Kreis, Linie; Transformieren und Eckpunkte; Eigenschaften-Panel aus der Registry; Status-Ansichten; Fläche und Länge; Messwerkzeug; Rückgängig; Löschen mit Bestätigung; am Handy nur Ansicht |
| 3 | Bibliothek: Palette, generierte Symbole, Flächenmuster |
| 4 | Schatten: SunCalc, Schatten-Layer, Zeitregler |
| 5 | Verknüpfungen: Ernte für Gehölze, Schnitt-Aufgaben, Beete ↔ Beetplaner |
| später | Sonnenstunden-Karte, Gelände, PNG-Export und Druck, Journal-Fotos über den Blob-Endpunkt |

## Nebenbefund

Journal-Fotos stehen heute nicht im Backup (`lib/dataExport.ts`) und werden nicht
synchronisiert. Mit dem Blob-Endpunkt aus Phase 0 lässt sich das mitlösen.
