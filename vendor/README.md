# Reviewed tooling dependencies

These private, project-owned variants retain the upstream implementations and licenses. They are not official releases of the original packages.

- `eslint-plugin-next`: upstream 16.3.6. Every rule/config remains; root-directory discovery imports the project adapter.
- `vite-plugin-dynamic-import`: upstream 1.6.0. Transform logic remains; file discovery imports the project adapter.
- `tooling-glob`: the small synchronous contract required by those two callers, backed by official `glob` 13.0.6. It supports only `sync`/`globSync`, `cwd` and `onlyDirectories`. Unsupported options/pattern forms and excessive inputs are rejected before the provider runs.

Each provider result is sorted lexicographically before deduplication, preserving the tested extension-collision precedence in generated imports. This is a bounded project contract, not a generic fast-glob API/order replacement. Separate dynamic patterns sharing a base may have different grouping order; callers here generate extension-brace patterns and are covered by ordinary collision tests.

The project `.npmrc` uses npm's standard `install-links=true` to materialize local distributions as ordinary packages. A clean `npm ci` must retain this setting; symlink dependencies would fail the existing audit manifest checks and would not survive runtime archiving. Upstream development dependencies are intentionally excluded from these distribution-only variants. Generated nested dependency folders are ignored.

Upstream names, versions, integrity and changed files are recorded in each `BECORE-PROVENANCE.json`. Updates require checking the upstream diff, rerunning the adapter and caller regressions, and auditing the resulting complete dependency graph. No audit exception is provided here. A clean package audit does not establish that separately bundled upstream code is free of vulnerabilities.
