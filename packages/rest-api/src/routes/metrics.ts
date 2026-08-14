import type { FastifyInstance } from "fastify";
import { collectOrgMetrics, renderPrometheus, type Metric } from "@jgalego/teamapi-core";
import type { HttpMetrics } from "../plugins/http-metrics";

/** The exposition format's own content type. Prometheus accepts `text/plain` without it, but the
 * version parameter is what tells a scraper which format it is reading rather than guessing. */
const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export interface MetricsRouteOptions {
  http: HttpMetrics;
  version: string;
}

/**
 * `GET /metrics` in the Prometheus exposition format.
 *
 * The OpenTelemetry generator has always emitted resource attributes so *other* services can say
 * which team owns them; the API that computed those attributes exported nothing about itself or
 * about the org it was serving. This is that missing half — and the org half is the interesting
 * one. Cognitive load per team, agents by status, blocking gaps, unresolved references and the age
 * of the resolved graph are exactly the things that are invisible in a report somebody runs
 * manually and obvious on a chart.
 *
 * Behind the same bearer token as everything else, unlike `/health`. It carries team ids, team
 * types and per-team load scores, which is org structure — less than `/graph` gives away, but not
 * nothing, and a scraper can send a header where a load balancer's liveness probe cannot.
 */
export async function metricsRoutes(app: FastifyInstance, options: MetricsRouteOptions): Promise<void> {
  app.get(
    "/metrics",
    {
      schema: {
        tags: ["Metrics"],
        summary: "Prometheus metrics",
        description:
          "Org-graph metrics (teams by type, cognitive load per team, agents by status, gaps/policy/topology " +
          "findings, unresolved references, graph age) plus this server's own request counts and latencies, in " +
          "the Prometheus text exposition format.",
        produces: ["text/plain"],
      },
    },
    async (_req, reply) => {
      const build: Metric = {
        name: "teamapi_build_info",
        type: "gauge",
        help: "Always 1. The version is in the label, which is how a build is joined onto other series.",
        samples: [{ labels: { version: options.version }, value: 1 }],
      };

      // Recomputed per scrape from the graph the server is currently serving, rather than cached
      // on load: a reload swaps the graph underneath, and a cached payload would keep reporting
      // the org that existed at startup — which is precisely the failure the graph-age metric is
      // meant to make visible.
      const metrics = [build, ...collectOrgMetrics(app.orgGraphStore.current), ...options.http.collect()];
      return reply.type(CONTENT_TYPE).send(renderPrometheus(metrics));
    },
  );
}
