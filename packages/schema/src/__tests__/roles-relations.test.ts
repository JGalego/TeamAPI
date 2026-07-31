import { describe, expect, it } from "vitest";
import { RoleSchema } from "../v1/roles";

const ref = (extra: Record<string, unknown> = {}) => ({
  teamName: "Enabling AI Guild",
  roleId: "guild-lead",
  $ref: "../enabling-ai-guild/teamapi.yml",
  ...extra,
});

describe("RoleRef.kind", () => {
  it("defaults to nothing, leaving pre-existing documents unchanged", () => {
    const role = RoleSchema.parse({ id: "lead", name: "Lead", kind: "TechLead", alignsWith: [ref()] });
    expect(role.alignsWith[0]!.kind).toBeUndefined();
  });

  it.each(["aligns-with", "advises", "learns-from", "community-of-practice"])("accepts kind=%s", (kind) => {
    const role = RoleSchema.parse({ id: "lead", name: "Lead", kind: "TechLead", alignsWith: [ref({ kind })] });
    expect(role.alignsWith[0]!.kind).toBe(kind);
  });

  it("rejects an unknown relation kind", () => {
    const parsed = RoleSchema.safeParse({
      id: "lead",
      name: "Lead",
      kind: "TechLead",
      alignsWith: [ref({ kind: "gossips-with" })],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects kind on reportsToRef rather than silently ignoring it", () => {
    const parsed = RoleSchema.safeParse({
      id: "lead",
      name: "Lead",
      kind: "TechLead",
      reportsToRef: ref({ kind: "advises" }),
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]!.message).toContain("kind belongs on alignsWith[]");
  });
});
