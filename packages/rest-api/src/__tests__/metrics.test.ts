import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { HttpMetrics } from "../plugins/http-metrics";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let app: FastifyInstance;

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
  app = await buildServer(store, { metrics: true });
});

/** Parses an exposition payload into `{ "name{labels}": value }`, so assertions can name a series
 * rather than matching a substring of a 200-line body. */
function parse(body: string): Record<string, number> {
  return Object.fromEntries(
    body
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const split = line.lastIndexOf(" ");
        return [line.slice(0, split), Number(line.slice(split + 1))];
      }),
  );
}

describe("GET /metrics", () => {
  it("is not mounted unless asked for", async () => {
    const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
    await store.load();
    const plain = await buildServer(store);
    expect((await plain.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(404);
  });

  it("serves the Prometheus exposition format", async () => {
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/plain; version=0.0.4; charset=utf-8");
    // Every family carries HELP and TYPE, and the payload ends with a newline — without it the
    // last sample is silently dropped by a scraper.
    expect(res.body).toContain("# HELP teamapi_org_teams_total");
    expect(res.body).toContain("# TYPE teamapi_org_teams_total gauge");
    expect(res.body.endsWith("\n")).toBe(true);
  });

  it("reports the org graph it is actually serving", async () => {
    const samples = parse((await app.inject({ method: "GET", url: "/metrics" })).body);
    expect(samples["teamapi_org_teams_total"]).toBe(4);
    expect(samples['teamapi_org_teams{type="platform"}']).toBe(1);
    expect(samples['teamapi_org_teams{type="stream-aligned"}']).toBe(2);
    expect(samples["teamapi_org_unresolved_refs_total"]).toBe(0);
    expect(samples["teamapi_org_resolved_timestamp_seconds"]).toBeGreaterThan(1_600_000_000);
  });

  it("reports per-team cognitive load, with the label beside the score", async () => {
    const samples = parse((await app.inject({ method: "GET", url: "/metrics" })).body);
    expect(samples['teamapi_cognitive_load{team="stream-checkout",label="overloaded"}']).toBe(18);
    // Supervision is deliberately outside `total`, so it needs its own series or a team's agent
    // review load is invisible on every chart.
    expect(samples['teamapi_supervision_load{team="platform-payments"}']).toBe(6);
  });

  it("reports findings from all three graph-only checks", async () => {
    const body = (await app.inject({ method: "GET", url: "/metrics" })).body;
    expect(body).toContain("teamapi_gaps{");
    expect(body).toContain("# TYPE teamapi_policy_findings gauge");
    expect(body).toContain("# TYPE teamapi_topology_findings gauge");
  });

  it("declares an empty family rather than omitting it", async () => {
    // "No topology findings" and "topology was never checked" must not look identical to a
    // dashboard: one is a green org, the other is a broken collector.
    const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
    await store.load();
    const fresh = await buildServer(store, { metrics: true });
    const body = (await fresh.inject({ method: "GET", url: "/metrics" })).body;
    for (const family of ["teamapi_gaps", "teamapi_policy_findings", "teamapi_topology_findings"]) {
      expect(body).toContain(`# TYPE ${family} gauge`);
    }
  });

  it("counts requests by route template, not by URL", async () => {
    // The whole cardinality argument in one assertion: three requests for three different teams
    // must be one series, not three.
    const fresh = await buildServer(new OrgGraphStore({ seedUris: [CHECKOUT_SEED] }), { metrics: true });
    await fresh.orgGraphStore.load();
    for (const id of ["stream-checkout", "platform-payments", "enabling-devex"]) {
      await fresh.inject({ method: "GET", url: `/teams/${id}` });
    }
    const samples = parse((await fresh.inject({ method: "GET", url: "/metrics" })).body);
    expect(samples['teamapi_http_requests_total{method="GET",route="/teams/:id",status="200"}']).toBe(3);
  });

  it("labels an unmatched path once, however many different ones arrive", async () => {
    const fresh = await buildServer(new OrgGraphStore({ seedUris: [CHECKOUT_SEED] }), { metrics: true });
    await fresh.orgGraphStore.load();
    for (const url of ["/wp-admin", "/.env", "/phpmyadmin"]) await fresh.inject({ method: "GET", url });
    const samples = parse((await fresh.inject({ method: "GET", url: "/metrics" })).body);
    expect(samples['teamapi_http_requests_total{method="GET",route="__unmatched__",status="404"}']).toBe(3);
  });

  it("requires the bearer token, unlike /health", async () => {
    const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
    await store.load();
    const secured = await buildServer(store, { metrics: true, apiToken: "sekret" });

    expect((await secured.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await secured.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    expect(
      (await secured.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer sekret" } }))
        .statusCode,
    ).toBe(200);
  });
});

describe("HttpMetrics", () => {
  it("emits a well-formed histogram: cumulative buckets, +Inf, _sum and _count", () => {
    const metrics = new HttpMetrics();
    metrics.record("GET", "/teams", 200, 0.002);
    metrics.record("GET", "/teams", 200, 0.2);

    const byName = Object.fromEntries(metrics.collect().map((metric) => [metric.name, metric]));
    const labels = { method: "GET", route: "/teams", status: "200" };
    const bucket = (le: string): number | undefined =>
      byName["teamapi_http_request_duration_seconds_bucket"]!.samples.find((s) => s.labels?.le === le)?.value;

    // Cumulative: 0.002 falls in every bucket from 0.005 up; 0.2 only from 0.5 up.
    expect(bucket("0.001")).toBe(0);
    expect(bucket("0.005")).toBe(1);
    expect(bucket("0.1")).toBe(1);
    expect(bucket("0.5")).toBe(2);
    expect(bucket("+Inf")).toBe(2);

    expect(byName["teamapi_http_request_duration_seconds_count"]!.samples).toEqual([{ labels, value: 2 }]);
    expect(byName["teamapi_http_request_duration_seconds_sum"]!.samples).toEqual([{ labels, value: 0.202 }]);
    expect(byName["teamapi_http_requests_total"]!.samples).toEqual([{ labels, value: 2 }]);
  });

  it("keeps separate series per method, route and status", () => {
    const metrics = new HttpMetrics();
    metrics.record("GET", "/teams", 200, 0.01);
    metrics.record("GET", "/teams", 404, 0.01);
    metrics.record("POST", "/context", 200, 0.01);
    expect(metrics.collect()[0]!.samples).toHaveLength(3);
  });
});
