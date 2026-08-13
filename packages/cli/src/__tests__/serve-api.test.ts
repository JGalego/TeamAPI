import { describe, expect, it } from "vitest";
import { checkExposure, isLoopbackHost } from "../commands/serve-api";

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "::1", "localhost"])("treats %s as loopback", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["0.0.0.0", "192.168.1.10", "::", "api.internal.test"])("treats %s as reachable", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("checkExposure", () => {
  it("allows loopback with no token — the default local workflow is unchanged", () => {
    expect(checkExposure("127.0.0.1", undefined, false)).toBeUndefined();
  });

  it("refuses a reachable address with no token", () => {
    const refusal = checkExposure("0.0.0.0", undefined, false);
    expect(refusal).toContain("Refusing to listen on 0.0.0.0");
    expect(refusal).toContain("--token");
  });

  it("allows a reachable address once a token is set", () => {
    expect(checkExposure("0.0.0.0", "a-token", false)).toBeUndefined();
  });

  it("allows a reachable address with an explicit --allow-anonymous", () => {
    expect(checkExposure("0.0.0.0", undefined, true)).toBeUndefined();
  });

  it("names what would be exposed, not just that something would be", () => {
    // The refusal has to be worth reading: "insecure configuration" tells nobody what is at stake.
    expect(checkExposure("0.0.0.0", undefined, false)).toContain("contact details");
  });
});
