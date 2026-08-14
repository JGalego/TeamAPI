# @jgalego/teamapi-backstage

## 0.2.0

### Minor Changes

- 8abf5c8: `GET /backstage/catalog` serves the org as Backstage entities — the same generator `teamapi generate backstage` writes, served rather than written. The new `@jgalego/teamapi-backstage` package is a catalog entity provider that polls it, with no `@backstage/*` dependency.
