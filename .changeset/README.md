# Changesets

This directory tracks pending version bumps for the next release. When you make a
change that should ship as a new version of one or more `@jgalego/teamapi*` packages, run:

```bash
pnpm changeset
```

and follow the prompts (which packages changed, patch/minor/major, a one-line
summary for the changelog). Commit the generated `.changeset/*.md` file alongside
your change.

On merge to `main`, CI opens or updates a "Version Packages" PR that applies every
pending changeset — bumping versions, updating each package's `CHANGELOG.md`, and
rewriting internal `workspace:*` dependency ranges. Merging that PR triggers the
actual `npm publish`.

See [changesets/changesets](https://github.com/changesets/changesets) for the full
docs.
