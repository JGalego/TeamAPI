# Deployment

The toolchain ships as a single container image: the `teamapi` CLI with `serve-api` as the default
command. Org documents are never baked in — they are mounted, because they are your source of
truth and live in your git repository, not in someone else's image.

## Build

```bash
docker build -t teamapi .
```

The image is a two-stage build. The first stage installs the full workspace, runs `pnpm build`, and
then re-installs with `--prod` to drop the build-only dependencies; the second copies the result
onto a bare `node:22-alpine` and runs as the unprivileged `node` user.

## Run

```bash
docker run --rm -p 3000:3000 \
  -v "$PWD/examples/acme-org:/data:ro" \
  -e TEAMAPI_API_TOKEN=$(openssl rand -hex 32) \
  teamapi
```

Then `http://localhost:3000/docs` for the OpenAPI explorer and `http://localhost:3000/dashboard`
for the dashboard.

### Why the token is not optional

`serve-api` refuses to bind a non-loopback address without either `--token`/`TEAMAPI_API_TOKEN` or
an explicit `--allow-anonymous`. Inside a container every useful bind is non-loopback, so the
refusal fires on the first run rather than after the org chart has been on the network for a month.

If the port really is on a trusted network — a demo, an internal read-only mirror — say so:

```bash
docker run --rm -p 3000:3000 -v "$PWD/examples/acme-org:/data:ro" \
  teamapi serve-api /data --host 0.0.0.0 --allow-anonymous
```

### Other commands

The entrypoint is the CLI, so every subcommand is available:

```bash
docker run --rm -v "$PWD/examples/acme-org:/data:ro" teamapi validate /data
docker run --rm -v "$PWD/examples/acme-org:/data:ro" teamapi gaps /data --format json
docker run --rm -v "$PWD/examples/acme-org:/data:ro" \
  -v "$PWD/out:/out" teamapi generate backstage /data --out /out
```

## Compose

```bash
export TEAMAPI_API_TOKEN=$(openssl rand -hex 32)
export TEAMAPI_DOCS=./examples/acme-org
docker compose up api
```

The `api` service also mounts MCP over Streamable HTTP at `POST /mcp` and `POST /reload` for a
deploy hook to call. `POST /reload` rather than `--watch` on purpose: the documents are a read-only
bind mount, and inotify does not propagate across every bind-mount implementation, so a filesystem
watch is the one reload trigger that might quietly never fire.

The `mcp` service is a stdio subprocess, not a server, so it sits behind a profile and is meant to
be `run` rather than `up`:

```bash
docker compose run --rm -T mcp
```

`-T` is required. Without it Compose allocates a TTY, and the MCP protocol stream gets line-edited
into nonsense.

## Health

`/health` is the one route that never requires a token, so the same check works with and without
authentication. The image declares a `HEALTHCHECK` against it; orchestrators that ignore image
health can use it directly:

```yaml
livenessProbe:
  httpGet: { path: /health, port: 3000 }
```

## Published images

`.github/workflows/docker.yml` builds the image on every pull request and publishes it to
`ghcr.io/<owner>/teamapi` on pushes to `main` and on release tags. The build runs on every PR even
though the publish does not, so a Dockerfile that stopped building is caught by review rather than
by a release.
