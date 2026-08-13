import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import type { OrgGraphStore } from "@jgalego/teamapi-core";
import { registerOrgGraphStore } from "./plugins/org-graph";
import { registerAuth } from "./plugins/auth";
import { teamsRoutes } from "./routes/teams";
import { servicesRoutes } from "./routes/services";
import { searchRoutes } from "./routes/search";
import { graphRoutes } from "./routes/graph";
import { diagramsRoutes } from "./routes/diagrams";
import { contextMapRoutes } from "./routes/context-map";
import { cognitiveLoadRoutes } from "./routes/cognitive-load";
import { gapsRoutes } from "./routes/gaps";
import { healthRoutes } from "./routes/health";
import { dashboardRoutes } from "./routes/dashboard";
import { knowledgeRoutes } from "./routes/knowledge";
import { contextRoutes } from "./routes/context";
import { knowledgeGraphRoutes } from "./routes/knowledge-graph";
import { slackRoutes } from "./routes/slack";
import { reloadRoutes } from "./routes/reload";
import { mcpRoutes, type McpRequestHandler } from "./routes/mcp";

export interface BuildServerOptions {
  logger?: boolean;
  /** Slack app signing secret. The `/slack/whoowns` route exists only when this is set, so an
   * unauthenticated command endpoint can never be mounted by accident. */
  slackSigningSecret?: string;
  /** When set, every route except `/health` and `/slack/*` requires `Authorization: Bearer`. */
  apiToken?: string;
  /** Origins allowed to make cross-origin browser requests. Omitted (or empty) sends no CORS
   * headers at all, which is the safe default: a read-only API is still an information
   * disclosure, and `*` would let any page a viewer visits read the whole org chart. */
  corsOrigins?: string[];
  /** Requests allowed per minute, per client IP. Omitted means no limit. */
  rateLimitPerMinute?: number;
  /** When supplied, mounts `POST /reload` and calls this to re-resolve the graph. */
  reload?: () => Promise<void>;
  /** When supplied, mounts `POST /mcp` and routes it to this handler. Injected so this package
   * stays free of an MCP dependency; the CLI, which depends on both, supplies it. */
  mcpHandler?: McpRequestHandler;
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

  if (options.corsOrigins && options.corsOrigins.length > 0) {
    await app.register(fastifyCors, { origin: options.corsOrigins, methods: ["GET", "POST"] });
  }

  if (options.rateLimitPerMinute !== undefined) {
    await app.register(fastifyRateLimit, { max: options.rateLimitPerMinute, timeWindow: "1 minute" });
  }

  // Registered before the routes so the auth hook is in place for every one of them. Its ordering
  // relative to the rate limiter is handled by the lifecycle stage it hooks — see `registerAuth`.
  registerAuth(app, { token: options.apiToken });

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Team API",
        description:
          "Read-only API over a resolved Team API as Code org graph: teams, people, AI agents, services, " +
          "specifications, steering documents, prompts, playbooks, policies, knowledge base, workflows, sessions, " +
          "interactions, dependencies, cognitive load, cross-team gaps, DDD context mapping, context bundles, and a " +
          "cross-resource " +
          "knowledge graph.",
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
        { name: "Gaps", description: "Accountability holes between teams, computed from the resolved graph" },
        { name: "Agents", description: "AI agents declared as first-class team participants" },
        { name: "Memory", description: "Persistent organizational memory" },
        { name: "Specifications", description: "Specification-driven-development artifacts" },
        { name: "Steering", description: "Coding standards, conventions, and principles, with org->team inheritance" },
        { name: "Prompts", description: "Version-controlled, renderable prompt library" },
        { name: "Playbooks", description: "Structured operational procedures" },
        { name: "Policies", description: "Machine-readable governance for external automation to enforce" },
        { name: "Knowledge Base", description: "ADRs, FAQs, runbooks, design docs" },
        { name: "Workflows", description: "Process state machines, independent of any CI/CD system" },
        { name: "Sessions", description: "AI collaboration session history" },
        { name: "Context", description: "Context bundle assembly for AI assistants" },
        { name: "Knowledge Graph", description: "Cross-resource graph traversal and visualization" },
        { name: "MCP", description: "Model Context Protocol over Streamable HTTP" },
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
  if (options.reload) {
    await app.register(reloadRoutes, { reload: options.reload });
  }
  await app.register(teamsRoutes);
  await app.register(servicesRoutes);
  await app.register(searchRoutes);
  await app.register(graphRoutes);
  await app.register(diagramsRoutes);
  await app.register(contextMapRoutes);
  await app.register(cognitiveLoadRoutes);
  await app.register(gapsRoutes);
  await app.register(knowledgeRoutes);
  await app.register(contextRoutes);
  await app.register(knowledgeGraphRoutes);
  const slackSigningSecret = options.slackSigningSecret ?? process.env.SLACK_SIGNING_SECRET;
  if (slackSigningSecret) {
    await app.register(slackRoutes, { signingSecret: slackSigningSecret });
  }
  if (options.mcpHandler) {
    await app.register(mcpRoutes, { handler: options.mcpHandler });
  }
  await app.register(dashboardRoutes);

  return app;
}
