import { z } from "zod";
import { checkUniqueIds, RefSchema, SlugSchema } from "./primitives";

export const SpecificationKindSchema = z.enum(["requirement", "design", "task", "acceptance-criteria"]);
export type SpecificationKind = z.infer<typeof SpecificationKindSchema>;

export const SpecificationStatusSchema = z.enum([
  "draft",
  "in-review",
  "approved",
  "in-progress",
  "implemented",
  "deprecated",
]);
export type SpecificationStatus = z.infer<typeof SpecificationStatusSchema>;

export const ApprovalSchema = z
  .object({
    reviewer: z.string().min(1),
    approvedAt: z.string().optional(),
    comment: z.string().optional(),
  })
  .passthrough();
export type Approval = z.infer<typeof ApprovalSchema>;

/**
 * A specification-driven-development artifact: a requirement, design, implementation task, or
 * acceptance-criteria document, with a lifecycle and links out to the pull requests/issues it
 * produced. `linkedPullRequests`/`linkedIssues` are plain strings (URLs or `owner/repo#123`
 * shorthand) rather than `$ref`s: they point at GitHub/GitLab/Jira, not at another team's
 * document, so the `$ref`-resolution machinery in the graph builder doesn't apply to them.
 */
export const SpecificationSchema = z
  .object({
    id: SlugSchema,
    title: z.string().min(1),
    kind: SpecificationKindSchema,
    status: SpecificationStatusSchema.default("draft"),
    body: z.string().optional(),
    reviewers: z.array(z.string().min(1)).default([]),
    approvals: z.array(ApprovalSchema).default([]),
    linkedPullRequests: z.array(z.string().min(1)).default([]),
    linkedIssues: z.array(z.string().min(1)).default([]),
    linkedDocuments: z.array(RefSchema).default([]),
    tags: z.array(z.string().min(1)).default([]),
  })
  .passthrough();
export type Specification = z.infer<typeof SpecificationSchema>;

export const SpecificationsSchema = z
  .array(SpecificationSchema)
  .default([])
  .superRefine((specs, ctx) => checkUniqueIds(specs.map((s) => s.id), ctx, "a team's specifications[]"));
