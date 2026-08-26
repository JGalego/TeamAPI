import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import type { EmbeddingProvider, EvidenceLedger, OrgGraphStore, ReconciliationGatePolicy } from "@jgalego/teamapi-core";
import { registerEmbeddings, registerOrgGraphStore } from "./plugins/org-graph";
import { registerAuth } from "./plugins/auth";
import { registerEtag } from "./plugins/etag";
import { HttpMetrics, registerHttpMetrics } from "./plugins/http-metrics";
import { teamsRoutes } from "./routes/teams";
import { servicesRoutes } from "./routes/services";
import { searchRoutes } from "./routes/search";
import { graphRoutes } from "./routes/graph";
import { diagramsRoutes } from "./routes/diagrams";
import { contextMapRoutes } from "./routes/context-map";
import { cognitiveLoadRoutes } from "./routes/cognitive-load";
import { gapsRoutes } from "./routes/gaps";
import { checksRoutes } from "./routes/checks";
import { healthRoutes } from "./routes/health";
import { metricsRoutes } from "./routes/metrics";
import { proposalRoutes, type ProposalRouteOptions } from "./routes/proposals";
import { backstageRoutes } from "./routes/backstage";
import { dashboardRoutes } from "./routes/dashboard";
import { knowledgeRoutes } from "./routes/knowledge";
import { contextRoutes } from "./routes/context";
import { knowledgeGraphRoutes } from "./routes/knowledge-graph";
import { slackRoutes } from "./routes/slack";
import { reloadRoutes } from "./routes/reload";
import { mcpRoutes, type McpRequestHandler } from "./routes/mcp";
import { evidenceRoutes } from "./routes/evidence";
import { reconciliationRoutes } from "./routes/reconciliation";
import { agentControlPlaneRoutes } from "./routes/agent-control-plane";

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
  /** Enables `GET /search?mode=hybrid|semantic` and `POST /context {semantic:true}`. Omitted, both
   * answer 400 rather than quietly falling back to substring matching. */
  embeddings?: EmbeddingProvider;
  /** Mounts `POST /teams/:id/proposals`, which opens a pull request against the repository the
   * documents came from. Omitted, there is no write path at all. */
  proposals?: ProposalRouteOptions;
  /** Mounts `GET /metrics` in the Prometheus exposition format. Off by default: it is one more
   * surface, and a server nobody scrapes should not have one. */
  metrics?: boolean;
  /** When supplied, mounts `POST /reload` and calls this to re-resolve the graph. */
  reload?: () => Promise<void>;
  /** When supplied, mounts `POST /mcp` and routes it to this handler. Injected so this package
   * stays free of an MCP dependency; the CLI, which depends on both, supplies it. */
  mcpHandler?: McpRequestHandler;
  /** Mounts evidence ingestion and remediation-chain routes against the supplied ledger. */
  evidence?: EvidenceLedger;
  /** Mounts dry-run reconciliation decisions. No external action is executed by this API. */
  reconciliation?: { ledger: EvidenceLedger; policy: ReconciliationGatePolicy };
}

// Read at runtime (not imported as a TS module) so this keeps working both from `dist/` in the
// monorepo and once published, without fighting `rootDir`/project-reference boundaries.
const packageVersion = (JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { version: string })
  .version;

/**
 * Builds a Fastify app over an already-`load()`ed `OrgGraphStore`.
 *
 * Read-only by default, since the Team API documents are the git-managed source of truth. The one
 * exception is opt-in and does not break that model: with `proposals` configured, a team can be
 * edited into a *pull request* against the repository the documents came from — reviewed,
 * attributable and declinable, rather than written straight into the served graph.
 *
 * Interactive docs (OpenAPI + Swagger UI "Try it out") are served at `/docs`. Routes declare
 * `summary`/`description`/`tags`/`querystring`/`params` schemas for documentation; response bodies
 * are deliberately left unschema'd so Fastify never silently strips fields that don't happen to
 * be enumerated in a hand-written response schema — "Try it out" always shows the real payload.
 */
export async function buildServer(store: OrgGraphStore, options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  registerOrgGraphStore(app, store);
  registerEmbeddings(app, options.embeddings);

  // Before the routes, so every GET — including any added later — gets a validator without having
  // to remember to ask for one.
  registerEtag(app);

  // Registered whether or not /metrics is mounted, so switching the endpoint on mid-incident does
  // not start from zero counters. The cost with no endpoint is one Map keyed by route template.
  const httpMetrics = new HttpMetrics();
  registerHttpMetrics(app, httpMetrics);

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
      // Documented once here rather than per route: every GET carries a content-derived `ETag` and
      // honours `If-None-Match`, and every collection route accepts `limit`/`offset` and answers
      // with `X-Total-Count` plus RFC 8288 `Link`.
      externalDocs: {
        description: "Caching and pagination",
        url: "https://github.com/JGalego/TeamAPI#rest-api",
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
        { name: "Topology", description: "Team Topologies design smells, computed from the resolved graph" },
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
        { name: "Metrics", description: "Prometheus metrics for the org graph and this server" },
        { name: "Proposals", description: "Propose a change to a team as a pull request" },
        { name: "Evidence", description: "Observed facts and finding-to-outcome provenance" },
        { name: "Reconciliation", description: "Evidence- and policy-gated external-system change plans" },
        { name: "Backstage", description: "The org as Backstage catalog entities, served live" },
      ],
    },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list", deepLinking: true, tryItOutEnabled: true },
  });

  app.get("/", { schema: { hide: true } }, async (_req, reply) => reply.redirect("/docs"));

  await app.register(healthRoutes, {
    proposals: Boolean(options.proposals),
    semanticSearch: Boolean(options.embeddings),
    metrics: Boolean(options.metrics),
    reload: Boolean(options.reload),
    mcp: Boolean(options.mcpHandler),
  });
  if (options.metrics) {
    await app.register(metricsRoutes, { http: httpMetrics, version: packageVersion });
  }
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
  await app.register(checksRoutes);
  await app.register(agentControlPlaneRoutes);
  await app.register(knowledgeRoutes);
  await app.register(contextRoutes);
  await app.register(knowledgeGraphRoutes);
  await app.register(backstageRoutes);
  const slackSigningSecret = options.slackSigningSecret ?? process.env.SLACK_SIGNING_SECRET;
  if (slackSigningSecret) {
    await app.register(slackRoutes, { signingSecret: slackSigningSecret });
  }
  if (options.mcpHandler) {
    await app.register(mcpRoutes, { handler: options.mcpHandler });
  }
  if (options.proposals) {
    await app.register(proposalRoutes, options.proposals);
  }
  if (options.evidence) {
    await app.register(evidenceRoutes, { ledger: options.evidence });
  }
  if (options.reconciliation) {
    await app.register(reconciliationRoutes, options.reconciliation);
  }
  await app.register(dashboardRoutes);

  return app;
}
