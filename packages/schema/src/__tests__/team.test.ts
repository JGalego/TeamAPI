import { describe, expect, it } from "vitest";
import { TeamApiDocumentSchema } from "../v1/team";
import { getTeamApiJsonSchema } from "../json-schema";

const minimalValid = {
  teamApiVersion: "1.0.0",
  id: "stream-checkout",
  info: {
    name: "Checkout",
    type: "stream-aligned",
  },
};

describe("TeamApiDocumentSchema", () => {
  it("parses a minimal valid document and fills in defaults", () => {
    const parsed = TeamApiDocumentSchema.parse(minimalValid);
    expect(parsed.id).toBe("stream-checkout");
    expect(parsed.channels).toEqual([]);
    expect(parsed.roles).toEqual([]);
    expect(parsed.dependencies).toEqual([]);
  });

  it("parses a fully populated document", () => {
    const full = {
      ...minimalValid,
      channels: [{ type: "slack", name: "checkout" }],
      searchTerms: [{ term: "checkout" }],
      platform: { $ref: "../platform-payments/teamapi.yml" },
      services: [
        {
          name: "checkout-api",
          repository: "https://example.com/checkout-api",
          boundedContext: {
            ubiquitousLanguage: [{ term: "Cart", definition: "An in-progress order" }],
            aggregates: ["Cart", "Order"],
            publishedEvents: ["OrderPlaced"],
            subscribedEvents: ["PaymentAuthorized"],
          },
        },
      ],
      roles: [
        { id: "tech-lead", name: "Tech Lead", kind: "TechLead", responsibilities: ["Architecture"] },
        { id: "engineer", name: "Engineer", kind: "Engineer", reportsTo: "tech-lead" },
      ],
      members: [
        { id: "ada-lovelace", name: "Ada Lovelace", roleIds: ["tech-lead"], allocation: 100 },
        { id: "grace-hopper", name: "Grace Hopper", roleIds: ["engineer"], allocation: 100 },
      ],
      cognitiveLoad: { intrinsic: 6, extraneous: 3, germane: 5, notes: "Manageable" },
      interactions: [
        {
          teamName: "Platform Payments",
          mode: "x-as-a-service",
          purpose: "Consume payments platform",
          contextMappingPattern: "CustomerSupplier",
          $ref: "../platform-payments/teamapi.yml",
        },
      ],
      dependencies: [
        {
          teamName: "Stream Onboarding",
          description: "Shared checkout flow entry point",
          type: "OK",
          $ref: "../stream-onboarding/teamapi.yml",
        },
      ],
    };

    const parsed = TeamApiDocumentSchema.parse(full);
    expect(parsed.roles[1]?.reportsTo).toBe("tech-lead");
    expect(parsed.interactions[0]?.contextMappingPattern).toBe("CustomerSupplier");
  });

  it("rejects an invalid team type", () => {
    const invalid = { ...minimalValid, info: { ...minimalValid.info, type: "not-a-type" } };
    expect(() => TeamApiDocumentSchema.parse(invalid)).toThrow();
  });

  it("rejects a non-slug id", () => {
    const invalid = { ...minimalValid, id: "Stream Checkout!" };
    expect(() => TeamApiDocumentSchema.parse(invalid)).toThrow();
  });

  it("allows vendor extension fields via passthrough", () => {
    const withExtension = { ...minimalValid, "x-internal-notes": "some note" };
    const parsed = TeamApiDocumentSchema.parse(withExtension);
    expect((parsed as Record<string, unknown>)["x-internal-notes"]).toBe("some note");
  });
});

describe("getTeamApiJsonSchema", () => {
  it("produces a JSON Schema with the expected root required fields", () => {
    const schema = getTeamApiJsonSchema();
    const def = (schema.definitions as Record<string, any>)?.TeamApiDocument ?? schema;
    expect(def.required).toEqual(expect.arrayContaining(["teamApiVersion", "id", "info"]));
  });
});
