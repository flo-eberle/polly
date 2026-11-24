# Contributing to Polly

Thank you for your interest in contributing to Polly! Polly is a fork of
[Gardener](https://github.com/mniedermaier/gardener); see the README for what differs.

## Getting Started

```bash
git clone https://github.com/flo-eberle/polly.git
cd polly
npm install
npm run dev
```

## Development

- `npm run dev` — Start dev server at localhost:5173
- `npm run test` — Run unit tests (Vitest)
- `npm run test:e2e` — Run E2E tests (Playwright)
- `npm run build` — TypeScript check + production build

## How to Contribute

1. Fork the repository (or, as a maintainer, branch off `main`)
2. Create a branch: `feat/…`, `fix/…`, `docs/…`, `chore/…`
3. Make your changes and add user-visible ones to `## [Unreleased]` in
   [CHANGELOG.md](CHANGELOG.md)
4. Ensure checks pass: `npm run lint && npm run test && npm run build`
   (and `npm test` in `backend/` when the backend changed)
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat(planner): …`, `fix: …`)
6. Push and open a pull request against `main`

`main` is protected: changes land only through pull requests with passing CI.
Write everything on GitHub (PRs, issues, commits) in English. Branching,
versioning and releases are described in [docs/RELEASING.md](docs/RELEASING.md);
an overview of the code is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Guidelines

- **Code style**: TypeScript, Tailwind CSS, named exports
- **State management**: Use `useStore(useShallow(...))` — never bare `useStore()`
- **i18n**: Add translations in all 4 languages (DE, EN, ES, FR)
- **Components**: Use existing UI primitives from `src/components/ui/`
- **Testing**: Add tests for new logic in `src/lib/`
- **Performance**: Use `React.memo()`, `useMemo()`, and `useShallow()` where appropriate

## Adding a New Plant

See [CLAUDE.md](CLAUDE.md#adding-a-new-plant) for the checklist.

## Adding a New Page

See [CLAUDE.md](CLAUDE.md#adding-a-new-page) for the checklist.

## Reporting Bugs

Use the [bug report template](https://github.com/flo-eberle/polly/issues/new?template=bug_report.yml).

## Feature Requests

Use the [feature request template](https://github.com/flo-eberle/polly/issues/new?template=feature_request.yml).

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.
