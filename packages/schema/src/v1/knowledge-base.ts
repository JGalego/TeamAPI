import { z } from "zod";
import { checkUniqueIds, RefSchema, SlugSchema } from "./primitives";

export const KnowledgeBaseKindSchema = z.enum([
  "adr",
  "faq",
  "meeting-notes",
  "architecture-doc",
  "runbook",
  "design-doc",
]);
export type KnowledgeBaseKind = z.infer<typeof KnowledgeBaseKindSchema>;

/** General structured documentation: ADRs, FAQs, meeting notes, runbooks, design docs. Kept
 * distinct from `memory[]`: memory entries are informal, accumulated team knowledge ("we learned
 * the hard way that..."), while knowledge base entries are the team's formal, curated documents. */
export const KnowledgeBaseEntrySchema = z
  .object({
    id: SlugSchema,
    title: z.string().min(1),
    kind: KnowledgeBaseKindSchema,
    category: z.string().optional(),
    body: z.string().min(1),
    relatedRefs: z.array(RefSchema).default([]),
    attachments: z.array(RefSchema).default([]),
    tags: z.array(z.string().min(1)).default([]),
  })
  .passthrough();
export type KnowledgeBaseEntry = z.infer<typeof KnowledgeBaseEntrySchema>;

export const KnowledgeBaseSchema = z
  .array(KnowledgeBaseEntrySchema)
  .default([])
  .superRefine((entries, ctx) => checkUniqueIds(entries.map((e) => e.id), ctx, "a team's knowledgeBase[]"));
