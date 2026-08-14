import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { collectOrgMetrics } from "../metrics/org-metrics";
import { escapeLabelValue, renderPrometheus, type Metric } from "../metrics/prometheus";
import type { OrgGraph } from "../model/org-graph";

const ACME_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [ACME_SEED] });
});

describe("renderPrometheus", () => {
  it("emits HELP, TYPE, and one line per sample, ending with a newline", () => {
    const metric: Metric = {
      name: "teamapi_example",
      type: "gauge",
      help: "An example.",
      samples: [{ labels: { kind: "a" }, value: 1 }, { value: 2 }],
    };
    expect(renderPrometheus([metric])).toBe(
      [
        "# HELP teamapi_example An example.",
        "# TYPE teamapi_example gauge",
        'teamapi_example{kind="a"} 1',
        "teamapi_example 2",
        "",
      ].join("\n"),
    );
  });

  it("declares a family with no samples", () => {
    // "Nothing found" and "never collected" must not look identical to a dashboard.
    expect(renderPrometheus([{ name: "teamapi_none", type: "gauge", help: "Nothing.", samples: [] }])).toBe(
      "# HELP teamapi_none Nothing.\n# TYPE teamapi_none gauge\n",
    );
  });

  it("drops undefined labels rather than rendering them as the string 'undefined'", () => {
    const rendered = renderPrometheus([
      { name: "m", type: "gauge", help: "h", samples: [{ labels: { a: "1", b: undefined }, value: 0 }] },
    ]);
    expect(rendered).toContain('m{a="1"} 0');
  });

  it("keeps a multi-line help string on one line", () => {
    // A newline inside HELP ends the line, and everything after it is parsed as a metric name.
    expect(renderPrometheus([{ name: "m", type: "gauge", help: "one\ntwo", samples: [] }])).toContain(
      "# HELP m one two\n",
    );
  });
});

describe("escapeLabelValue", () => {
  it("escapes the three characters the format reserves, and nothing else", () => {
    // These come from team documents — a focus line, a service name. One unescaped quote makes
    // Prometheus reject the *entire* scrape, so one team's punctuation would take out the org.
    expect(escapeLabelValue('a "quoted" value')).toBe('a \\"quoted\\" value');
    expect(escapeLabelValue("back\\slash")).toBe("back\\\\slash");
    expect(escapeLabelValue("two\nlines")).toBe("two\\nlines");
    expect(escapeLabelValue("plain, punctuated: fine!")).toBe("plain, punctuated: fine!");
  });
});

describe("collectOrgMetrics", () => {
  it("counts teams by type, and totals them", () => {
    const byName = Object.fromEntries(collectOrgMetrics(graph).map((metric) => [metric.name, metric]));
    expect(byName["teamapi_org_teams_total"]!.samples).toEqual([{ value: 4 }]);
    expect(byName["teamapi_org_teams"]!.samples).toEqual([
      { labels: { type: "enabling" }, value: 1 },
      { labels: { type: "platform" }, value: 1 },
      { labels: { type: "stream-aligned" }, value: 2 },
    ]);
  });

  it("counts a role nobody fills as vacant", () => {
    const byName = Object.fromEntries(collectOrgMetrics(graph).map((metric) => [metric.name, metric]));
    const vacant = byName["teamapi_org_vacant_roles_total"]!.samples[0]!.value;
    const roles = byName["teamapi_org_roles_total"]!.samples[0]!.value;
    expect(vacant).toBeGreaterThan(0);
    expect(vacant).toBeLessThan(roles);
  });

  it("labels nothing unbounded", () => {
    // Team ids are bounded by the org and change on the timescale of reorganizations, which is
    // what a label is for. A metric per member or per finding message is both a cardinality
    // problem and, on a shared Prometheus, a directory of everybody's name.
    const allowed = new Set(["type", "status", "kind", "severity", "team", "label", "version", "le"]);
    for (const metric of collectOrgMetrics(graph)) {
      for (const sample of metric.samples) {
        for (const key of Object.keys(sample.labels ?? {})) {
          expect({ metric: metric.name, label: key, allowed: allowed.has(key) }).toMatchObject({ allowed: true });
        }
      }
    }
  });

  it("renders without throwing on every metric it produces", () => {
    expect(renderPrometheus(collectOrgMetrics(graph)).split("\n").length).toBeGreaterThan(20);
  });
});
