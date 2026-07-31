import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
}

// `any` rather than `unknown` on purpose: parameter positions are contravariant, so a handler
// declared as `(args: { teamId: string }) => ...` is assignable to `(args: any) => ...` but not
// to `(args: unknown) => ...`. `unknown` here would reject every call site. See the note on
// `looseRegisterTool` below for why the parameter is erased at all.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // The double assertion is what does the work: it is the point at which TypeScript stops
  // instantiating `registerTool`'s generic signature. `no-unnecessary-type-assertion` reads it as
  // redundant because the bound method is structurally assignable, but removing it reintroduces
  // the inference blowup above as a hard `TS2589: Type instantiation is excessively deep`.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return server.registerTool.bind(server) as unknown as LooseRegisterTool;
}
