# Team API toolchain image: the `teamapi` CLI, with `serve-api` as the default command.
#
# Two stages. The build stage needs the whole toolchain (TypeScript, turbo, the test deps pnpm
# installs alongside them); the runtime stage needs `node` and the compiled `dist/` trees. Keeping
# them apart is what makes the published image a fraction of the build tree rather than all of it.
#
#   docker build -t teamapi .
#   docker run --rm -p 3000:3000 -v "$PWD/examples/acme-org:/data:ro" teamapi
#
# The image bundles no org documents. They are mounted at /data, because they are the caller's
# source of truth and baking them in would make every org need its own image.

# --- build -------------------------------------------------------------------------------------

FROM node:22-alpine AS build

# The CLI's `postbuild` runs `npm link` unless CI is set, which would write into a global prefix
# that the runtime stage never copies — wasted work at best, a permissions failure at worst.
ENV CI=true

WORKDIR /app
RUN corepack enable

# Manifests first, sources second: dependency installation is the slow layer and it only has to
# re-run when a manifest or the lockfile actually changes, not on every source edit.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schema/package.json packages/schema/
COPY packages/core/package.json packages/core/
COPY packages/rest-api/package.json packages/rest-api/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/chat/package.json packages/chat/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Drop the build-only dependencies now that dist/ exists. `--ignore-scripts` because every
# lifecycle script in this repository is a developer convenience (git hooks, `npm link`) that has
# no meaning inside an image, and re-running them here would only re-do work the build already did.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# --- runtime -----------------------------------------------------------------------------------

FROM node:22-alpine AS runtime

ENV NODE_ENV=production

# Documents are mounted here. Created up front and owned by `node` so a read-write mount (which
# `serve-api --watch` and the PR write path both want) works without the container running as root.
RUN mkdir -p /data && chown node:node /data

WORKDIR /app
COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 3000
VOLUME ["/data"]

# `/health` is deliberately the one route that never requires a token, so this check keeps working
# when the server is started with `--token`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["node", "/app/packages/cli/dist/main.js"]

# 0.0.0.0 because a container that only listens on loopback is unreachable from the host. That
# combination is refused unless a token is set or --allow-anonymous is passed, which is the point:
# publishing this port without either would serve the whole org chart to the network.
CMD ["serve-api", "/data", "--host", "0.0.0.0", "--port", "3000"]
