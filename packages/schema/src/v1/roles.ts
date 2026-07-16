import { z } from "zod";
import { RefSchema, RoleKindSchema, SlugSchema } from "./primitives";

/** A reference to another team's role, by team document `$ref` plus that team's `roles[].id`.
 * `teamName` mirrors `Interaction`/`Dependency`'s convention of keeping a human-readable label
 * inline alongside the `$ref`, so the target is legible without resolving the reference. */
export const RoleRefSchema = RefSchema.extend({
  teamName: z.string().min(1),
  roleId: SlugSchema,
});
export type RoleRef = z.infer<typeof RoleRefSchema>;

/**
 * A role is a position/function within the team (e.g. "Payments Tech Lead"), independent of who
 * (if anyone) currently fills it. Keeping roles and people separate lets a role stay vacant, be
 * job-shared by multiple members, or be held by one member alongside other roles.
 */
export const RoleSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    kind: RoleKindSchema,
    responsibilities: z.array(z.string().min(1)).default([]),
    reportsTo: SlugSchema.optional(),
    /** Formal reporting line to a role on another team, e.g. a tech lead reporting to a
     * cross-team engineering manager. Mutually exclusive with `reportsTo` in practice, since a
     * role reports to exactly one manager, same-team or not. */
    reportsToRef: RoleRefSchema.optional(),
    /** Dotted-line / matrix relationships that aren't formal reporting — e.g. a community of
     * practice lead a role coordinates with, same-team or cross-team. */
    alignsWith: z.array(RoleRefSchema).default([]),
  })
  .passthrough();
export type Role = z.infer<typeof RoleSchema>;

export const RolesSchema = z.array(RoleSchema).default([]);

/** A person on the team, optionally assigned to one or more `roles[]` by id. */
export const MemberSchema = z
  .object({
    id: SlugSchema,
    name: z.string().min(1),
    contact: z.string().optional(),
    roleIds: z.array(SlugSchema).default([]),
    allocation: z.number().min(0).max(100).optional(),
  })
  .passthrough();
export type Member = z.infer<typeof MemberSchema>;

export const MembersSchema = z.array(MemberSchema).default([]);
