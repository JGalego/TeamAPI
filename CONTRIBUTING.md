# Contributing

Thanks for considering a contribution to TeamAPI.

## Development setup

```bash
git clone https://github.com/JGalego/TeamAPI.git
cd TeamAPI
pnpm install
pnpm build
```

Requires Node >=22 (see `.nvmrc`) and pnpm (see `packageManager` in `package.json`).

## Everyday commands

Run from the repo root; each fans out across all packages via [Turborepo](https://turborepo.com/):

| Command              | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `pnpm verify`        | Every check CI runs, in CI's order — the one to run before a PR |
| `pnpm build`         | Compile every package (`tsc -b`)                                |
| `pnpm test`          | Run every package's Vitest suite                                |
| `pnpm test:coverage` | The same suites, plus each package's coverage floor             |
| `pnpm lint`          | ESLint (type-aware) over every package's `src/`, warnings fail  |
| `pnpm typecheck`     | Type-check the shipped sources and the tests, without emitting  |
| `pnpm deadcode`      | Unreachable exports, unused and undeclared dependencies         |
| `pnpm format`        | Apply Prettier (`pnpm format:check` to check without writing)   |
| `pnpm docs:build`    | Render the documentation site from this repo's markdown         |

`pnpm install` also installs a pre-commit hook that runs formatting and lint over your staged files.
`git commit --no-verify` skips it.

See [docs/code-quality.md](docs/code-quality.md) for what each gate catches and why it is set the
way it is.

Try any change against the bundled sample org before opening a PR:

```bash
pnpm teamapi validate examples/acme-org
pnpm teamapi render examples/acme-org --scope topology
```

## Where things live

This is a pnpm/Turborepo monorepo:

- `packages/schema` — Zod schemas + types for the [extended Team API spec](docs/spec/teamapi-extended-v1.md).
- `packages/core` — `$ref` resolution, the org graph, cognitive-load scoring, DDD context mapping, diagram generation. The shared engine every other package builds on.
- `packages/cli` — the `teamapi` command (`validate`, `render`, `scaffold`, `generate`, `serve-api`, `serve-mcp`, `chat`).
- `packages/rest-api` — the read-only REST API (Fastify).
- `packages/mcp-server` — the MCP server exposing the org graph as tools for LLM assistants.
- `packages/chat` — the tool-use loop backing `teamapi chat`, over Anthropic or any OpenAI-compatible endpoint.
- `examples/acme-org` — the sample org every README example and most tests run against. If you add a feature, prefer demonstrating it here over inventing new fixtures.
- `examples/reelstream-org`, `examples/meridian-pay-org`, `examples/cartwell-org`, `examples/wavelength-org` — additional showcase orgs modeled after recognizable real-world team topologies (streaming, fintech, marketplace, and squad-based product orgs), for the README gallery and for exercising org-diff/multi-org scenarios. Not test fixtures — extend `acme-org` for those.
- `docs/spec/teamapi-extended-v1.md` — the human-readable spec; keep it in sync with `packages/schema/src/v1` when you change a field's shape or add a new one.
- `site/` — the landing page, hand-written HTML. `scripts/build-docs.mjs` renders everything else on the site from the markdown already in this repo (the README, `docs/`, each package's README), so documentation is edited where it lives and never has a second copy to keep in sync. `pnpm docs:build` produces the whole thing in `site-out/`; `.github/workflows/site.yml` publishes `latest` from `main` and one version per recent release tag.

## Making a change

1. Add tests alongside the code you change (`src/__tests__/`) — every package uses Vitest. Coverage
   is enforced per package, so removing tests without replacing them fails the build.
2. If you touch `packages/schema`, check whether `docs/spec/teamapi-extended-v1.md` needs a matching update.
3. If you touch a package's public API, check whether its `README.md` still accurately describes it.
4. Run `pnpm verify` before opening a PR — this is exactly what CI runs, in the same order.

### Stable findings and report contracts

Findings are an API, not formatted log lines. When adding or changing a check:

- Normalize it at the shared finding boundary and build its `id` from semantic identity, never mutable prose or
  severity.
- Do not reuse a `ruleId` for a different condition. A renamed or substantially redefined rule gets a new ID.
- Add a test proving that wording and severity changes leave the identity unchanged, plus a representative expected
  ID. See `packages/core/src/__tests__/normalized-findings.test.ts`.
- Treat additions to a versioned report as compatible and removals or meaning changes as a new format version. Update
  `packages/core/src/__tests__/compatibility-contract.test.ts` when a public contract changes.

The full guarantees for finding IDs, reports, CLI behavior and package APIs are in
[docs/compatibility.md](docs/compatibility.md).

### External integration tests

Provider clients must use the shared transport in `packages/core/src/integrations/http.ts` so timeout, retry and typed
error behavior stays consistent. Keep automated tests deterministic and credential-free: stub `fetch`, return the
smallest provider-shaped response and assert the outgoing URL, method and headers without snapshotting a token.

Cover the failure boundaries a provider can change underneath us:

- successful reads and documented write methods;
- authentication and other permanent 4xx responses without retry;
- bounded retry of 429, 5xx and network failures, including `Retry-After`;
- pagination across at least two pages and rejection of repeated cursors or links;
- malformed success payloads and provider-specific error envelopes.

Use `packages/core/src/__tests__/integration-http.test.ts` for transport behavior and
`packages/core/src/__tests__/http-clients.test.ts` for provider contracts. Live credentials never belong in the test
suite. Before changing a provider integration, use the read-only `teamapi doctor` command against a least-privilege
test account when one is available, then encode the observed shape in a fixture.

## Releasing

This repo uses [Changesets](https://github.com/changesets/changesets). If your change affects a published package's behavior (not just internal refactors, tests, or docs), add one:

```bash
pnpm changeset
```

Pick the affected package(s), a semver bump (patch/minor/major), and a one-line summary — this becomes the package's changelog entry. CI opens/updates a "Version Packages" PR from pending changesets; merging it publishes to npm.

## Reporting bugs / requesting features

Open a [GitHub issue](https://github.com/JGalego/TeamAPI/issues). For security issues, see [SECURITY.md](SECURITY.md) instead of filing a public issue.

Project decisions and maintenance expectations are documented in [GOVERNANCE.md](GOVERNANCE.md),
[ROADMAP.md](ROADMAP.md) and [SUPPORT.md](SUPPORT.md).
