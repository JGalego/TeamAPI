import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "@teamapi/core";
import { buildChatPersona } from "../persona";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

describe("buildChatPersona — examples/acme-org", () => {
  it("builds a team-wide persona naming the team and its roles", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const persona = buildChatPersona(graph, { teamId: "stream-checkout" });

    expect(persona.name).toBe("Stream Checkout");
    expect(persona.systemPrompt).toContain("Stream Checkout");
    expect(persona.systemPrompt).toContain("stream-aligned");
    expect(persona.systemPrompt).toContain("Checkout Tech Lead");
    expect(persona.systemPrompt.toLowerCase()).toContain("tools");
  });

  it("builds a member persona naming the person and their role(s)", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const persona = buildChatPersona(graph, { teamId: "stream-checkout", memberId: "diego-alves" });

    expect(persona.name).toBe("Diego Alves");
    expect(persona.systemPrompt).toContain("Diego Alves");
    expect(persona.systemPrompt).toContain("Checkout Tech Lead");
    expect(persona.systemPrompt).toContain("Stream Checkout");
  });

  it("throws for an unknown team id", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    expect(() => buildChatPersona(graph, { teamId: "does-not-exist" })).toThrow(/Unknown team id/);
  });

  it("throws for an unknown member id on a known team", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    expect(() => buildChatPersona(graph, { teamId: "stream-checkout", memberId: "nobody" })).toThrow(
      /Unknown member id/,
    );
  });
});
