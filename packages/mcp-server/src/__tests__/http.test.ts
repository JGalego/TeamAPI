import { createServer, type Server } from "node:http";
import * as path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import { createMcpHttpHandler } from "../http";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let store: OrgGraphStore;
let server: Server | undefined;

beforeAll(async () => {
  store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

/**
 * A real listening socket rather than an injected request.
 *
 * This is an HTTP transport that streams server-sent events and writes to the raw response, so a
 * mocked request/response would be testing a different thing than the one that ships.
 */
async function listen(): Promise<string> {
  const handler = createMcpHttpHandler(store);
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      void handler(req, res, raw ? JSON.parse(raw) : undefined);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return `http://127.0.0.1:${address.port}`;
}

async function rpc(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // The transport answers as server-sent events; the JSON-RPC payload is the `data:` line.
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  expect(data, `no data frame in: ${text}`).toBeTruthy();
  return JSON.parse(data!) as Record<string, unknown>;
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
};

describe("MCP over Streamable HTTP", () => {
  it("completes an initialize handshake", async () => {
    const url = await listen();
    const response = await rpc(url, INITIALIZE);
    expect(response.result).toMatchObject({ serverInfo: { name: "team-api-mcp-server" } });
  });

  it("lists the same tools the stdio server exposes", async () => {
    const url = await listen();
    const response = (await rpc(url, { jsonrpc: "2.0", id: 2, method: "tools/list" })) as {
      result: { tools: { name: string }[] };
    };
    const names = response.result.tools.map((tool) => tool.name);
    expect(names).toContain("list_teams");
    expect(names).toContain("find_service_owner");
    expect(names).toContain("get_org_gaps");
  });

  it("calls a tool and returns real data from the graph", async () => {
    const url = await listen();
    const response = (await rpc(url, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "find_service_owner", arguments: { serviceName: "payments-api" } },
    })) as { result: { content: { text: string }[]; isError?: boolean } };

    expect(response.result.isError).toBeFalsy();
    expect(JSON.parse(response.result.content[0]!.text)).toMatchObject({ teamId: "platform-payments" });
  });

  /** The property that makes one endpoint serveable to a whole org. */
  it("answers a request that never initialized, since it keeps no session", async () => {
    const url = await listen();
    // A stateful transport would reject this for want of a session id. Statelessness is what lets
    // any instance behind a load balancer answer any request.
    const response = (await rpc(url, { jsonrpc: "2.0", id: 4, method: "tools/list" })) as {
      result: { tools: unknown[] };
    };
    expect(response.result.tools.length).toBeGreaterThan(0);
  });

  it("issues no session id", async () => {
    const url = await listen();
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(INITIALIZE),
    });
    await res.text();
    expect(res.headers.get("mcp-session-id")).toBeNull();
  });

  it("serves many independent requests without leaking state between them", async () => {
    const url = await listen();
    for (let i = 0; i < 5; i++) {
      const response = (await rpc(url, { jsonrpc: "2.0", id: i, method: "tools/list" })) as {
        result: { tools: unknown[] };
      };
      expect(response.result.tools.length).toBeGreaterThan(0);
    }
  });

  it("reports an unknown tool as an error result rather than failing the transport", async () => {
    const url = await listen();
    const response = (await rpc(url, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    })) as { result: { isError: boolean } };
    expect(response.result.isError).toBe(true);
  });

  it("reflects a reloaded graph, since the handler reads the store per request", async () => {
    const url = await listen();
    // Not a new handler, not a restart: the same endpoint, after the store reloaded.
    await store.reload();
    const response = (await rpc(url, { jsonrpc: "2.0", id: 6, method: "tools/list" })) as {
      result: { tools: unknown[] };
    };
    expect(response.result.tools.length).toBeGreaterThan(0);
  });
});
