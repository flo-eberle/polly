# Changelog

All notable changes to Polly are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Polly uses
[Semantic Versioning](https://semver.org/) as described in
[docs/RELEASING.md](docs/RELEASING.md).

Every pull request adds its user-visible changes to **Unreleased**. A release
turns that section into a version heading.

## [Unreleased]

### Added
- Site plan page (Garden → Site): import a background image such as a map
  screenshot or cadastral plan, set its scale by tracing a known distance,
  move, rotate, fade and lock it, set the north direction, and toggle layers.
  Pan and zoom with mouse or pinch; phones show the plan read-only.
- The background image is stored per device in IndexedDB, uploaded to the
  backend for other devices, and included in the JSON backup.
- Drawing on the site plan: buildings, surfaces and beds as rectangles or
  polygons, trees and shrubs as circles, paths, hedges and fences as lines.
  Live size and area while drawing, a measuring tool, and a toolbar with undo
  and redo (Ctrl+Z, Ctrl+Shift+Z).
- Editing: select, move, resize and rotate rectangles, resize circles, drag
  corners of polygons and lines, add corners from edge midpoints, remove a
  corner with a double click, delete with confirmation. A selected element
  shows its area and perimeter or length; on phones tapping shows the same.
- The site plan can be started without a background image.
- Sub-kinds in the drawing toolbar: greenhouse and compost under buildings,
  wall under fences, each with its own look and default height; ponds as a
  kind of their own (polygon or circle).
- Properties panel for the selected element (desktop side bar): name,
  sub-kind, status (existing, planned with year, to be removed), height and
  notes for every element; species, variety, use, year planted, crown
  diameter and mature size for trees and shrubs; material for surfaces and
  paths, which also sets their colour; width for lines; depth for ponds.
  Typing into one field is a single undo step.
- Status on the plan: planned elements are faded and dashed, elements to be
  removed are red and crossed out. A view switch shows everything, today's
  state or the target state. Names appear on the plan (layer "Labels").
- On phones a tapped element shows its status, species, use and year planted.
- Shadows on the site plan: the sun button shows where every element with a
  height casts its shadow, for any date and time at the garden's location.
  Season shortcuts, a time slider over the daylight hours, playback of the
  whole day, and a "fully grown" option that uses mature heights and crowns.
  Tree shadows start at the crown and are tied to the tree by the trunk's
  shadow; fences and greenhouses shade lighter. Overlapping shadows keep one
  even shade.
  Shadows fall on ground-level elements (surfaces, beds) and stay under
  buildings and plants. The panel collapses to a single time row.

### Fixed
- After an update, new texts could show as raw keys until the next reload:
  translations are now requested per build, and reloaded when a new version
  of the app takes over.

## [0.1.0] - 2026-11-24

First Polly release. Polly is a hard fork of
[Gardener](https://github.com/mniedermaier/gardener); everything Gardener
offered up to its state of 2026-10-10 is included.

### Added
- Sync per record: the backend stores one row per record with a revision and
  tombstones (`/api/changes`), so devices exchange only what changed, pull
  changes from others every 30 s and on focus, and deletions reach every
  device. Fields the app does not know yet survive the round trip.
- After a server restart or a database restore, devices join afresh and push
  back what the server lost (sync epoch).
- Image storage in the backend (`/api/blobs/:id`) for the upcoming site plan.
- Release process: version script, changelog, container images on GHCR,
  GitHub releases (see `docs/RELEASING.md`).
- Documentation: roadmap, site plan plan, architecture overview, deployment
  and release guides.

### Changed
- Rebranded as Polly; internal identifiers keep the Gardener names so data,
  backups and upstream merges stay compatible.
- The backend imports an existing whole-state snapshot into records once on
  startup. The old `/api/sync` endpoint stays for one more release.
- nginx accepts request bodies up to 25 MB (was 1 MB).

[Unreleased]: https://github.com/flo-eberle/polly/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/flo-eberle/polly/releases/tag/v0.1.0
