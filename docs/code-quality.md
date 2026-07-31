# Code quality

Seven gates run on every pull request. Each one exists because it catches a class of problem the
others cannot see, and each one fails the build rather than printing a warning nobody reads.

Run them all locally with one command:

```bash
pnpm verify
```

That is exactly the CI sequence. The sections below explain what each gate is for, what it will and
will not catch, and how to work with it.

## The gates

| Gate       | Command              | Catches                                                 |
| ---------- | -------------------- | ------------------------------------------------------- |
| Formatting | `pnpm format:check`  | Style drift, diff noise                                 |
| Lint       | `pnpm lint`          | Dropped promises, unsafe `any`, bug-shaped idioms       |
| Types      | `pnpm typecheck`     | Type errors in shipped **and** test code                |
| Dead code  | `pnpm deadcode`      | Unreachable exports, unused and undeclared dependencies |
| Build      | `pnpm build`         | Broken project references, declaration emit failures    |
| Tests      | `pnpm test`          | Behavior regressions                                    |
| Coverage   | `pnpm test:coverage` | Tests deleted or code added without them                |

CI runs `test:coverage` rather than `test` — it executes the same suites and additionally enforces
the floors, so running both would just be the suite twice.

A pre-commit hook runs the first two over your staged files — the fast, file-scoped subset, around
five seconds for a typical change. The rest are repo-wide and stay in CI. To bypass the hook
deliberately: `git commit --no-verify`.

The hook installs itself: the root `prepare` script points `core.hooksPath` at `.githooks/`, so
`pnpm install` is all it takes. There is no hook manager dependency.

## Formatting

Prettier, `printWidth` 120, configured in `.prettierrc.json`. Run `pnpm format` to fix.

The width matches the style the codebase was already written in. Prettier's default of 80 would
have rewritten 8,945 lines on adoption instead of 863 — real changes drowning in reflow.

HTML is excluded (`.prettierignore`). The two hand-tuned pages carry inline `<script>` and
`<style>`, and reflowing them churns thousands of lines for no readability gain.

## Lint

ESLint with **type-aware** rules (`recommendedTypeChecked`), configured in `eslint.config.mjs`.
Warnings fail: every package runs `eslint src --max-warnings 0`.

Type-aware linting is the half of the ruleset that can see across a call. A promise dropped on the
floor and an `any` bleeding out of a cast are both invisible to syntax-only rules. The rules worth
knowing about:

- `no-floating-promises` / `no-misused-promises` — a swallowed rejection is a silent failure.
- `prefer-nullish-coalescing` — `||` treats `""` and `0` as absent, which is usually a bug and
  occasionally deliberate. When it is deliberate, write the empty-string case explicitly rather
  than reaching for a disable comment.
- `no-console`, outside `packages/cli` — the CLI is where user-facing output belongs. Elsewhere a
  stray log is debug residue, and for the MCP server speaking JSON-RPC over stdio it corrupts the
  transport.

Tests get `no-unsafe-*` relaxed. They reach into internals and build partial fixtures on purpose,
and holding them to the shipped-code bar makes fixtures unreadable without making them safer.

### Disable comments

A rule is disabled inline only with a comment saying why removing it would break something
concrete. There are two in the tree, both in `packages/mcp-server/src/tools/loose-register.ts`, and
both are worth reading before you add a third — they are the shape of a justified exception.

One is genuinely load-bearing. `no-unnecessary-type-assertion` autofixed away a double assertion
there and turned the build into `TS2589: Type instantiation is excessively deep`. The assertion is
what stops the generic instantiation; the linter cannot see that.

## Types

`tsc --noEmit` over two projects per package: `tsconfig.json` for the shipped sources, and
`tsconfig.test.json` for the tests.

The second one matters. Every package's `tsconfig.json` excludes tests so they stay out of the
published build — which for a long time meant 6,357 lines of test code, a little over 40% of the
repo, were never typechecked anywhere. Adding the test project surfaced nine real errors, all of
them assertions being checked against a weaker type than the code they exercise.

`tsconfig.base.json` is strict, including `noUncheckedIndexedAccess`. Indexing an array gives you
`T | undefined`; in a test that has already asserted the length, `arr[0]!` is fine.

## Dead code

Knip, configured in `knip.json`. Finds unreachable exports, unused dependencies, and dependencies
used but not declared.

That last category is the one worth having a tool for. It is invisible to everyone whose
`node_modules` already contains the package, and it fails only on a clean install — which is to say,
in CI, or on a new contributor's first day. Knip caught exactly that on its first run here.

The config is near-empty by design. The one setting that earns its place is
`ignoreExportsUsedInFile`: a `FooOptions` interface naming the parameter of the exported function
beside it is part of that function's signature, and callers get it structurally.

## Coverage

Vitest with the v8 provider. Floors are **per package**, declared in each `vitest.config.ts` and
shared through `vitest.shared.ts`.

| Package      | Statements | Branches | Functions | Lines |
| ------------ | ---------- | -------- | --------- | ----- |
| `schema`     | 99         | 98       | 100       | 99    |
| `rest-api`   | 98         | 86       | 100       | 98    |
| `mcp-server` | 94         | 80       | 100       | 94    |
| `core`       | 94         | 90       | 89        | 94    |
| `chat`       | 81         | 82       | 100       | 81    |
| `cli`        | 77         | 80       | 72        | 77    |

Per package rather than global, because the packages are not equally testable: `cli` is largely
process wiring, `schema` is pure data. One global number would be too loose for `schema` or
permanently red for `cli`.

Each floor sits at the measured value rounded down. That makes it a **ratchet**: a change that drops
coverage fails, and raising a floor is how a package records an improvement it earned. Lowering one
should carry a reason in the commit message.

Coverage measures shipped sources only — tests and barrel `index.ts` files are excluded from the
denominator. Counting files that execute by definition inflates the number and hides gaps in the
code being tested.

## What these gates do not check

Worth being explicit, so nobody reads a green build as more than it is:

- **Whether the tests are any good.** Coverage counts executed lines, not meaningful assertions. A
  test that calls a function and asserts nothing counts the same as one that pins its contract.
- **Whether the design is right.** No linter catches a badly-placed abstraction or a leaky module
  boundary. That is what review is for.
- **Whether the docs are true.** `docs/spec/teamapi-extended-v1.md` can drift from
  `packages/schema/src/v1` without anything going red. Keep them in sync by hand.
- **Runtime behavior against real vendors.** The integration clients are tested against fakes.
  `teamapi doctor` is the tool for checking a live integration.

## Adding a gate

Two things to establish before wiring one in:

1. **Measure the noise first.** A gate that lands with hundreds of findings gets bulk-suppressed and
   then ignored. Every gate here was probed against the codebase before adoption, and the ones that
   would have been noisy were tuned (Prettier's width) or scoped (`no-unsafe-*` off in tests) until
   the findings were all real.
2. **Prove it fails.** A gate nobody has seen fail is a gate nobody knows works. Each of these was
   verified by deliberately breaking it — an unreferenced file for knip, a raised floor for
   coverage, a floating promise for lint.
