import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildBackstageCatalog, buildBackstageOrgCatalog, toBackstageYaml } from "../generators/backstage";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

describe("backstage generator — examples/acme-org", () => {
  it("builds a Group entity for the team, with every member listed", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const { entities } = buildBackstageCatalog(graph, "stream-checkout");

    const group = entities.find((e) => e.kind === "Group");
    expect(group).toMatchObject({
      apiVersion: "backstage.io/v1alpha1",
      kind: "Group",
      metadata: { name: "stream-checkout", title: "Stream Checkout" },
      spec: { type: "team", members: ["diego-alves", "yuki-tanaka", "fatima-al-sayed"] },
    });
  });

  it("builds one User entity per member, each pointing memberOf back at the team", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const { entities } = buildBackstageCatalog(graph, "stream-checkout");

    const users = entities.filter((e) => e.kind === "User");
    expect(users.map((u) => u.metadata.name).sort()).toEqual(["diego-alves", "fatima-al-sayed", "yuki-tanaka"]);
    expect(users.every((u) => u.spec.memberOf.includes("stream-checkout"))).toBe(true);
  });

  it("builds a System owned by the team's Group, plus one Component per service", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const { entities } = buildBackstageCatalog(graph, "stream-checkout");

    const system = entities.find((e) => e.kind === "System");
    expect(system).toMatchObject({ metadata: { name: "stream-checkout" }, spec: { owner: "group:stream-checkout" } });

    const components = entities.filter((e) => e.kind === "Component");
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({
      metadata: { name: "checkout-api", links: [{ url: "https://github.com/acme-example/checkout-api", title: "Repository" }] },
      spec: { type: "service", lifecycle: "production", owner: "group:stream-checkout", system: "stream-checkout" },
    });
  });

  it("omits the System entity entirely for a team with no services", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const { entities } = buildBackstageCatalog(graph, "enabling-devex");

    expect(entities.some((e) => e.kind === "System")).toBe(false);
    expect(entities.some((e) => e.kind === "Component")).toBe(false);
    expect(entities.some((e) => e.kind === "Group")).toBe(true);
  });

  it("throws for an unknown team id", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    expect(() => buildBackstageCatalog(graph, "does-not-exist")).toThrow(/Unknown team id/);
  });

  it("builds every team's entities for the whole org", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const entities = buildBackstageOrgCatalog(graph);

    const groups = entities.filter((e) => e.kind === "Group").map((g) => g.metadata.name);
    expect(groups.sort()).toEqual(["enabling-devex", "platform-payments", "stream-checkout", "stream-onboarding"]);
  });

  it("serializes entities as --- separated YAML documents", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const { entities } = buildBackstageCatalog(graph, "stream-checkout");
    const yaml = toBackstageYaml(entities);

    expect(yaml.split("---\n").length).toBe(entities.length);
    expect(yaml).toMatchSnapshot();
  });
});
