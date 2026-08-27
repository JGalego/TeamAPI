# Governance

TeamAPI uses a maintainer-led, contribution-driven model. The maintainers are responsible for the repository,
releases and project direction; contributors shape that direction through issues, discussions and pull requests.

## Decisions

Routine fixes and compatible features are decided in pull-request review. Changes to the document specification,
public package APIs, command behavior or machine-readable contracts should start with an issue when the design is not
obvious. The proposal should describe the user problem, compatibility impact, alternatives and migration path.

Maintainers seek evidence and rough consensus, but they make the final decision when tradeoffs remain. Decisions are
recorded in the issue or pull request rather than in a private channel. Security reports are the exception and follow
the private process in [SECURITY.md](SECURITY.md).

The [compatibility policy](docs/compatibility.md) governs contract changes. The [roadmap](ROADMAP.md) describes current
priorities, not a promise that every listed item will ship.

## Roles

- **Contributors** report problems, improve documentation, propose designs and submit changes.
- **Maintainers** review and merge changes, manage releases, moderate project spaces and protect compatibility and
  security expectations.

Maintainer access is granted by existing maintainers based on sustained, constructive contributions and demonstrated
judgment across code, documentation and review. It is not automatic after a fixed number of contributions. A
maintainer who expects to be unavailable for an extended period should say so publicly when practical and arrange a
handover for release or security responsibilities.

## Participation

All project spaces follow the [Code of Conduct](CODE_OF_CONDUCT.md). Technical disagreement is resolved on the merits
of the proposal; moderation and conduct decisions are handled by maintainers and may be appealed by opening a private
security advisory when a public issue would expose personal or sensitive information.
