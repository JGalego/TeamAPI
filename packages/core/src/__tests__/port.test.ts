import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildPortCatalog, portBlueprints } from "../generators/port";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");
const acme = () => buildOrgGraph({ seedUris: [CHECKOUT_SEED] });

const of = (c: { entities: { blueprint: string; identifier: string }[] }, blueprint: string) =>
  c.entities.filter((e) => e.blueprint === blueprint);

describe("portBlueprints", () => {
  it("declares the three blueprints the entities reference, and nothing else", () => {
    expect(portBlueprints().map((b) => b.identifier)).toEqual(["teamapi_team", "teamapi_service", "teamapi_person"]);
  });

  it("points every relation at a blueprint that exists", () => {
    const blueprints = portBlueprints();
    const known = new Set(blueprints.map((b) => b.identifier));
    for (const blueprint of blueprints) {
      for (const relation of Object.values(blueprint.relations)) {
        expect(known.has(relation.target)).toBe(true);
      }
    }
  });

  it("constrains topology and load label to the values the schema allows", () => {
    const team = portBlueprints().find((b) => b.identifier === "teamapi_team")!;
    expect(team.schema.properties.topology!.enum).toEqual([
      "stream-aligned",
      "platform",
      "complicated-subsystem",
      "enabling",
    ]);
    expect(team.schema.properties.cognitiveLoadLabel!.enum).toEqual(["sustainable", "elevated", "overloaded"]);
  });
});

describe("buildPortCatalog — examples/acme-org", () => {
  it("emits one team entity per team", async () => {
    const catalog = buildPortCatalog(await acme());
    expect(of(catalog, "teamapi_team").map((e) => e.identifier)).toEqual([
      "enabling-devex",
      "platform-payments",
      "stream-checkout",
      "stream-onboarding",
    ]);
  });

  it("carries cognitive load, which is the reason to prefer this over the Backstage target", async () => {
    const catalog = buildPortCatalog(await acme());
    const checkout = of(catalog, "teamapi_team").find((e) => e.identifier === "stream-checkout")!;
    expect(checkout).toMatchObject({
      properties: { topology: "stream-aligned", cognitiveLoad: 18, cognitiveLoadLabel: "overloaded" },
    });
  });

  it("omits load entirely for a team that never assessed itself", async () => {
    const catalog = buildPortCatalog(await acme());
    const devex = of(catalog, "teamapi_team").find((e) => e.identifier === "enabling-devex")!;
    expect(devex.properties).not.toHaveProperty("cognitiveLoad");
    expect(devex.properties).not.toHaveProperty("cognitiveLoadLabel");
  });

  it("relates each service to the team that owns it", async () => {
    const catalog = buildPortCatalog(await acme());
    const checkoutApi = of(catalog, "teamapi_service").find((e) => e.identifier === "checkout-api")!;
    expect(checkoutApi).toMatchObject({
      blueprint: "teamapi_service",
      relations: { owner: "stream-checkout" },
      properties: { repository: "https://github.com/acme-example/checkout-api" },
    });
  });

  it("relates each team to its members", async () => {
    const catalog = buildPortCatalog(await acme());
    const checkout = of(catalog, "teamapi_team").find((e) => e.identifier === "stream-checkout")!;
    expect(checkout.relations.members).toEqual(["diego-alves", "yuki-tanaka", "fatima-al-sayed"]);
  });

  it("emits a person once even when two teams list them", async () => {
    const graph = await acme();
    graph.teams.get("platform-payments")!.doc.members.push({
      id: "diego-alves",
      name: "Diego Alves",
      roleIds: [],
    });

    const catalog = buildPortCatalog(graph);
    const diegos = of(catalog, "teamapi_person").filter((e) => e.identifier === "diego-alves");
    expect(diegos).toHaveLength(1);
  });

  it("never emits an entity whose relation points at a missing entity", async () => {
    const catalog = buildPortCatalog(await acme());
    const ids = new Set(catalog.entities.map((e) => e.identifier));
    for (const entity of catalog.entities) {
      for (const target of Object.values(entity.relations).flat()) {
        expect(ids.has(target)).toBe(true);
      }
    }
  });

  it("scopes to one team when asked, and rejects an unknown id", async () => {
    const graph = await acme();
    const catalog = buildPortCatalog(graph, "stream-checkout");
    expect(of(catalog, "teamapi_team")).toHaveLength(1);
    expect(of(catalog, "teamapi_service").map((e) => e.identifier)).toEqual(["checkout-api"]);
    expect(() => buildPortCatalog(graph, "nope")).toThrow("Unknown team id: nope");
  });

  it("leaves out properties the document doesn't set", async () => {
    const catalog = buildPortCatalog(await acme());
    for (const entity of catalog.entities) {
      for (const value of Object.values(entity.properties)) {
        expect(value).not.toBeUndefined();
        expect(value).not.toBe("");
      }
    }
  });
});
