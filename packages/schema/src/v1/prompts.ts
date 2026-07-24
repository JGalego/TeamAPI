import { z } from "zod";
import { checkUniqueIds, SlugSchema } from "./primitives";

export const PromptVariableSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    required: z.boolean().default(false),
    default: z.string().optional(),
  })
  .passthrough();
export type PromptVariable = z.infer<typeof PromptVariableSchema>;

/** One entry in a prompt's changelog: a prior (or the current) template text, kept for history/rollback. */
export const PromptVersionSchema = z
  .object({
    version: z.string().min(1),
    template: z.string().min(1),
    changelog: z.string().optional(),
    publishedAt: z.string().optional(),
  })
  .passthrough();
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

/**
 * A version-controlled, reusable prompt (e.g. "Code Review", "Generate Tests"). `template` is the
 * current text with `{{variable}}`-style placeholders (rendering is a `@jgalego/teamapi-core` concern, not
 * validated here); `versions[]` holds prior revisions so a prompt's evolution is itself queryable
 * organizational history, mirroring why `sessions[]` records AI collaboration history.
 */
export const PromptSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    template: z.string().min(1),
    variables: z.array(PromptVariableSchema).default([]),
    version: z.string().default("1.0.0"),
    versions: z.array(PromptVersionSchema).default([]),
    tags: z.array(z.string().min(1)).default([]),
    owner: z.string().optional(),
  })
  .passthrough();
export type Prompt = z.infer<typeof PromptSchema>;

export const PromptsSchema = z
  .array(PromptSchema)
  .default([])
  .superRefine((prompts, ctx) => checkUniqueIds(prompts.map((p) => p.id), ctx, "a team's prompts[]"));
