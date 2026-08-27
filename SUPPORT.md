# Support

## Project status

TeamAPI is actively developed and pre-1.0. It is suitable for evaluation and version-pinned adoption, but minor
releases may include announced breaking changes. See the [compatibility policy](docs/compatibility.md) before depending
on a public API or machine-readable format.

| Version                  | Status                                                       |
| ------------------------ | ------------------------------------------------------------ |
| Latest npm release       | Supported with compatible fixes and documentation updates    |
| `main`                   | Development branch; may change before release                |
| Earlier pre-1.0 releases | Best-effort guidance; fixes normally target the next release |

The supported Node.js versions are declared in each published package's `engines` field. Provider integrations also
depend on external APIs that can change independently; pin TeamAPI in automation and run `teamapi doctor` when a live
integration stops behaving as expected.

## Getting help

Before opening an issue:

1. Reproduce the problem on the latest release when practical.
2. Run the smallest relevant command with a minimal, redacted `teamapi.yml`.
3. For provider failures, include the provider, operation, HTTP status and `teamapi doctor` result, but never a token.
4. Include the TeamAPI package version, Node.js version and operating system.

Use [GitHub issues](https://github.com/JGalego/TeamAPI/issues) for reproducible bugs and feature requests. Support is
provided on a best-effort basis; there is no guaranteed response time or private support channel.

Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not through a public support issue.
Questions about contributing and releases belong in [CONTRIBUTING.md](CONTRIBUTING.md).
