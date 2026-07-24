import { describe, expect, it } from "vitest";
import { TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { formatZodError } from "../validate/format-errors";

describe("formatZodError", () => {
  it("formats a single issue as 'path: message'", () => {
    const result = TeamApiDocumentSchema.safeParse({
      teamApiVersion: "1.0.0",
      id: "Not A Slug!",
      info: { name: "Team", type: "stream-aligned" },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = formatZodError(result.error);
    expect(message).toContain("id:");
    expect(message).toContain("kebab-case");
  });

  it("joins multiple issues with '; ' and uses '(root)' for a rootless path", () => {
    const result = TeamApiDocumentSchema.safeParse("not even an object");
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = formatZodError(result.error);
    expect(message).toContain("(root)");
  });

  it("reports every issue, not just the first", () => {
    const result = TeamApiDocumentSchema.safeParse({
      teamApiVersion: "1.0.0",
      id: "Not A Slug!",
      info: { name: "Team", type: "not-a-real-type" },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = formatZodError(result.error);
    expect(message.split("; ").length).toBeGreaterThan(1);
  });
});
