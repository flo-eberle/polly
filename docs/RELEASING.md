# Workflow and releases

How changes get into Polly and how a release is cut. Deployment and updates of
a running instance are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Branches and pull requests

- `main` is always releasable. Nobody pushes to it directly; the `main` ruleset
  requires a pull request and these checks: Detect changes, Lint & Type Check,
  Unit Tests, E2E Tests, Build, Docker Image.
- Every change goes through a short-lived branch and a pull request:
  `feat/…`, `fix/…`, `docs/…`, `chore/…`, `ci/…`.
- There is no `develop` branch. Releases are tags on `main`.
- Commit messages and PR titles follow
  [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(sync): …`, `fix(planner): …`, `docs: …`.
- Everything on GitHub (PRs, issues, commits, new docs) is written in English.
- **Merge method:**
  - normal PRs: **squash** — one commit per PR, titled like the PR
  - upstream syncs from Gardener: **merge commit** — otherwise Git loses track
    of what was already merged and every later sync conflicts again
- Each PR adds its user-visible changes to the `Unreleased` section of
  [CHANGELOG.md](../CHANGELOG.md). Pure refactors, tests and CI changes need no
  entry.

## Versioning

Polly uses [Semantic Versioning](https://semver.org/). The version lives in
`package.json` and is shown in the app under Settings → About.

While Polly is on **0.x**:

| Bump | When |
|---|---|
| MINOR (0.**2**.0) | new features, and also incompatible changes |
| PATCH (0.1.**1**) | bug fixes only |

From **1.0.0** on (planned once Polly runs in production for the household):

| Bump | When |
|---|---|
| MAJOR | an update needs manual steps, or data, backups or the sync API are no longer compatible with the previous version |
| MINOR | new features; store and database migrations run automatically |
| PATCH | bug fixes only |

### Compatibility rules

- **Store data** (localStorage) is migrated by the Zustand `persist` migration;
  bump its `version` in `src/store/index.ts` when the shape changes.
- **Backups** of older versions must stay importable.
- **API:** phones keep a cached copy of the old frontend for a while after an
  update, so an endpoint the old frontend uses stays for at least one more
  minor release. Mark it as deprecated in the changelog and remove it under
  `Removed` later. Current case: `/api/sync` (replaced by `/api/changes` in 0.1.0, removal planned for 0.4.0).
- **Records** pass through sync, backend and backup untouched. New fields are
  optional with a default; see the data-model rules in
  [PLAN_LAGEPLAN.md](PLAN_LAGEPLAN.md#leitlinie-erweiterbare-datenmodelle).

## Releases

There is no fixed cycle. A release is cut when something is finished, for
example a phase of the site plan, or when a fix should reach production.

### Before a release: manual test

The automated tests cover logic and the main flows. Before each release also
test by hand on the laptop:

1. `docker compose up --build` (test instance, see DEPLOYMENT.md)
2. Restore a recent backup of the production data, once there is one
3. Click through what changed, on desktop and in the phone layout
4. If the sync or the backend changed: two browsers (or browser + phone) on
   the same backend, edit on one, check the other
5. If a migration changed: start the new version on a copy of the old data
   and check nothing is lost

### Cutting a release

```bash
git checkout main && git pull
git checkout -b release/v0.2.0
npm run version:set -- 0.2.0        # package.json, locks, Android, iOS
```

In `CHANGELOG.md`:

1. Rename `## [Unreleased]` content into a new `## [0.2.0] - YYYY-MM-DD`
   section and leave an empty `## [Unreleased]` above it.
2. Update the compare links at the bottom.

Then commit (`chore(release): v0.2.0`), open a PR, let CI pass and merge it.
After the merge, tag the merge commit on `main`:

```bash
git checkout main && git pull
git tag -a v0.2.0 -m "Polly 0.2.0"
git push origin v0.2.0
```

The tag starts `.github/workflows/release.yml`, which

1. checks that the tag matches `package.json` and that the changelog has a
   section for the version,
2. builds the container image and smoke-tests it,
3. pushes `ghcr.io/flo-eberle/polly:0.2.0`, `:0.2` and `:latest`,
4. creates the GitHub release with the changelog section as notes.

If the workflow fails before the push, fix the cause on `main`, delete the tag
(`git push origin :refs/tags/v0.2.0 && git tag -d v0.2.0`) and tag again. Never
move a tag whose image was already pushed; cut a patch release instead.

The image is built for `linux/amd64` only, which is what the Proxmox host runs.

### Hotfixes

Same flow with a patch version (`0.2.1`): fix branch → PR → release branch →
tag. With trunk-based development there is no separate hotfix branch.

## Upstream (Gardener)

Polly is a hard fork, but Gardener fixes are still welcome.

```bash
git fetch upstream
git log --oneline main..upstream/main      # anything new?
git checkout -b chore/upstream-sync
git merge upstream/main                    # resolve conflicts, run tests
```

Open a PR and merge it with a **merge commit**. The further Polly diverges, the
more it makes sense to cherry-pick single fixes (`git cherry-pick <sha>`) instead
of merging everything. Keep the internal names (`gardener-storage`,
`GardenerExport`, …) so merges stay manageable; see CLAUDE.md.
