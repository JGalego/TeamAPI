import { z } from "zod";
import { checkUniqueIds, SlugSchema } from "./primitives";

export const AgentStatusSchema = z.enum(["active", "inactive", "deprecated"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * An AI assistant treated as a first-class team participant, alongside `roles[]`/`members[]`.
 * Modeled separately from `Member` rather than folded into it: an agent has a `provider`/`model`
 * and `capabilities` a human member doesn't, and keeping them distinct lets tooling (context
 * bundles, sessions) ask "which agents can do X" without filtering people out of a merged list.
 */
export const AgentSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    provider: z.string().min(1),
    model: z.string().optional(),
    role: z.string().min(1),
    capabilities: z.array(z.string().min(1)).default([]),
    status: AgentStatusSchema.default("active"),
    /** The member (`members[].id`) accountable for this agent's behavior/cost, if any. */
    ownerId: SlugSchema.optional(),
    /** Machine-readable capability grants, e.g. `["read:specifications", "write:pull-requests"]` —
     * enforced by whatever external automation actually executes the agent's actions, not by this
     * schema. */
    permissions: z.array(z.string().min(1)).default([]),
    tags: z.array(z.string().min(1)).default([]),
  })
  .passthrough();
export type Agent = z.infer<typeof AgentSchema>;

export const AgentsSchema = z
  .array(AgentSchema)
  .default([])
  .superRefine((agents, ctx) => checkUniqueIds(agents.map((a) => a.id), ctx, "a team's agents[]"));
