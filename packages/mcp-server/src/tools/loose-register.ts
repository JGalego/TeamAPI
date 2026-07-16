import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
}

type ToolHandler = (args: any) => CallToolResult | Promise<CallToolResult>;

export type LooseRegisterTool = (name: string, config: ToolConfig, cb: ToolHandler) => unknown;

/**
 * `McpServer#registerTool` has a heavily generic signature (input/output arg inference over a
 * cross-Zod-version compat union) that causes pathological TypeScript type-checking cost once
 * more than a couple of differently-shaped tools are registered in the same file — observed
 * turning a ~1s `tsc` run into an unbounded hang (verified with `strace`: the process sits mostly
 * blocked, not CPU-bound, consistent with runaway generic instantiation). Binding through this
 * simplified, non-generic signature keeps runtime behavior identical while skipping that
 * inference; handler argument shapes are annotated explicitly at each call site instead.
 */
export function looseRegisterTool(server: McpServer): LooseRegisterTool {
  return server.registerTool.bind(server) as unknown as LooseRegisterTool;
}
