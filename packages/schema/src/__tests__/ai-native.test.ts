import { describe, expect, it } from "vitest";
import { TeamApiDocumentSchema } from "../v1/team";

const minimalValid = {
  teamApiVersion: "1.0.0",
  id: "stream-checkout",
  info: { name: "Checkout", type: "stream-aligned" },
};

describe("AI-native resource domains", () => {
  it("default to empty arrays, so a document written before these fields existed still parses identically", () => {
    const parsed = TeamApiDocumentSchema.parse(minimalValid);
    expect(parsed.agents).toEqual([]);
    expect(parsed.memory).toEqual([]);
    expect(parsed.specifications).toEqual([]);
    expect(parsed.steeringDocuments).toEqual([]);
    expect(parsed.prompts).toEqual([]);
    expect(parsed.playbooks).toEqual([]);
    expect(parsed.policies).toEqual([]);
    expect(parsed.knowledgeBase).toEqual([]);
    expect(parsed.workflows).toEqual([]);
    expect(parsed.sessions).toEqual([]);
  });

  it("parses a fully populated document across every new domain", () => {
    const full = {
      ...minimalValid,
      agents: [
        {
          id: "architecture-reviewer",
          name: "Architecture Reviewer",
          provider: "OpenAI",
          role: "reviewer",
          capabilities: ["code-review", "spec-generation"],
        },
      ],
      memory: [
        {
          id: "pci-scope-lesson",
          title: "PCI scope creep",
          kind: "lesson-learned",
          body: "Never log raw card data.",
        },
      ],
      specifications: [
        {
          id: "oauth-login",
          title: "OAuth login",
          kind: "requirement",
          linkedDocuments: [{ $ref: "../platform-payments/teamapi.yml" }],
        },
      ],
      steeringDocuments: [
        {
          id: "security-guidelines",
          title: "Security Guidelines",
          category: "security-guidelines",
          scope: "organization",
          body: "Use OAuth 2.0 / OIDC.",
        },
      ],
      prompts: [
        {
          id: "code-review",
          name: "Code Review",
          template: "Review {{repository}}.",
          variables: [{ name: "repository", required: true }],
        },
      ],
      playbooks: [
        {
          id: "incident-response",
          name: "Incident Response",
          category: "incident-response",
          steps: [{ order: 1, title: "Acknowledge the page" }],
        },
      ],
      policies: [
        {
          id: "pr-requires-two-approvals",
          name: "Two approvals required",
          category: "required-approvals",
          rules: [{ key: "min_approvals", value: 2 }],
        },
      ],
      knowledgeBase: [
        {
          id: "adr-oauth",
          title: "ADR: OAuth",
          kind: "adr",
          body: "We chose OAuth 2.0.",
        },
      ],
      workflows: [
        {
          id: "release",
          name: "Release Workflow",
          states: [
            { id: "testing", name: "Testing" },
            { id: "approval", name: "Approval" },
          ],
          transitions: [{ from: "testing", to: "approval", trigger: "ci-green" }],
        },
      ],
      sessions: [
        {
          id: "2026-07-01-oauth-spike",
          agentId: "architecture-reviewer",
          assistant: "Architecture Reviewer",
          objective: "Review the OAuth design",
          promptIds: ["code-review"],
        },
      ],
    };

    const parsed = TeamApiDocumentSchema.parse(full);
    expect(parsed.agents[0]?.status).toBe("active");
    expect(parsed.specifications[0]?.status).toBe("draft");
    expect(parsed.policies[0]?.severity).toBe("warning");
    expect(parsed.steeringDocuments[0]?.scope).toBe("organization");
    expect(parsed.workflows[0]?.transitions).toHaveLength(1);
  });

  it("rejects duplicate ids within an agents[] array", () => {
    const doc = {
      ...minimalValid,
      agents: [
        { id: "dup", name: "A", provider: "OpenAI", role: "reviewer" },
        { id: "dup", name: "B", provider: "OpenAI", role: "reviewer" },
      ],
    };
    expect(() => TeamApiDocumentSchema.parse(doc)).toThrow(/Duplicate id 'dup'/);
  });

  it("rejects a workflow transition referencing an unknown state id", () => {
    const doc = {
      ...minimalValid,
      workflows: [
        {
          id: "release",
          name: "Release",
          states: [{ id: "testing", name: "Testing" }],
          transitions: [{ from: "testing", to: "does-not-exist", trigger: "x" }],
        },
      ],
    };
    expect(() => TeamApiDocumentSchema.parse(doc)).toThrow(/does not match any state id/);
  });

  it("rejects an unknown enum value for a resource's category/kind", () => {
    const doc = {
      ...minimalValid,
      steeringDocuments: [{ id: "x", title: "X", category: "not-a-real-category", body: "..." }],
    };
    expect(() => TeamApiDocumentSchema.parse(doc)).toThrow();
  });
});
