import { z } from "zod";
import { checkUniqueIds, RefSchema, SlugSchema } from "./primitives";

export const PlaybookCategorySchema = z.enum([
  "incident-response",
  "release",
  "onboarding",
  "offboarding",
  "production-deployment",
  "custom",
]);
export type PlaybookCategory = z.infer<typeof PlaybookCategorySchema>;

export const PlaybookStepSchema = z
  .object({
    order: z.number().int().nonnegative(),
    title: z.string().min(1),
    description: z.string().optional(),
    requiredRoles: z.array(z.string().min(1)).default([]),
    /** Name of an external automation (webhook, script, CI job) this step can trigger — an
     * identifier for `@jgalego/teamapi-core`/external tooling to resolve, not executed by this schema. */
    automationHook: z.string().optional(),
  })
  .passthrough();
export type PlaybookStep = z.infer<typeof PlaybookStepSchema>;

/** A structured operational procedure, e.g. incident response or a release process. */
export const PlaybookSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    category: PlaybookCategorySchema,
    steps: z.array(PlaybookStepSchema).default([]),
    documentation: z.string().optional(),
    attachments: z.array(RefSchema).default([]),
    tags: z.array(z.string().min(1)).default([]),
  })
  .passthrough();
export type Playbook = z.infer<typeof PlaybookSchema>;

export const PlaybooksSchema = z
  .array(PlaybookSchema)
  .default([])
  .superRefine((playbooks, ctx) => checkUniqueIds(playbooks.map((p) => p.id), ctx, "a team's playbooks[]"));
