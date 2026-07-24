import { describe, expect, it } from "vitest";
import { TeamApiDocumentSchema } from "../v1/team";
import { responsibilityDoneWhen, responsibilityText } from "../v1/roles";
import { getTeamApiJsonSchema } from "../json-schema";
import { isSupportedVersion, resolveSchemaForVersion, SCHEMA_REGISTRY } from "../index";
import { SUGGESTED_ROLE_KINDS } from "../v1/primitives";

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
        {
          id: "tech-lead",
          name: "Tech Lead",
          kind: "TechLead",
          responsibilities: ["Architecture", { text: "On-call", doneWhen: "A runbook exists." }],
        },
        { id: "engineer", name: "Engineer", kind: "Engineer", reportsTo: "tech-lead" },
        {
          id: "product-owner",
          name: "Product Owner",
          kind: "ProductManager",
          reportsToRef: {
            teamName: "Platform Payments",
            roleId: "head-of-product",
            $ref: "../platform-payments/teamapi.yml",
          },
          alignsWith: [
            {
              teamName: "Enabling DevEx",
              roleId: "coach",
              $ref: "../enabling-devex/teamapi.yml",
            },
          ],
        },
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
    expect(parsed.roles[2]?.reportsToRef).toEqual({
      teamName: "Platform Payments",
      roleId: "head-of-product",
      $ref: "../platform-payments/teamapi.yml",
    });
    expect(parsed.roles[2]?.alignsWith).toEqual([
      { teamName: "Enabling DevEx", roleId: "coach", $ref: "../enabling-devex/teamapi.yml" },
    ]);
    expect(parsed.roles[0]?.alignsWith).toEqual([]);
    expect(parsed.interactions[0]?.contextMappingPattern).toBe("CustomerSupplier");
    expect(parsed.roles[0]?.responsibilities).toEqual(["Architecture", { text: "On-call", doneWhen: "A runbook exists." }]);
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

  it("allows vendor extension fields on a platform ref via passthrough", () => {
    const withExtension = {
      ...minimalValid,
      platform: { $ref: "../platform-payments/teamapi.yml", "x-owner": "platform-team" },
    };
    const parsed = TeamApiDocumentSchema.parse(withExtension);
    expect((parsed.platform as Record<string, unknown> | undefined)?.["x-owner"]).toBe(
      "platform-team",
    );
  });

  it("allows vendor extension fields on a role's reportsToRef via passthrough", () => {
    const withExtension = {
      ...minimalValid,
      roles: [
        {
          id: "engineer",
          name: "Engineer",
          kind: "Engineer",
          reportsToRef: {
            teamName: "Platform Payments",
            roleId: "head-of-engineering",
            $ref: "../platform-payments/teamapi.yml",
            "x-since": "2025-01-01",
          },
        },
      ],
    };
    const parsed = TeamApiDocumentSchema.parse(withExtension);
    expect((parsed.roles[0]?.reportsToRef as Record<string, unknown> | undefined)?.["x-since"]).toBe(
      "2025-01-01",
    );
  });
});

describe("role cross-field validation", () => {
  it("rejects a role with both reportsTo and reportsToRef set", () => {
    const invalid = {
      ...minimalValid,
      roles: [
        { id: "tech-lead", name: "Tech Lead", kind: "TechLead" },
        {
          id: "engineer",
          name: "Engineer",
          kind: "Engineer",
          reportsTo: "tech-lead",
          reportsToRef: {
            teamName: "Platform Payments",
            roleId: "head-of-engineering",
            $ref: "../platform-payments/teamapi.yml",
          },
        },
      ],
    };
    expect(() => TeamApiDocumentSchema.parse(invalid)).toThrow(/mutually exclusive/);
  });

  it("rejects a reportsTo that doesn't match any role id in the team", () => {
    const invalid = {
      ...minimalValid,
      roles: [{ id: "engineer", name: "Engineer", kind: "Engineer", reportsTo: "tech-laed" }],
    };
    expect(() => TeamApiDocumentSchema.parse(invalid)).toThrow(/does not match any role id/);
  });

  it("rejects a same-team reportsTo cycle", () => {
    const invalid = {
      ...minimalValid,
      roles: [
        { id: "a", name: "A", kind: "Engineer", reportsTo: "b" },
        { id: "b", name: "B", kind: "Engineer", reportsTo: "a" },
      ],
    };
    expect(() => TeamApiDocumentSchema.parse(invalid)).toThrow(/cycle detected/);
  });

  it("rejects a role that reports to itself", () => {
    const invalid = {
      ...minimalValid,
      roles: [{ id: "a", name: "A", kind: "Engineer", reportsTo: "a" }],
    };
    expect(() => TeamApiDocumentSchema.parse(invalid)).toThrow(/cycle detected/);
  });

  it("rejects duplicate role ids within a team", () => {
    const invalid = {
      ...minimalValid,
      roles: [
        { id: "engineer", name: "Engineer One", kind: "Engineer" },
        { id: "engineer", name: "Engineer Two", kind: "Engineer" },
      ],
    };
    expect(() => TeamApiDocumentSchema.parse(invalid)).toThrow(/Duplicate role id/);
  });

  it("rejects duplicate member ids within a team", () => {
    const invalid = {
      ...minimalValid,
      members: [
        { id: "ada-lovelace", name: "Ada Lovelace" },
        { id: "ada-lovelace", name: "Ada L." },
      ],
    };
    expect(() => TeamApiDocumentSchema.parse(invalid)).toThrow(/Duplicate member id/);
  });
});

describe("version registry", () => {
  it("recognizes the currently-supported version", () => {
    expect(isSupportedVersion("1.0.0")).toBe(true);
    expect(isSupportedVersion("2.0.0")).toBe(false);
  });

  it("resolves the schema for a supported version and not for an unsupported one", () => {
    expect(resolveSchemaForVersion("1.0.0")).toBe(SCHEMA_REGISTRY["1.0.0"]);
    expect(resolveSchemaForVersion("0.9.0")).toBeUndefined();
  });
});

describe("SUGGESTED_ROLE_KINDS", () => {
  it("is a non-empty list of suggested (non-exhaustive) role kinds", () => {
    expect(SUGGESTED_ROLE_KINDS.length).toBeGreaterThan(0);
    expect(SUGGESTED_ROLE_KINDS).toContain("TechLead");
  });

  it("does not constrain roles[].kind to only these values", () => {
    const withCustomKind = {
      ...minimalValid,
      roles: [{ id: "wizard", name: "Wizard", kind: "SomeCustomKind" }],
    };
    expect(() => TeamApiDocumentSchema.parse(withCustomKind)).not.toThrow();
  });
});

describe("Responsibility", () => {
  it("reads text/doneWhen off either the string or object form", () => {
    expect(responsibilityText("Architecture")).toBe("Architecture");
    expect(responsibilityDoneWhen("Architecture")).toBeUndefined();

    const withDoneWhen = { text: "On-call", doneWhen: "A runbook exists." };
    expect(responsibilityText(withDoneWhen)).toBe("On-call");
    expect(responsibilityDoneWhen(withDoneWhen)).toBe("A runbook exists.");

    const withoutDoneWhen = { text: "On-call" };
    expect(responsibilityDoneWhen(withoutDoneWhen)).toBeUndefined();
  });
});

describe("getTeamApiJsonSchema", () => {
  it("produces a JSON Schema with the expected root required fields", () => {
    const schema = getTeamApiJsonSchema();
    const def = (schema.definitions as Record<string, any>)?.TeamApiDocument ?? schema;
    expect(def.required).toEqual(expect.arrayContaining(["teamApiVersion", "id", "info"]));
  });
});
