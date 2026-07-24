import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

// Read once at module load (not per-request) — the page is static and small; re-reading it on
// every request would be pure overhead. Read from `dist/dashboard/` (copied there by this
// package's own build script), not `src/`, so this works identically in the monorepo and once
// installed from npm.
const dashboardHtml = readFileSync(join(__dirname, "..", "dashboard", "index.html"), "utf-8");

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/dashboard",
    { schema: { hide: true } },
    async (_req, reply) => reply.type("text/html").send(dashboardHtml),
  );
}
