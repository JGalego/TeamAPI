import { z } from "zod";
import { checkUniqueIds, SlugSchema } from "./primitives";

export const PolicyCategorySchema = z.enum([
  "pr-requirements",
  "required-approvals",
  "documentation",
  "security",
  "dependency",
  "custom",
]);
export type PolicyCategory = z.infer<typeof PolicyCategorySchema>;

export const PolicySeveritySchema = z.enum(["info", "warning", "blocking"]);
export type PolicySeverity = z.infer<typeof PolicySeveritySchema>;

/** One machine-checkable rule within a policy, e.g. `{ key: "min_approvals", value: 2 }`.
 * `value` is deliberately untyped (`unknown`): the set of rule keys is open-ended and owned by
 * whatever external automation enforces them, not by this schema. */
export const PolicyRuleSchema = z
  .object({
    key: z.string().min(1),
    description: z.string().optional(),
    value: z.unknown().optional(),
  })
  .passthrough();
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

/**
 * Machine-readable governance, meant to be read (and enforced) by external automation — a CI
 * check, a bot commenting on PRs, a bespoke linter. This schema only declares *what* the policy
 * requires; it does not implement enforcement itself.
 */
export const PolicySchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    category: PolicyCategorySchema,
    severity: PolicySeveritySchema.default("warning"),
    description: z.string().optional(),
    rules: z.array(PolicyRuleSchema).default([]),
    /** Names/ids of the automation(s) that actually enforce this policy, e.g. `["github-actions:pr-gate"]`. */
    enforcedBy: z.array(z.string().min(1)).default([]),
    tags: z.array(z.string().min(1)).default([]),
  })
  .passthrough();
export type Policy = z.infer<typeof PolicySchema>;

export const PoliciesSchema = z
  .array(PolicySchema)
  .default([])
  .superRefine((policies, ctx) => checkUniqueIds(policies.map((p) => p.id), ctx, "a team's policies[]"));
