import { z } from "zod";
import { checkUniqueIds, SlugSchema } from "./primitives";

export const SteeringCategorySchema = z.enum([
  "coding-standards",
  "api-conventions",
  "security-guidelines",
  "architecture-principles",
  "documentation-style",
  "custom",
]);
export type SteeringCategory = z.infer<typeof SteeringCategorySchema>;

/**
 * `organization` documents are declared on a platform team (or whichever team a given org treats
 * as its root) and inherit down to every team that reaches it via the existing `platform.$ref`
 * chain — reusing that edge rather than inventing a second hierarchy concept. `@jgalego/teamapi-core`'s
 * `resolveEffectiveSteering` walks that chain; this schema only declares the document's own scope.
 */
export const SteeringScopeSchema = z.enum(["organization", "team", "project"]);
export type SteeringScope = z.infer<typeof SteeringScopeSchema>;

export const SteeringDocumentSchema = z
  .object({
    id: SlugSchema,
    title: z.string().min(1),
    category: SteeringCategorySchema,
    scope: SteeringScopeSchema.default("team"),
    /** The project this document applies to, when `scope: "project"`. Free text, not a `$ref`:
     * this schema has no separate "project" resource to point at. */
    appliesTo: z.string().optional(),
    body: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
  })
  .passthrough();
export type SteeringDocument = z.infer<typeof SteeringDocumentSchema>;

export const SteeringDocumentsSchema = z
  .array(SteeringDocumentSchema)
  .default([])
  .superRefine((docs, ctx) => checkUniqueIds(docs.map((d) => d.id), ctx, "a team's steeringDocuments[]"));
