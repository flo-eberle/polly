# Changelog

All notable changes to Polly are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Polly uses
[Semantic Versioning](https://semver.org/) as described in
[docs/RELEASING.md](docs/RELEASING.md).

Every pull request adds its user-visible changes to **Unreleased**. A release
turns that section into a version heading.

## [Unreleased]

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
