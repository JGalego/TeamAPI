import { z } from "zod";
import { checkUniqueIds, RefSchema, SlugSchema } from "./primitives";

/**
 * A record of an AI collaboration session — what an assistant was asked to do, what it produced,
 * and what it referenced along the way. `sessions[]` is written after the fact (by hand, or by
 * tooling such as `teamapi chat --debug`'s transcript), the same way `meetings[]` records a
 * standing meeting rather than driving one live: this schema is a durable record, not a live
 * session-management API.
 */
export const AiSessionSchema = z
  .object({
    id: SlugSchema,
    /** The `agents[].id` that ran this session, when the assistant is one of this team's declared agents. */
    agentId: SlugSchema.optional(),
    /** Display name of the assistant, e.g. "Claude", "GPT-4" — kept independent of `agentId` so a
     * session can be recorded even for an assistant the team hasn't declared in `agents[]`. */
    assistant: z.string().min(1),
    model: z.string().optional(),
    objective: z.string().min(1),
    /** `prompts[].id` used during this session, when drawn from this team's prompt library. */
    promptIds: z.array(SlugSchema).default([]),
    generatedArtifacts: z.array(RefSchema).default([]),
    referencedDocuments: z.array(RefSchema).default([]),
    decisions: z.array(z.string().min(1)).default([]),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
    tags: z.array(z.string().min(1)).default([]),
  })
  .passthrough();
export type AiSession = z.infer<typeof AiSessionSchema>;

export const AiSessionsSchema = z
  .array(AiSessionSchema)
  .default([])
  .superRefine((sessions, ctx) => checkUniqueIds(sessions.map((s) => s.id), ctx, "a team's sessions[]"));
