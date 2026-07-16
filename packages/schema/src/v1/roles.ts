import { z } from "zod";
import { RoleKindSchema, SlugSchema } from "./primitives";

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
