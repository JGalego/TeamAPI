import type { z } from "zod/v4";

/**
 * One org-graph operation the model may call: a name, a description, a zod schema for its input,
 * and a function.
 *
 * Provider-neutral on purpose. The shape of a tool is the only thing that ever tied this package
 * to a single vendor, and it is the part with no vendor-specific content in it — every provider
 * wants the same four things, differently spelled. Keeping the definition here means adding a
 * provider is an adapter in `providers/`, not a second copy of thirteen tool implementations.
 */
export interface ChatTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<S>) => Promise<string>;
}

/** A tool with its input type erased, which is what an adapter iterating over the array holds. */
export type AnyChatTool = ChatTool<z.ZodType>;
