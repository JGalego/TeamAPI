import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { OrgGraphStore } from "../resolve/store";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

describe("OrgGraphStore", () => {
  it("throws if .current is read before .load()", () => {
    const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
    expect(() => store.current).toThrow(/has not been loaded yet/);
  });

  it("exposes the resolved graph via .current after .load()", async () => {
    const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
    const loaded = await store.load();
    expect(store.current).toBe(loaded);
    expect(store.current.teams.size).toBe(4);
  });

  it(".reload() re-resolves and replaces .current", async () => {
    const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
    const first = await store.load();
    const second = await store.reload();
    expect(second).not.toBe(first); // a fresh graph object, not the same reference
    expect(store.current).toBe(second);
    expect(store.current.teams.size).toBe(4);
  });
});
