import { z } from "zod";
import { checkUniqueIds, RefSchema, SlugSchema } from "./primitives";

export const MemoryKindSchema = z.enum([
  "architecture-decision",
  "convention",
  "lesson-learned",
  "recurring-issue",
  "domain-knowledge",
  "historical-decision",
]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

/**
 * A persistent organizational-memory entry: something a team (or the AI assistants working with
 * it) would otherwise have to rediscover the hard way. `body` is free-form markdown rather than
 * a structured shape, since memory entries range from a one-line convention to a multi-paragraph
 * postmortem — forcing a single schema on the content would either be too rigid or too loose to
 * be worth it.
 */
export const MemoryEntrySchema = z
  .object({
    id: SlugSchema,
    title: z.string().min(1),
    kind: MemoryKindSchema,
    body: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
    contributors: z.array(z.string().min(1)).default([]),
    /** Related resources — ADRs, policies, specifications, other memory entries — kept as
     * generic `$ref`s (same convention as `interactions[].$ref`) rather than typed per target
     * kind, since a memory entry can reasonably relate to almost anything else in the graph. */
    relatedRefs: z.array(RefSchema).default([]),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const MemorySchema = z
  .array(MemoryEntrySchema)
  .default([])
  .superRefine((entries, ctx) => checkUniqueIds(entries.map((e) => e.id), ctx, "a team's memory[]"));
