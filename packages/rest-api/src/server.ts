import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { OrgGraphStore } from "@jgalego/teamapi-core";
import { registerOrgGraphStore } from "./plugins/org-graph";
import { teamsRoutes } from "./routes/teams";
import { servicesRoutes } from "./routes/services";
import { searchRoutes } from "./routes/search";
import { graphRoutes } from "./routes/graph";
import { diagramsRoutes } from "./routes/diagrams";
import { contextMapRoutes } from "./routes/context-map";
import { cognitiveLoadRoutes } from "./routes/cognitive-load";
import { healthRoutes } from "./routes/health";

export interface BuildServerOptions {
  logger?: boolean;
}

// Read at runtime (not imported as a TS module) so this keeps working both from `dist/` in the
// monorepo and once published, without fighting `rootDir`/project-reference boundaries.
const packageVersion = (JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { version: string })
  .version;

/**
 * Builds a Fastify app over an already-`load()`ed `OrgGraphStore`. Read-only: there is
 * intentionally no write path, since the Team API documents are the git-managed source of truth.
 *
 * Interactive docs (OpenAPI + Swagger UI "Try it out") are served at `/docs`. Routes declare
 * `summary`/`description`/`tags`/`querystring`/`params` schemas for documentation; response bodies
 * are deliberately left unschema'd so Fastify never silently strips fields that don't happen to
 * be enumerated in a hand-written response schema — "Try it out" always shows the real payload.
 */
export async function buildServer(store: OrgGraphStore, options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  registerOrgGraphStore(app, store);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Team API",
        description:
          "Read-only API over a resolved Team API as Code org graph: teams, services, roles, interactions, dependencies, cognitive load, DDD context mapping, and rendered organigrams.",
        version: packageVersion,
      },
      tags: [
        { name: "Teams", description: "Team lookup, roles, interactions, dependencies" },
        { name: "Services", description: "Service directory and ownership" },
        { name: "Search", description: "Unified org-wide search" },
        { name: "Graph", description: "The full resolved org graph as JSON" },
        { name: "Diagrams", description: "Rendered Mermaid/DOT organigrams" },
        { name: "Context Map", description: "DDD context mapping derived from interactions" },
        { name: "Cognitive Load", description: "Team Topologies cognitive load reports" },
        { name: "Health", description: "Liveness check" },
      ],
    },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true, tryItOutEnabled: true },
  });

  app.get("/", { schema: { hide: true } }, async (_req, reply) => reply.redirect("/docs"));

  await app.register(healthRoutes);
  await app.register(teamsRoutes);
  await app.register(servicesRoutes);
  await app.register(searchRoutes);
  await app.register(graphRoutes);
  await app.register(diagramsRoutes);
  await app.register(contextMapRoutes);
  await app.register(cognitiveLoadRoutes);

  return app;
}
