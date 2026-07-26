import * as path from "node:path";
import * as YAML from "js-yaml";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import {
  buildCollectorConfig,
  buildOtelAttributes,
  buildOtelPackage,
  encodeBaggageValue,
  resourceAttributesLine,
} from "../generators/otel";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");
const acme = () => buildOrgGraph({ seedUris: [CHECKOUT_SEED] });

describe("OTEL_RESOURCE_ATTRIBUTES encoding", () => {
  it("encodes the characters that would otherwise end the list early", () => {
    // a bare comma or equals would be read as the next key/value boundary
    expect(encodeBaggageValue("Cart, checkout, orders")).toBe("Cart%2C%20checkout%2C%20orders");
    expect(encodeBaggageValue("a=b")).toBe("a%3Db");
  });

  it("round-trips through a parser that splits on the delimiters", () => {
    const attributes = { "service.name": "checkout-api", "teamapi.team_name": "Cart, Checkout & Orders" };
    const parsed = Object.fromEntries(
      resourceAttributesLine(attributes)
        .split(",")
        .map((pair) => {
          const [k, v] = pair.split("=");
          return [k!, decodeURIComponent(v!)];
        }),
    );
    expect(parsed).toEqual(attributes);
  });
});

describe("buildOtelAttributes — examples/acme-org", () => {
  it("emits one entry per service, sorted", async () => {
    const entries = buildOtelAttributes(await acme());
    expect(entries.map((e) => e.service)).toEqual(["checkout-api", "ledger", "onboarding-api", "payments-api"]);
  });

  it("uses the semantic-convention attributes for name and namespace", async () => {
    const entry = buildOtelAttributes(await acme()).find((e) => e.service === "checkout-api")!;
    expect(entry.attributes["service.name"]).toBe("checkout-api");
    expect(entry.attributes["service.namespace"]).toBe("stream-checkout");
  });

  it("keeps org-specific attributes out of the reserved namespace", async () => {
    const entry = buildOtelAttributes(await acme()).find((e) => e.service === "checkout-api")!;
    const ours = Object.keys(entry.attributes).filter((k) => !k.startsWith("service."));
    expect(ours.length).toBeGreaterThan(0);
    for (const key of ours) expect(key.startsWith("teamapi.")).toBe(true);
  });

  it("carries the team's channel, so an alert knows where to go", async () => {
    const entry = buildOtelAttributes(await acme()).find((e) => e.service === "checkout-api")!;
    expect(entry.attributes["teamapi.channel"]).toBe("stream-checkout");
  });

  it("omits attributes the document doesn't supply", async () => {
    const graph = await acme();
    graph.teams.get("stream-checkout")!.doc.channels = [];
    graph.teams.get("stream-checkout")!.doc.services[0]!.repository = undefined;

    const entry = buildOtelAttributes(graph).find((e) => e.service === "checkout-api")!;
    expect(entry.attributes).not.toHaveProperty("teamapi.channel");
    expect(entry.attributes).not.toHaveProperty("teamapi.repository");
  });
});

describe("collector config", () => {
  it("emits one OTTL statement per attribute, since the grammar allows only one editor", async () => {
    const services = buildOtelAttributes(await acme());
    const parsed = YAML.load(buildCollectorConfig(services)) as {
      processors: { "transform/teamapi": { trace_statements: Array<{ statements: string[] }> } };
    };
    const statements = parsed.processors["transform/teamapi"].trace_statements[0]!.statements;

    for (const statement of statements) {
      expect(statement.match(/\bset\(/g)).toHaveLength(1);
      expect(statement).toMatch(/^set\(attributes\[".+"\], .+\) where attributes\["service\.name"\] == ".+"$/);
    }
  });

  it("covers every attribute of every service, except the key it matches on", async () => {
    const services = buildOtelAttributes(await acme());
    const parsed = YAML.load(buildCollectorConfig(services)) as {
      processors: { "transform/teamapi": { trace_statements: Array<{ statements: string[] }> } };
    };
    const statements = parsed.processors["transform/teamapi"].trace_statements[0]!.statements;

    const expected = services.reduce((n, s) => n + Object.keys(s.attributes).length - 1, 0);
    expect(statements).toHaveLength(expected);
    expect(statements.some((s) => s.includes('attributes["service.name"],'))).toBe(false);
  });

  it("applies the same statements to traces, metrics and logs", async () => {
    const parsed = YAML.load(buildCollectorConfig(buildOtelAttributes(await acme()))) as {
      processors: { "transform/teamapi": Record<string, Array<{ statements: string[] }>> };
    };
    const p = parsed.processors["transform/teamapi"]!;
    expect(p.trace_statements![0]!.statements).toEqual(p.metric_statements![0]!.statements);
    expect(p.trace_statements![0]!.statements).toEqual(p.log_statements![0]!.statements);
  });
});

describe("buildOtelPackage", () => {
  it("writes one env file per service plus the collector config", async () => {
    const pkg = buildOtelPackage(await acme());
    expect(pkg.files.map((f) => f.path)).toEqual([
      "checkout-api.env",
      "ledger.env",
      "onboarding-api.env",
      "payments-api.env",
      "collector.yaml",
    ]);
  });

  it("writes a single OTEL_RESOURCE_ATTRIBUTES line an SDK can read directly", async () => {
    const pkg = buildOtelPackage(await acme());
    const env = pkg.files.find((f) => f.path === "checkout-api.env")!.content;
    const lines = env.trimEnd().split("\n");
    expect(lines.filter((l) => !l.startsWith("#"))).toHaveLength(1);
    expect(lines.at(-1)).toMatch(/^OTEL_RESOURCE_ATTRIBUTES=service\.name=checkout-api,/);
  });
});
